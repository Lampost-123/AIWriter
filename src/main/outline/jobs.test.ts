import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AppEvents } from '@shared/api'
import { emptySceneCard } from '@shared/defaults'
import type { ModelChoice } from '@shared/types'
import * as repo from '../db/repo'
import * as acts from '../db/acts'
import * as gens from '../db/generations'
import { putSummary } from '../db/memory'
import type { JobModel } from '../ai/jobModel'
import type { Emit } from '../ai/tasks'
import { startFakeProvider, type FakeProvider } from '../../../tests/fake-provider/server.mjs'
import { dbWorld } from '../../../tests/unit/testWorld'
import { fitBlocks, planText, type BlockDraft, type PlanAct } from './brief'
import { isBlankPlan, storyPlan } from './context'
import { briefingBudget, outlineReplyTokens, startIdeasJob, startOutlineJob } from './jobs'
import { cleanSize, MARKER, outlineAsk } from './prompts'

let fake: FakeProvider
beforeAll(async () => {
  fake = await startFakeProvider({ delayMs: 0 })
})
afterAll(() => fake.close())

type Ev = { name: keyof AppEvents; payload: AppEvents[keyof AppEvents] }

const choice = (contextLength = 32000): ModelChoice => ({
  providerId: 'p1',
  modelId: 'fake/writer',
  label: 'Fake',
  contextLength,
  promptPrice: null,
  completionPrice: null
})

const model = (contextLength?: number): JobModel => ({
  job: 'chat',
  target: { id: 'p1', name: 'Fake', kind: 'custom', baseUrl: fake.url, apiKey: 'k' },
  choice: choice(contextLength),
  thinking: 'off'
})

/** Runs a job to its end and gives back its record and events. */
async function run(start: (emit: Emit) => { generationId: string }, db: ReturnType<typeof dbWorld>['db']) {
  const events: Ev[] = []
  const { generationId } = start((name, payload) => void events.push({ name, payload }))
  const t0 = Date.now()
  while (!events.some((e) => e.name === 'task:done')) {
    if (Date.now() - t0 > 10_000) throw new Error('The job never finished')
    await new Promise((r) => setTimeout(r, 10))
  }
  return { record: gens.getGeneration(db, generationId), events }
}

describe('what the outline helper asks', () => {
  it('asks for the size given, kept within limits', () => {
    expect(cleanSize({ acts: 9, chapters: 0, scenes: 2.6 })).toEqual({ acts: 1, chapters: 1, scenes: 3 })
    expect(cleanSize(null)).toEqual({ acts: 3, chapters: 9, scenes: 3 })
    expect(outlineAsk({ acts: 2, chapters: 6, scenes: 3 }, { lastAct: null, chapters: 0 })).toBe(
      'Suggest 2 new acts with 6 chapters in all, spread across them, and 3 scenes in each chapter: about 18 scenes. The story has nothing written or planned yet: start it from the premise.'
    )
    expect(outlineAsk({ acts: 0, chapters: 1, scenes: 1 }, { lastAct: 'The Turning', chapters: 4 })).toBe(
      "Suggest 1 chapter with 1 scene in each: about 1 scene. No acts. They carry on the story's last act, “The Turning”. They come after everything the story already has, and carry it on."
    )
  })

  it('leaves room for the reply and its thinking', () => {
    expect(outlineReplyTokens({ acts: 3, chapters: 9, scenes: 3 })).toBe(3465)
    expect(outlineReplyTokens({ acts: 6, chapters: 30, scenes: 6 })).toBe(12000)
    expect(briefingBudget({ choice: choice(32000), thinking: 'off' }, 3465)).toBe(32000 - 3465 - 1600)
  })

  it('never asks for more scene cards than the reply has room for', () => {
    expect(cleanSize({ acts: 6, chapters: 30, scenes: 6 })).toEqual({ acts: 6, chapters: 30, scenes: 3 })
    expect(cleanSize({ acts: 2, chapters: 16, scenes: 6 })).toEqual({ acts: 2, chapters: 16, scenes: 6 })
    for (let chapters = 1; chapters <= 30; chapters++)
      for (let scenes = 1; scenes <= 6; scenes++) {
        const size = cleanSize({ acts: 6, chapters, scenes })
        expect(size.chapters * size.scenes).toBeLessThanOrEqual(100)
        // Room for every card it asks for: the reply is never cut short by its own limit.
        expect(300 + (size.acts + size.chapters) * 50 + size.chapters * size.scenes * 95).toBeLessThanOrEqual(12_000)
      }
  })
})

