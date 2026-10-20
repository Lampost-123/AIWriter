// The outline in stages (2026-10-19): each level asks for only its own headings, told the story, what it has, the outline
// being planned, the open plot threads and the cast; the replies are small; and the fake provider answers each level.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AppEvents } from '@shared/api'
import type { ModelChoice } from '@shared/types'
import * as repo from '../db/repo'
import * as gens from '../db/generations'
import type { JobModel } from '../ai/jobModel'
import type { Emit } from '../ai/tasks'
import { startFakeProvider, type FakeProvider } from '../../../tests/fake-provider/server.mjs'
import { dbWorld } from '../../../tests/unit/testWorld'
import { estimateTokens } from '../keeper/text'
import { MARKER, stageAsk, stageStart, stageSystem } from './prompts'
import { headingsOnly, headingTitle, latestUpTo, stageReplyTokens, startStageJob } from './stages'
import { UserError } from '../util'

let fake: FakeProvider
beforeAll(async () => {
  fake = await startFakeProvider({ delayMs: 0 })
})
afterAll(() => fake.close())

type Ev = { name: keyof AppEvents; payload: AppEvents[keyof AppEvents] }

const choice = (o: Partial<ModelChoice> = {}): ModelChoice => ({
  providerId: 'p1',
  modelId: 'fake/writer',
  label: 'Fake',
  contextLength: 32000,
  promptPrice: null,
  completionPrice: null,
  ...o
})
const model = (o: Partial<ModelChoice> = {}): JobModel => ({
  job: 'chat',
  target: { id: 'p1', name: 'Fake', kind: 'custom', baseUrl: fake.url, apiKey: 'k' },
  choice: choice(o),
  thinking: 'off'
})

async function run(start: (emit: Emit) => { generationId: string }, db: ReturnType<typeof dbWorld>['db']) {
  const events: Ev[] = []
  const { generationId } = start((name, payload) => void events.push({ name, payload }))
  const t0 = Date.now()
  while (!events.some((e) => e.name === 'task:done')) {
    if (Date.now() - t0 > 10_000) throw new Error('The job never finished')
    await new Promise((r) => setTimeout(r, 10))
  }
  return gens.getGeneration(db, generationId)
}

