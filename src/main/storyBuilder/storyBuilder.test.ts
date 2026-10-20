// The Story builder (2026-10-17): the brief kept and told to the AI, the codex list read, settled and talked over,
// an item redone, the outline planned from the idea, and a recipe talked over and redone. Invented stories only.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AppEvents } from '@shared/api'
import type { CodexItem, StoryBrief } from '@shared/contracts/storyBuilder'
import { emptyBrief } from '@shared/contracts/storyBuilder'
import * as repo from '../db/repo'
import * as gens from '../db/generations'
import type { JobModel } from '../ai/jobModel'
import { startFakeProvider, type FakeProvider } from '../../../tests/fake-provider/server.mjs'
import { memoryWorld } from '../../../tests/unit/helpers'
import { emptyParts } from '../recipes/parse'
import { briefText, cleanBrief, readBrief, recipeAsUsed, writeBrief } from './brief'
import { buildSummary, carryOver, planOf, readCodex, readRedo, settleList } from './codex'
import { LIST_LINE, PLAN_LINE, splitAnswer } from './prompts'
import { planStoryCodex, recipeChat, redoCodexItem, redoRecipePart, startPlanChat, startStoryOutline, storyCodexChat, type StoryDeps } from './jobs'

let fake: FakeProvider
beforeAll(async () => {
  fake = await startFakeProvider({ delayMs: 0 })
})
afterAll(() => fake.close())

const model = (): JobModel => ({
  job: 'chat',
  target: { id: 'p1', name: 'Fake', kind: 'custom', baseUrl: fake.url, apiKey: 'k' },
  choice: { providerId: 'p1', modelId: 'fake/writer', label: 'Fake', contextLength: 64000, promptPrice: null, completionPrice: null },
  thinking: 'off'
})

const item = (o: Partial<CodexItem>): CodexItem => ({
  key: '',
  kind: 'character',
  name: '',
  aliases: [],
  about: '',
  in: '',
  rule: false,
  when: '',
  role: '',
  mine: false,
  on: true,
  existing: null,
  ...o
})

function world(brief: Partial<StoryBrief> = {}) {
  const db = memoryWorld()
  const story = repo.createStory(db, { title: 'The Keeper of Gull Harbour' })
  const b = { ...emptyBrief(), plot: 'A lighthouse keeper’s daughter has one winter to find who is wrecking ships.', ...brief }
  writeBrief(db, story.id, b)
  let done = false
  const deps: StoryDeps = {
    db,
    model: model(),
    emit: (name: keyof AppEvents) => void (done ||= name === 'task:done'),
    readRecipe: () => ({ name: 'A coastal mystery', parts: { ...emptyParts(), cast: '- The lead: an outsider who learns to stay.', shape: '- Act one: the arrival.' } })
  }
  const waitDone = async (): Promise<void> => {
    const t0 = Date.now()
    while (!done) {
      if (Date.now() - t0 > 10_000) throw new Error('The job never finished')
      await new Promise((r) => setTimeout(r, 10))
    }
    done = false
  }
  return { db, story, deps, brief: readBrief(db, story.id), waitDone }
}