describe('the briefing', () => {
  const plan: PlanAct[] = [
    {
      id: null,
      title: '',
      purpose: '',
      chapters: [
        {
          id: 'c1',
          title: 'Chapter 1',
          goal: '',
          summary: 'Mara arrives.',
          scenes: [{ id: 's1', title: 'Rain', summary: 'Mara comes in out of the rain.', goal: '', beats: [], words: 900 }]
        }
      ]
    },
    {
      id: 'a1',
      title: 'The Turning',
      purpose: 'Everything goes wrong',
      chapters: [
        {
          id: 'c2',
          title: 'Smoke',
          goal: 'The mill burns',
          summary: '',
          scenes: [{ id: 's2', title: 'Fire', summary: '', goal: 'The mill burns down', beats: ['Smoke', 'Bells'], words: 0 }]
        }
      ]
    }
  ]

  it('gives the story’s plan in less detail at each level', () => {
    expect(planText(plan, 0)).toBe(
      [
        'Chapter: Chapter 1',
        '  - Rain: Mara comes in out of the rain.',
        'Act: The Turning. Purpose: Everything goes wrong.',
        '  Chapter: Smoke. Goal: The mill burns.',
        '    - Fire: The mill burns down. (planned, not written yet) Beats: Smoke. Bells.'
      ].join('\n')
    )
    expect(planText(plan, 2)).toBe(
      [
        'Chapter: Chapter 1',
        'Act: The Turning. Purpose: Everything goes wrong.',
        '  Chapter: Smoke. Goal: The mill burns.',
        '    - Fire: The mill burns down. (planned, not written yet) Beats: Smoke. Bells.'
      ].join('\n')
    )
    expect(planText(plan, 3)).toBe('Chapter: Chapter 1\nChapter: Smoke. Goal: The mill burns.')
    expect(planText([], 0)).toBe('')
  })

  it('shortens the least important parts first, and says so plainly when even the essentials don’t fit', () => {
    const long = 'word '.repeat(400)
    const drafts: BlockDraft[] = [
      { id: 'story', title: 'The story', priority: 1, forms: ['A story.'] },
      { id: 'plan', title: 'Plan', priority: 2, forms: [long, 'short plan'] },
      { id: 'cast', title: 'Cast', priority: 5, forms: [long, 'short cast'] },
      { id: 'empty', title: 'Nothing', priority: 3, forms: ['', ''] },
      { id: 'ask', title: 'Ask', priority: 0, forms: ['Suggest.'] }
    ]
    const roomy = fitBlocks(drafts, 'system', 10_000, 'chat and brainstorm model')
    expect(roomy.blocks.map((b) => [b.id, b.short, b.dropped])).toEqual([
      ['story', false, false],
      ['plan', false, false],
      ['cast', false, false],
      ['ask', false, false]
    ])
    const tight = fitBlocks(drafts, 'system', 700, 'chat and brainstorm model')
    expect(tight.blocks.map((b) => [b.id, b.short, b.dropped])).toEqual([
      ['story', false, false],
      ['plan', false, false],
      ['cast', true, false],
      ['ask', false, false]
    ])
    expect(tight.text).toContain('## Cast\nshort cast')
    const tighter = fitBlocks(drafts, 'system', 60, 'chat and brainstorm model')
    expect(tighter.blocks.map((b) => [b.id, b.dropped])).toEqual([
      ['story', false],
      ['plan', false],
      ['cast', true],
      ['ask', false]
    ])
    expect(tighter.text).toBe('## The story\nA story.\n\n## Plan\nshort plan\n\n## Ask\nSuggest.')
    expect(() => fitBlocks(drafts, 'system', 5, 'chat and brainstorm model')).toThrow(
      'This is more than the chat and brainstorm model can read at once. Pick a model that can read more in Settings › Models.'
    )
  })
})