describe('what each stage asks', () => {
  it('asks for only its own level, in the outline helper’s form', () => {
    const acts = stageSystem('acts')
    expect(acts.startsWith(`${MARKER} stage acts`)).toBe(true)
    expect(acts).toContain('Chapters: <about how many chapters it needs, as a number>')
    expect(acts).toContain('Only acts: no chapters and no scenes.')
    expect(stageSystem('chapters')).toContain('## Chapter: <the chapter')
    expect(stageSystem('chapters')).not.toContain('### Scene:')
    const scenes = stageSystem('scenes')
    expect(scenes).toContain('As many scenes as the chapter needs')
    expect(scenes).not.toMatch(/^## Chapter:/m)
    expect(stageSystem('scene')).toContain('Exactly one scene card')
    // The Story builder's rules and a premise line for a story with none.
    const story = stageSystem('acts', { extra: ['The author’s idea comes first.'], withPremise: true })
    expect(story).toContain('Premise: <two or three sentences')
    expect(story).toContain('Rules:\n- The author’s idea comes first.')
  })

  it('says in plain words how much, and where it goes', () => {
    expect(stageAsk('acts', { acts: 3, chapters: 24, start: stageStart({ chapters: 0, lastAct: null, newActs: true }) })).toBe(
      'Suggest 3 acts, with about 24 chapters in all across them. Only the acts, each with its purpose and its rough number of chapters. The story has nothing written or planned yet: start it from the premise.'
    )
    expect(stageAsk('chapters', { chapters: 4, title: 'The Arrival', kept: true })).toBe(
      'Suggest the chapters of the act “The Arrival” (it is in the story already): about 4 chapters, each with its goal and card. No scenes yet.'
    )
    expect(stageAsk('scenes', { title: 'Rain', latestWhen: 'Day 3, dusk' })).toContain('Suggest the scenes of the chapter “Rain”: as many as it needs')
    expect(stageAsk('scenes', { title: 'Rain', latestWhen: 'Day 3, dusk' })).toContain('“Day 3, dusk”')
  })

  it('keeps every reply small: a long book’s acts, an act’s chapters, a chapter’s scenes', () => {
    expect(stageReplyTokens('acts', 6)).toBe(910)
    expect(stageReplyTokens('chapters', 15)).toBe(2800)
    expect(stageReplyTokens('scenes', 1)).toBe(1660)
    expect(stageReplyTokens('scene', 1)).toBe(700)
    // Eight scene cards as a model writes them fit the scenes stage's room.
    const card = `### Scene: The Ledger Under the Floor\nWhen: Day 3, late evening\nSummary: Wren searches the burned counting room and finds a page of the missing ledger.\nSets up: Who burned the warehouses\n- Wren slips past the night watch\n- Scorch marks start inside the locked room\n- A loose board hides a singed page\n- Odo arrives with a lantern\n- Boots sound on the stair below\n`
    expect(estimateTokens(Array(8).fill(card).join('\n'))).toBeLessThan(stageReplyTokens('scenes', 1))
  })

  it('reads the title of the part to plan, and shortens the outline to its headings', () => {
    expect(headingTitle('## Chapter: Rain on the Narrows (plan this one)\nGoal: x')).toBe('Rain on the Narrows')
    expect(headingTitle('# Act: The Arrival [#a0] (in the story)')).toBe('The Arrival')
    expect(headingsOnly('# Act: A\nPurpose: p\nChapters: 3\n## Chapter: B\nGoal: g\nWhen: Day 1\n### Scene: C\n- beat')).toBe(
      '# Act: A\nPurpose: p\nChapters: 3\n## Chapter: B\nGoal: g\n### Scene: C'
    )
  })
})

describe('asking for a stage', () => {
  it('asks for the acts first, told the story, its threads and its cast; the fake gives acts with chapter counts', async () => {
    const w = dbWorld()
    const storyId = w.id('b1')
    const record = await run(
      (emit) => startStageJob({ db: w.db, model: model(), emit }, { taskId: 't1', storyId, level: 'acts', premise: 'Mara hunts the arsonist.', acts: 3, chapters: 9 }),
      w.db
    )
    expect(record.job).toBe('outline')
    expect(record.status).toBe('complete')
    const [system, user] = record.messages
    expect(system.content.startsWith(`${MARKER} stage acts`)).toBe(true)
    expect(user.content).toContain('Premise: Mara hunts the arsonist.')
    expect(user.content).toContain('## Open plot threads\n- Who burned the mill?')
    expect(user.content).toContain('Suggest 3 acts, with about 9 chapters in all')
    expect(record.response).toContain('# Act: The Arrival\nPurpose:')
    expect(record.response).toContain('Chapters: 3')
    expect(record.response).not.toContain('## Chapter:')
  })

  it('asks for one act’s chapters with the outline being planned, and one chapter’s scenes from the story', async () => {
    const w = dbWorld()
    const storyId = w.id('b1')
    const plan = '# Act: The Arrival (plan this one)\nPurpose: Mara reaches the city.\nChapters: 2\n\n# Act: The Turning\nPurpose: Her loyalties split.'
    const chapters = await run(
      (emit) =>
        startStageJob(
          { db: w.db, model: model(), emit },
          { taskId: 't2', storyId, level: 'chapters', chapters: 2, plan, target: '# Act: The Arrival\nPurpose: Mara reaches the city.\nChapters: 2' }
        ),
      w.db
    )
    expect(chapters.messages[0].content.startsWith(`${MARKER} stage chapters`)).toBe(true)
    expect(chapters.messages[1].content).toContain('## The outline being planned')
    expect(chapters.messages[1].content).toContain('## The act to plan\n# Act: The Arrival')
    expect(chapters.messages[1].content).toContain('Suggest the chapters of the act “The Arrival”: about 2 chapters')
    expect(chapters.response.match(/^## Chapter:/gm)).toHaveLength(2)
    expect(chapters.response).not.toContain('### Scene:')
    expect(chapters.direction).toBe('Outline in stages: plan the chapters of “The Arrival”')

    // A chapter in the story already: its scenes so far and the chapters around it come from the story.
    const chapterId = repo.getOutline(w.db, storyId).chapters[0].id
    repo.updateChapter(w.db, chapterId, { title: 'Lanterns at Low Tide', goal: 'Mara follows the trail.' })
    const scenes = await run(
      (emit) => startStageJob({ db: w.db, model: model(), emit }, { taskId: 't3', storyId, level: 'scenes', chapterId, target: '## Chapter: Lanterns at Low Tide' }),
      w.db
    )
    expect(scenes.messages[1].content).toContain('## The chapter to plan, as the story has it')
    expect(scenes.messages[1].content).toContain('THE CHAPTER TO PLAN')
    expect(scenes.messages[1].content).toContain('Suggest the scenes of the chapter “Lanterns at Low Tide” (it is in the story already)')
    // The fake gives "Lanterns at Low Tide" four scenes (no fixed count), and no chapter heading.
    expect(scenes.response.match(/^### Scene:/gm)).toHaveLength(4)
    expect(scenes.response).not.toContain('## Chapter:')
  })

  it('plans one scene’s card from where it sits', async () => {
    const w = dbWorld()
    const storyId = w.id('b1')
    const sceneId = repo.getOutline(w.db, storyId).scenes[0].id
    const record = await run((emit) => startStageJob({ db: w.db, model: model(), emit }, { taskId: 't4', storyId, level: 'scene', sceneId }), w.db)
    expect(record.sceneId).toBe(sceneId)
    expect(record.messages[0].content.startsWith(`${MARKER} stage scene`)).toBe(true)
    expect(record.messages[1].content).toContain('## Where this scene is')
    expect(record.messages[1].content).toContain('Plan this scene: one scene card')
    expect(record.response).toContain('### Scene: The visitor at the gate')
  })

  it('says so in plain words before asking more than the model can answer, or a level it doesn’t know', () => {
    const w = dbWorld()
    const storyId = w.id('b1')
    const deps = { db: w.db, model: model({ maxOutput: 500 }), emit: () => undefined }
    expect(() => startStageJob(deps, { taskId: 't5', storyId, level: 'chapters', chapters: 6 })).toThrow(UserError)
    expect(() => startStageJob(deps, { taskId: 't6', storyId, level: 'everything' as 'acts' })).toThrow('That part of the outline can’t be planned')
  })
})

describe('the Plan hub’s requests (2026-10-20)', () => {
  it('asks for the next scene right after the last scene written, told how it ends, with Adam’s words last', async () => {
    const w = dbWorld()
    const storyId = w.id('b1')
    const o = repo.getOutline(w.db, storyId)
    const chapterId = o.chapters[0].id
    const last = o.scenes.filter((s) => s.chapterId === chapterId)[0]
    repo.updateChapter(w.db, chapterId, { title: 'Rain on the Narrows' })
    repo.updateScene(w.db, last.id, { title: 'The ferry' })
    repo.saveSceneText(w.db, last.id, null, 'Mara paid the ferryman twice and watched the far bank until the fog took it.')
    const direction = 'They cross at night, and someone on the far bank is waiting.\n\nBring back this plot thread: Who burned the mill? (open since Ch 1).'
    const record = await run(
      (emit) =>
        startStageJob(
          { db: w.db, model: model(), emit },
          { taskId: 'h1', storyId, level: 'scenes', chapterId, afterSceneId: last.id, count: 1, direction }
        ),
      w.db
    )
    const [system, user] = record.messages
    expect(system.content).toContain('Rules:\n- What the author wants comes first')
    expect(system.content).toContain('- Exactly one scene, no more.')
    expect(user.content).toContain('## How the last scene written ends\nMara paid the ferryman twice')
    // His words come last of all, just before what is asked.
    expect(user.content).toContain(`## What the author wants (make it happen)\n${direction}\n\n## What to suggest`)
    expect(user.content).toContain('Suggest exactly 1 scene of the chapter “Rain on the Narrows” (it is in the story already): the one that comes right after “The ferry” (Ch 1, Sc 1), the last scene written.')
    // What the AI saw says what Adam asked, in his words.
    expect(record.direction).toBe(direction)
    // The fake gives exactly one.
    expect(record.response.match(/^### Scene:/gm)).toHaveLength(1)
  })

  it('asks for the rest of an act after the chapter being written', () => {
    expect(stageAsk('chapters', { chapters: 3, title: 'The Arrival', kept: true, after: '“The Ford” (Ch 4), the chapter being written' })).toBe(
      'Suggest the chapters of the act “The Arrival” (it is in the story already) that come after “The Ford” (Ch 4), the chapter being written, to the end of the act: about 3 chapters, each with its goal and card. No scenes yet. Carry on from where the story has got to; never retell it.'
    )
    expect(stageAsk('scenes', { title: 'Rain', kept: true, after: 'the scene (Ch 2, Sc 3), the last scene written' })).toBe(
      'Suggest the scenes of the chapter “Rain” (it is in the story already) that come after the scene (Ch 2, Sc 3), the last scene written: as many as it still needs to do what it is for, each a scene card. They carry on from how that scene ends and never retell it.'
    )
  })

  it('carries the days on from the last scene written, not from a plan further on', () => {
    const scene = (id: string, when: string) => ({ id, title: id, summary: '', goal: '', beats: [], when, words: 0 })
    const plan = [
      {
        id: null,
        title: '',
        purpose: '',
        chapters: [
          { id: 'c1', title: 'One', goal: '', summary: '', scenes: [scene('s1', 'Day 3, morning'), scene('s2', '')] },
          { id: 'c2', title: 'Two', goal: '', summary: '', scenes: [scene('s3', 'Day 1, morning')] }
        ]
      }
    ]
    expect(latestUpTo(plan, 's2')).toBe('Day 3, morning')
    expect(latestUpTo(plan, 's3')).toBe('Day 1, morning')
    expect(latestUpTo(plan, 'gone')).toBe('Day 1, morning')
  })

  it('leaves the request as it was when nothing of the hub’s is given', async () => {
    const w = dbWorld()
    const storyId = w.id('b1')
    const chapterId = repo.getOutline(w.db, storyId).chapters[0].id
    const record = await run((emit) => startStageJob({ db: w.db, model: model(), emit }, { taskId: 'h2', storyId, level: 'scenes', chapterId }), w.db)
    expect(record.messages[1].content).not.toContain('What the author wants')
    expect(record.messages[1].content).not.toContain('How the last scene written ends')
    expect(record.messages[0].content).not.toContain('What the author wants comes first')
  })
})

describe('keeping where Adam chose', () => {
  it('puts a chapter among the chapters with no act when he chose that, even in a story with acts', async () => {
    const { keepOutline } = await import('./structure')
    const acts = await import('../db/acts')
    const w = dbWorld()
    const storyId = w.id('b1')
    const first = repo.getOutline(w.db, storyId).chapters[0]
    repo.updateChapter(w.db, first.id, { goal: 'Mara lands.' })
    const act = acts.createAct(w.db, storyId, { title: 'The Turning' })
    const kept = keepOutline(w.db, storyId, [{ key: 'c0', kind: 'chapter', title: 'Before it all', text: '', parent: { id: null }, after: { id: first.id } }])
    const made = repo.getChapter(w.db, kept[0].id)
    expect(made.actId).toBeNull()
    // Left out, a chapter still goes into the story's last act, as it always has.
    const last = keepOutline(w.db, storyId, [{ key: 'c1', kind: 'chapter', title: 'At the end', text: '' }])
    expect(repo.getChapter(w.db, last[0].id).actId).toBe(act.id)
    const order = repo.getOutline(w.db, storyId).chapters.map((c) => c.title)
    expect(order.indexOf('Before it all')).toBe(order.indexOf(first.title) + 1)
  })
})