describe('the brief', () => {
  it('is kept in the world and cleaned whenever it is read', () => {
    const { db, story } = world({ mine: [{ kind: 'character', name: 'Ida Marr', about: 'The lighthouse keeper.' }], length: 'novella' })
    const b = readBrief(db, story.id)
    expect(b.plot).toContain('wrecking ships')
    expect(b.mine).toEqual([{ kind: 'character', name: 'Ida Marr', about: 'The lighthouse keeper.' }])
    expect(b.length).toBe('novella')
    // A hand-edited one never breaks it.
    repo.setMeta(db, `story_brief:${story.id}`, '{"plot": 3, "length": "epic", "mine": [null, {"name": "Tam"}]}')
    expect(readBrief(db, story.id)).toMatchObject({ plot: '', length: '', mine: [{ kind: 'character', name: 'Tam', about: '' }] })
    repo.setMeta(db, `story_brief:${story.id}`, 'not json')
    expect(readBrief(db, story.id)).toEqual(emptyBrief())
  })

  it('tells the AI the plot in the author’s words, with their own entries kept exactly', () => {
    const text = briefText(
      cleanBrief({ plot: 'Ships keep wrecking.', mustHappen: 'The light goes out twice.', avoid: 'No ghosts.', mine: [{ kind: 'place', name: 'Gull Harbour', about: 'A harbour town.' }] }),
      { title: 'Untitled story', premise: '' }
    )
    expect(text).toContain("The plot, in the author's own words:\nShips keep wrecking.")
    expect(text).toContain('Must happen: The light goes out twice.')
    expect(text).toContain('Must never happen or appear: No ghosts.')
    expect(text).toContain('- Gull Harbour (place): A harbour town.')
    expect(text).not.toContain('Title:')
  })

  it('uses the recipe with the story’s own changes on top', () => {
    const r = { name: 'R', parts: { ...emptyParts(), tone: 'Quiet', pacing: 'Slow' } }
    expect(recipeAsUsed(r, cleanBrief({ recipe: { id: 'r1', tweaks: { tone: 'Dark' } } }))?.parts).toMatchObject({ tone: 'Dark', pacing: 'Slow' })
    expect(recipeAsUsed(r, emptyBrief())).toBeNull()
  })
})

describe('the codex list', () => {
  it('reads the AI’s lists with each character’s recipe role', () => {
    const list = readCodex('Here: {"characters": [{"name": "Ada Lorne", "about": "The lead.", "role": "The lead"}], "places": [{"name": "Gull Harbour", "in": "The Grey Coast"}], "events": [{"name": "The Wreck", "when": "Day 2"}]}')!
    expect(list.map((i) => [i.kind, i.name, i.role, i.in, i.when])).toEqual([
      ['character', 'Ada Lorne', 'The lead', '', ''],
      ['place', 'Gull Harbour', '', 'The Grey Coast', ''],
      ['event', 'The Wreck', '', '', 'Day 2']
    ])
    expect(readCodex('Sorry, I can’t.')).toBeNull()
  })

  it('keeps the author’s own first (one the AI left out first of all) and as written, marks what the world has, and keys every item', () => {
    const settled = settleList(
      [item({ name: 'Ada Lorne' }), item({ name: 'ada lorne', about: 'Again' }), item({ kind: 'place', name: 'Saltmarsh' })],
      [
        { kind: 'character', name: 'Ida Marr', about: 'The keeper.' },
        { kind: 'character', name: 'Ada Lorne', about: 'Her daughter.' }
      ],
      [{ id: 'e1', kind: 'place', name: 'Saltmarsh', aliases: [] }]
    )
    expect(settled.map((i) => [i.kind, i.name, i.mine])).toEqual([
      ['character', 'Ida Marr', true],
      ['character', 'Ada Lorne', true],
      ['place', 'Saltmarsh', false]
    ])
    // The author's words first, then the AI's (the same character named twice is one).
    expect(settled[1].about).toBe('Her daughter. Again')
    expect(settled.find((i) => i.name === 'Saltmarsh')?.existing).toEqual({ entryId: 'e1', name: 'Saltmarsh' })
    expect(new Set(settled.map((i) => i.key)).size).toBe(3)
  })

  it('carries ticks and keys over to a revised list, and keeps the author’s own name on a redo', () => {
    const before = [item({ key: 'k1', name: 'Bram Holt', on: false }), item({ key: 'k2', name: 'Ada Lorne', mine: true })]
    const after = carryOver([item({ name: 'Bram Holt', about: 'Changed' }), item({ name: 'Corin Vale' })], before)
    expect(after.map((i) => [i.key, i.name, i.on])).toEqual([
      ['k1', 'Bram Holt', true],
      ['', 'Corin Vale', true]
    ])
    expect(readRedo('{"name": "Adeline", "about": "New"}', before[1])).toMatchObject({ key: 'k2', name: 'Ada Lorne', about: 'New', mine: true })
    expect(readRedo('no', before[1])).toBeNull()
  })

  it('gives the World builder the ticked items, each on a line starting with its name', () => {
    const items = [item({ name: 'Ada Lorne', about: 'The lead', role: 'The lead' }), item({ kind: 'place', name: 'Gull Harbour', about: 'A town.', on: false })]
    expect(planOf(items).map((p) => p.name)).toEqual(['Ada Lorne'])
    const summary = buildSummary('The idea.', 'Genre: Mystery', '', items)
    expect(summary).toContain("Ada Lorne (plays the recipe's The lead): The lead.")
    expect(summary).not.toContain('Gull Harbour')
  })

  it('splits a talk’s answer from what it revised', () => {
    expect(splitAnswer(`Done.\n${LIST_LINE}\n{"a":1}`, LIST_LINE)).toEqual({ answer: 'Done.', rest: '\n{"a":1}' })
    expect(splitAnswer('Done.\n**Revised plan**\n## Chapter: X', PLAN_LINE)).toEqual({ answer: 'Done.', rest: '\n## Chapter: X' })
    expect(splitAnswer('Just an answer.', PLAN_LINE)).toEqual({ answer: 'Just an answer.', rest: null })
  })
})