describe('asking for an outline', () => {
  it('sends the story, its plan, its open plot threads and its people, and records the call as an outline', async () => {
    const w = dbWorld()
    const storyId = w.id('b1')
    repo.updateStory(w.db, storyId, { premise: 'Mara must find who burned the mill.' })
    const { record, events } = await run(
      (emit) =>
        startOutlineJob(
          { db: w.db, model: model(), emit },
          { taskId: 't1', storyId, premise: 'Mara hunts the arsonist.', size: { acts: 2, chapters: 3, scenes: 2 } }
        ),
      w.db
    )
    expect(record.job).toBe('outline')
    expect(record.status).toBe('complete')
    expect(record.sceneId).toBe('')
    const [system, user] = record.messages
    expect(system.content.startsWith(`${MARKER} outline`)).toBe(true)
    expect(user.content).toContain('Premise: Mara hunts the arsonist.')
    expect(user.content).toContain('## What the story has so far\nChapter: Chapter 1')
    expect(user.content).toContain('## Open plot threads\n- Who burned the mill?')
    expect(user.content).toContain('- Mara (character)')
    expect(user.content).toContain('Suggest 2 new acts with 3 chapters in all')
    expect(record.blocks.map((b) => b.id)).toEqual(['story', 'plan', 'threads', 'cast', 'ask'])
    expect(record.entries.map((e) => e.entryId)).toEqual(expect.arrayContaining([w.id('burned'), w.id('mara')]))
    // The fake answers in the form asked for, and follows the briefing's first open thread.
    expect(record.response).toContain('# Act: The Arrival')
    expect(record.response).toContain('“Who burned the mill?” comes back to haunt her')
    const done = events.find((e) => e.name === 'task:done')!.payload as AppEvents['task:done']
    expect(done).toMatchObject({ taskId: 't1', job: 'outline', status: 'complete' })
  })

  it('carries on the story’s last act when no new acts are asked for', async () => {
    const w = dbWorld()
    const storyId = w.id('b1')
    acts.createAct(w.db, storyId, { title: 'The Turning' })
    const { record } = await run(
      (emit) =>
        startOutlineJob(
          { db: w.db, model: model(), emit },
          { taskId: 't2', storyId, premise: '', size: { acts: 0, chapters: 2, scenes: 1 } }
        ),
      w.db
    )
    expect(record.messages[0].content).toContain('No acts.')
    expect(record.messages[1].content).toContain("They carry on the story's last act, “The Turning”.")
    expect(record.messages[1].content).toContain('Act: The Turning')
    expect(record.response).not.toContain('# Act:')
  })

  it('plans a new story from its premise, not after the empty Chapter 1 it was made with, and still knows the story before', async () => {
    const w = dbWorld()
    putSummary(w.db, { level: 'story', targetId: w.id('b1'), text: 'Mara learns she is the heir, and the mill burns.', origin: 'text' })
    const story = repo.createStory(w.db, { title: 'Book 5', startStoryId: w.id('b1') })
    const chapter = repo.createChapter(w.db, story.id, { title: 'Chapter 1' })
    repo.createScene(w.db, chapter.id, { title: 'Scene 1' })
    const { record } = await run(
      (emit) =>
        startOutlineJob(
          { db: w.db, model: model(), emit },
          { taskId: 't4', storyId: story.id, premise: 'Mara goes north.', size: { acts: 1, chapters: 1, scenes: 1 } }
        ),
      w.db
    )
    const user = record.messages[1].content
    expect(user).toContain('The story has nothing written or planned yet: start it from the premise.')
    expect(user).not.toContain('## What the story has so far')
    expect(user).toContain('## Earlier stories\nBook 1: Mara learns she is the heir, and the mill burns.')

    // Once the scene has a name of its own, it is something to carry on from.
    const scene = repo.getOutline(w.db, story.id).scenes[0]
    repo.updateScene(w.db, scene.id, { title: 'The north road' })
    const again = await run(
      (emit) =>
        startOutlineJob(
          { db: w.db, model: model(), emit },
          { taskId: 't5', storyId: story.id, premise: 'Mara goes north.', size: { acts: 1, chapters: 1, scenes: 1 } }
        ),
      w.db
    )
    expect(again.record.messages[1].content).toContain('## What the story has so far\nChapter: Chapter 1\n  - The north road')
    expect(again.record.messages[1].content).toContain('They come after everything the story already has, and carry it on.')
  })

  it('counts a story as having nothing planned only while it has just its empty “Chapter 1” and “Scene 1”', () => {
    const w = dbWorld()
    const story = repo.createStory(w.db, { title: 'Book 6' })
    const blank = (): boolean => isBlankPlan(storyPlan(w.db, story.id))
    expect(blank()).toBe(true)
    const chapter = repo.createChapter(w.db, story.id, { title: 'Chapter 1' })
    const scene = repo.createScene(w.db, chapter.id, { title: 'Scene 1' })
    expect(blank()).toBe(true)
    // Something on the scene's card is a plan to carry on from, as is a goal for the chapter.
    repo.updateSceneCard(w.db, scene.id, { ...emptySceneCard(), goal: 'Mara leaves home' })
    expect(blank()).toBe(false)
    repo.updateSceneCard(w.db, scene.id, emptySceneCard())
    expect(blank()).toBe(true)
    repo.updateChapter(w.db, chapter.id, { goal: 'She sets out' })
    expect(blank()).toBe(false)
    repo.updateChapter(w.db, chapter.id, { goal: '' })
    acts.createAct(w.db, story.id, { title: 'The Arrival' })
    expect(blank()).toBe(false)
  })

  it('says so before asking when the outline is longer than the model can write in one answer', async () => {
    const w = dbWorld()
    const short: JobModel = { ...model(), choice: { ...choice(), maxOutput: 4096 } }
    expect(() =>
      startOutlineJob(
        { db: w.db, model: short, emit: () => undefined },
        { taskId: 't6', storyId: w.id('b1'), premise: '', size: { acts: 3, chapters: 12, scenes: 4 } }
      )
    ).toThrow(
      'That is more than the chat and brainstorm model can answer in one go. Ask for fewer chapters or fewer scenes in each, or pick a model that writes longer answers in Settings › Models.'
    )
    // A size its answer holds goes ahead.
    const { record } = await run(
      (emit) =>
        startOutlineJob(
          { db: w.db, model: short, emit },
          { taskId: 't7', storyId: w.id('b1'), premise: '', size: { acts: 3, chapters: 9, scenes: 3 } }
        ),
      w.db
    )
    expect(record.status).toBe('complete')
  })

  it('says plainly when the model can’t read enough to plan', () => {
    const w = dbWorld()
    expect(() =>
      startOutlineJob(
        { db: w.db, model: model(1500), emit: () => undefined },
        { taskId: 't3', storyId: w.id('b1'), premise: '', size: { acts: 3, chapters: 9, scenes: 3 } }
      )
    ).toThrow(
      'That is more than the chat and brainstorm model can plan at once. Ask for fewer chapters or scenes, or pick a model that can read more in Settings › Models.'
    )
  })
})