describe('the AI calls', () => {
  it('plans the codex from the idea, with the author’s own and the recipe’s role', async () => {
    const t = world({ mine: [{ kind: 'character', name: 'Ida Marr', about: 'The keeper.' }], recipe: { id: 'r1', tweaks: {} } })
    const out = await planStoryCodex(t.deps, { taskId: 'c1', storyId: t.story.id }, t.brief)
    expect(out.status).toBe('complete')
    const names = out.items.map((i) => i.name)
    expect(names).toEqual(expect.arrayContaining(['Ida Marr', 'Ada Lorne', 'Bram Holt', 'Gull Harbour', 'The Wreck', 'Who wrecks the ships']))
    expect(out.items.find((i) => i.name === 'Ida Marr')?.mine).toBe(true)
    expect(out.items.find((i) => i.name === 'Ada Lorne')?.role).toBe('The lead')
    const record = gens.getGeneration(t.db, out.generationId!)
    expect(record.messages[1].content).toContain('wrecking ships')
    expect(record.messages[1].content).toContain('### Cast roles')
  })

  it('refuses to plan with no plot, in plain words', async () => {
    const t = world({ plot: '' })
    await expect(planStoryCodex(t.deps, { taskId: 'c0', storyId: t.story.id }, t.brief)).rejects.toThrow(/Write your plot first/)
  })

  it('talks the list over: a question gets an answer, a change gets a revised list as a preview', async () => {
    const t = world()
    const items = settleList([item({ name: 'Ada Lorne' }), item({ name: 'Bram Holt', on: false })], [], [])
    const q = await storyCodexChat(t.deps, { taskId: 'q1', storyId: t.story.id, items, history: [], message: 'Who is the lead?' }, t.brief)
    expect(q).toMatchObject({ status: 'complete', items: null })
    expect(q.answer).toContain('Ada Lorne')
    const c = await storyCodexChat(t.deps, { taskId: 'q2', storyId: t.story.id, items, history: [], message: 'Add a rival' }, t.brief)
    expect(c.answer).toBe('I added a rival salvager, Corin Vale.')
    expect(c.items?.map((i) => i.name)).toEqual(['Ada Lorne', 'Bram Holt', 'Corin Vale'])
    // The unticked item stays as it was, with its key.
    expect(c.items?.find((i) => i.name === 'Bram Holt')?.key).toBe(items[1].key)
  })

  it('redoes one item with the note', async () => {
    const t = world()
    const items = settleList([item({ name: 'Bram Holt', about: 'A salvager.' })], [], [])
    const r = await redoCodexItem(t.deps, { taskId: 'r1', storyId: t.story.id, items, key: items[0].key, note: 'make him kinder' }, t.brief)
    expect(r.status).toBe('complete')
    expect(r.item).toMatchObject({ key: items[0].key, name: 'Bram Holt' })
    expect(r.item?.about).toContain('Redone: make him kinder.')
  })

  it('plans the outline from the idea and the codex, with a premise for a story with none', async () => {
    const t = world()
    const { generationId } = startStoryOutline(t.deps, { taskId: 'o1', storyId: t.story.id, size: { acts: 0, chapters: 2, scenes: 2 } }, t.brief)
    await t.waitDone()
    const record = gens.getGeneration(t.db, generationId)
    expect(record.messages[0].content).toContain('Premise: <')
    expect(record.messages[1].content).toContain("## The author's idea for the story")
    expect(record.response).toMatch(/^Premise: /)
    expect(record.response).toContain('## Chapter: Grey Water')
  })

  it('talks a plan over and gives the whole plan back after its line', async () => {
    const t = world()
    const current = '## Chapter: Grey Water\nGoal: X\n\n### Scene: One\nWhen: Day 1, morning\n- a beat'
    const { generationId } = startPlanChat(t.deps, { taskId: 'p1', storyId: t.story.id, current, history: [{ role: 'user', text: 'Hi' }, { role: 'assistant', text: 'Hello' }], message: 'Make it a betrayal' }, t.brief)
    await t.waitDone()
    const record = gens.getGeneration(t.db, generationId)
    expect(record.response).toContain(PLAN_LINE)
    expect(record.response).toContain('## Chapter: The Betrayal')
    expect(record.response).toContain('### Scene: One')
  })

  it('talks a recipe over and redoes a part', async () => {
    const t = world()
    const parts = { ...emptyParts(), tone: 'Quiet', shape: 'Three acts.' }
    const c = await recipeChat(t.deps, { taskId: 'rc', parts, history: [], message: 'Darker please' })
    expect(c).toMatchObject({ status: 'complete', answer: 'I made the tone darker.', parts: { tone: 'Dark and tense' } })
    const q = await recipeChat(t.deps, { taskId: 'rq', parts, history: [], message: 'What is the tone?' })
    expect(q.parts).toBeNull()
    const r = await redoRecipePart(t.deps, { taskId: 'rr', parts, part: 'shape', note: '' })
    expect(r).toMatchObject({ status: 'complete', text: 'A new take on this part.' })
  })
})

// Chat truth R2, R6: each talk is told it can't change anything itself and what it can change; a reply whose list or
// parts don't read (or change nothing) brings no preview and says why.
describe('the talks tell the truth', () => {
  it('tells each talk it suggests, never claims, and what it can change', async () => {
    const { codexChatSystem, planChatSystem, recipeChatSystem } = await import('./prompts')
    for (const system of [planChatSystem(), recipeChatSystem(), codexChatSystem()]) {
      expect(system).toContain('You can\'t change anything yourself')
      expect(system).toContain('a preview the author applies')
      expect(system).toMatch(/Never say you changed, updated/)
    }
    expect(planChatSystem()).toContain('you can change only the suggestions')
    expect(planChatSystem()).toContain('Chapters and scenes already in the story can’t be changed from this talk')
    expect(recipeChatSystem()).toContain('you can change only the recipe’s parts')
    expect(codexChatSystem()).toContain('you can change only the planned cast list')
  })

  it('a list or parts that don’t read bring no preview, with the reason, not the raw reply', async () => {
    const t = world()
    t.deps.model = { ...t.deps.model, choice: { ...t.deps.model.choice, modelId: 'fake/talk-unreadable' } }
    const items = settleList([item({ name: 'Ada Lorne' })], [], [])
    const c = await storyCodexChat(t.deps, { taskId: 'u1', storyId: t.story.id, items, history: [], message: 'Add a rival' }, t.brief)
    expect(c).toMatchObject({ status: 'complete', items: null, reason: 'its reply didn’t read as a list', answer: 'I’ve added a rival salvager.' })
    const r = await recipeChat(t.deps, { taskId: 'u2', parts: { ...emptyParts(), tone: 'Quiet' }, history: [], message: 'Darker please' })
    expect(r).toMatchObject({ status: 'complete', parts: null, reason: 'its reply didn’t read as recipe parts', answer: 'I’ve made the tone darker.' })
  })

  it('parts the same as before are no change', async () => {
    const t = world()
    const r = await recipeChat(t.deps, { taskId: 'u3', parts: { ...emptyParts(), tone: 'Dark and tense' }, history: [], message: 'Darker please' })
    expect(r).toMatchObject({ parts: null, reason: 'the parts it sent are the same as before' })
    const q = await recipeChat(t.deps, { taskId: 'u4', parts: emptyParts(), history: [], message: 'What is the tone?' })
    expect(q.reason).toBeNull()
  })
})