describe('asking for next scene ideas', () => {
  it('sends where the scene is, the outline around it and the scene before, and records the call against the scene', async () => {
    const w = dbWorld()
    const sceneId = w.id('b1.c2.s2')
    repo.saveSceneText(w.db, w.id('b1.c2.s1'), null, 'Mara lost her left hand at the mill. The bells rang all night.')
    const { record } = await run((emit) => startIdeasJob({ db: w.db, model: model(), emit }, { taskId: 'i1', sceneId }), w.db)
    expect(record.job).toBe('ideas')
    expect(record.sceneId).toBe(sceneId)
    const [system, user] = record.messages
    expect(system.content.startsWith(`${MARKER} ideas`)).toBe(true)
    expect(user.content).toContain('Chapter 2 of 3: Chapter 2')
    expect(user.content).toContain('This is scene 2 of 2 in the chapter.')
    expect(user.content).toContain('- (this scene: the one to plan)')
    expect(user.content).toContain('## How the scene before ends\nMara lost her left hand at the mill.')
    expect(user.content).toContain('Suggest three possible directions for this scene.')
    expect(record.response).toContain('## 1. The door left open')
    expect(record.response).toContain('## 3. The wrong messenger')
  })

  it('names a scene by its title once it has one', async () => {
    const w = dbWorld()
    const sceneId = w.id('b1.c1.s1')
    repo.updateScene(w.db, sceneId, { title: 'The ferry' })
    const { record } = await run((emit) => startIdeasJob({ db: w.db, model: model(), emit }, { taskId: 'i2', sceneId }), w.db)
    expect(record.messages[1].content).toContain('Suggest three possible directions for the scene “The ferry”.')
    expect(record.blocks.find((b) => b.id === 'previous')).toBeUndefined()
  })
})
