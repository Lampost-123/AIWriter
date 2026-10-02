// The automatic story flows (spec, Multi-story rules: "Automatic flows"): what changed in a time gap, a
// prequel's starting cast and "When did these happen?", against the fixed test world and the fake
// provider (tests/fake-provider: its story flow replies are fixed, see fakeStoryFlowReply).

import type Database from 'better-sqlite3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Change, ChangeData, ID } from '@shared/types'
import type { StoryFlowStatus } from '@shared/contracts/storyFlows'
import { defaultWritingPrefs } from '@shared/defaults'
import { dbWorld } from '../../../tests/unit/testWorld'
import { startFakeProvider, type FakeProvider } from '../../../tests/fake-provider/server.mjs'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import * as kdb from '../db/keeper'
import * as fdb from '../db/storyFlows'
import { loadMemoryData, loadShape } from '../memory/scene'
import { answerItem, undoItem } from '../keeper/undo'
import { BROKEN_REPLY, EMPTY_REPLY, flowFailure, NO_FLOW_MODEL, REFUSED, REPLY_TOO_LONG, TOO_MUCH, type FlowModel } from './call'
import { ShortIds, stateAtStart } from './context'
import { gapPhrase, NO_GAP, NOT_PREQUEL, runStartingCast, runTimeGap, runWhen, STOPPED, type JobOptions } from './jobs'
import { applyGap, OPEN_AGAIN, TAKEN_OUT } from './apply'
import { flowPlace, flowRuns, GONE, STILL_OPEN, WHEN } from './lines'
import { readWhen } from './parse'
import { FlowRunner } from './runner'

type DB = Database.Database

let fake: FakeProvider
beforeAll(async () => {
  fake = await startFakeProvider({ delayMs: 0 })
})
afterAll(() => fake.close())

const model = (): FlowModel => ({
  target: { id: 'p1', name: 'Fake', kind: 'custom', baseUrl: fake.url, apiKey: 'test' },
  choice: { providerId: 'p1', modelId: 'fake/memory', label: 'Fake', contextLength: 32000, promptPrice: null, completionPrice: null }
})

const opts = (db: DB, extra: Partial<JobOptions> = {}): JobOptions => ({
  db,
  model,
  prefs: defaultWritingPrefs(),
  signal: new AbortController().signal,
  closed: () => false,
  retryDelays: [0, 0],
  ...extra
})

const count = (db: DB, table: string): number => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n
const live = (db: DB, id: ID): Change | null => {
  try {
    return mem.getChange(db, id)
  } catch {
    return null
  }
}
const lineFor = (db: DB, changeId: ID): kdb.LogRow => {
  const l = fdb.linesAboutChange(db, changeId).at(-1)
  if (!l) throw new Error('No line for that change')
  return kdb.getLog(db, l.id)!
}

/** The test world with a new story 300 years after Book 4, and a plot thread still open at Book 4's end. */
function gapWorld() {
  const w = dbWorld()
  const db = w.db
  const story = repo.createStory(db, { title: 'The Far Shore', seriesId: w.id('dark'), startStoryId: w.id('b4') })
  repo.updateStory(db, story.id, { timeGap: '300 years', premise: 'A sailor finds the old Reach.' })
  const crown = repo.createEntry(db, 'thread', { name: 'The lost crown' }, { origin: 'adam' })
  mem.insertChange(db, {
    kind: 'thread',
    payload: { status: 'open', note: 'The crown goes missing.' },
    entryId: crown.id,
    anchor: 'scene',
    storyId: null,
    sceneId: w.id('b4.c1.s1'),
    origin: 'adam'
  })
  return { ...w, storyId: story.id, crownId: crown.id }
}

const startState = (db: DB, storyId: ID) => stateAtStart(loadShape(db), loadMemoryData(db), storyId)

describe('What changed before this story starts?', () => {
  it('adds changes at the start, drafted by AI and listed under What changed, and closes open threads with a question', async () => {
    const w = gapWorld()
    const before = kdb.memoryCounts(w.db)
    const readBefore = kdb.scenesToRead(w.db)
    const r = await runTimeGap(opts(w.db), w.storyId)
    expect(r).toMatchObject({ status: 'done', message: 'Added 2 changes and closed 1 plot thread, listed under What changed' })

    const changes = fdb.startChanges(w.db, w.storyId)
    expect(changes.map((c) => [c.entryId, c.kind, c.origin])).toEqual([
      [w.id('mara'), 'update', 'ai'],
      [w.id('mill'), 'update', 'ai'],
      [w.crownId, 'thread', 'ai']
    ])
    const state = startState(w.db, w.storyId)
    expect(state.entries.get(w.id('mara'))!.happened.map((h) => h.note)).toContain('died long ago')
    expect(state.threads.find((t) => t.entryId === w.crownId)?.status).toBe('resolved')

    const lines = fdb.flowLines(w.db)
    expect(lines.map((l) => [l.entryName, l.text, l.after])).toEqual([
      ['Mara', 'Died long ago', ''],
      // New field values are named as the entry page names them.
      ['Harrow Mill', 'Fell into ruin', 'Who rules or lives there: Nobody now but crows'],
      ['The lost crown', 'Plot thread left unanswered', '']
    ])
    expect(lines[2].question).toEqual({ ...STILL_OPEN, answer: 'unanswered' })
    expect(lines.every((l) => l.sceneId === null)).toBe(true)

    const runs = flowRuns(w.db, loadShape(w.db))
    expect(runs).toHaveLength(1)
    expect(runs[0].heading).toBe('Before The Far Shore starts')
    expect(Object.values(runs[0].places)).toEqual(['Start of The Far Shore', 'Start of The Far Shore', 'Start of The Far Shore'])

    // A record of what the AI saw, for no scene. The run is finished (nothing for the keeper to stop
    // when the world opens), belongs to no scene coming back from the Trash, and adds no scene to read.
    const gens = w.db.prepare('SELECT scene_id, job, status FROM generations').all()
    expect(gens).toEqual([{ scene_id: '', job: 'story', status: 'complete' }])
    expect(kdb.getRun(w.db, runs[0].runId)).toMatchObject({ status: 'done' })
    expect(kdb.stopUnfinishedRuns(w.db)).toBe(0)
    expect(kdb.scenesBackFromTrash(w.db)).toEqual([])
    expect(kdb.scenesToRead(w.db)).toEqual(readBefore)
    expect(kdb.memoryCounts(w.db)).toEqual(before)
    expect(kdb.lastUpdate(w.db)).toMatchObject({ runId: runs[0].runId, changes: 3 })
    expect(kdb.listLog(w.db, { limit: 10 }).map((l) => l.id).sort()).toEqual(lines.map((l) => l.id).sort())
  })

  it('answers "Still open?" any time, and Undo restores exactly what was there', async () => {
    const w = gapWorld()
    await runTimeGap(opts(w.db), w.storyId)
    const [mara, , thread] = fdb.startChanges(w.db, w.storyId)
    const threadOpen = (): string | undefined => startState(w.db, w.storyId).threads.find((t) => t.entryId === w.crownId)?.status

    answerItem(w.db, lineFor(w.db, thread.id).id, 'open')
    expect(live(w.db, thread.id)).toBeNull()
    expect(threadOpen()).toBe('open')
    expect(lineFor(w.db, thread.id).question?.answer).toBe('open')
    answerItem(w.db, lineFor(w.db, thread.id).id, 'unanswered')
    expect(live(w.db, thread.id)?.origin).toBe('ai')
    expect(threadOpen()).toBe('resolved')

    undoItem(w.db, lineFor(w.db, mara.id).id)
    expect(live(w.db, mara.id)).toBeNull()
    expect(lineFor(w.db, mara.id).undone).toBe(true)
    expect(startState(w.db, w.storyId).entries.get(w.id('mara'))!.happened.map((h) => h.note)).not.toContain('died long ago')
    expect(() => answerItem(w.db, lineFor(w.db, mara.id).id, 'open')).toThrow("doesn't ask")
  })

  it('worked out again, replaces only what it drafted before and keeps what Adam made', async () => {
    const w = gapWorld()
    await runTimeGap(opts(w.db), w.storyId)
    // The same gap again: nothing new.
    const again = await runTimeGap(opts(w.db), w.storyId)
    expect(again).toMatchObject({ status: 'done', message: 'Nothing needed changing', runId: null })
    expect(fdb.flowRunIds(w.db)).toHaveLength(1)

    // Adam edits the mill's change (it becomes his) and adds one of his own.
    const [mara, mill, thread] = fdb.startChanges(w.db, w.storyId)
    mem.replaceChange(w.db, mill.id, {
      kind: 'update',
      payload: { note: 'burned down again' },
      entryId: mill.entryId,
      anchor: 'story-start',
      storyId: w.storyId,
      origin: 'adam'
    })
    const tobin = mem.insertChange(w.db, {
      kind: 'update',
      payload: { note: 'sailed west' },
      entryId: w.id('tobin'),
      anchor: 'story-start',
      storyId: w.storyId,
      origin: 'adam'
    })

    // Only three weeks after all: the fake model finds nothing changed in that time.
    repo.updateStory(w.db, w.storyId, { timeGap: '3 weeks' })
    const r = await runTimeGap(opts(w.db), w.storyId)
    expect(r).toMatchObject({ status: 'done', message: 'Took out 2 earlier changes, listed under What changed' })
    expect(live(w.db, mara.id)).toBeNull()
    expect(live(w.db, thread.id)).toBeNull()
    expect(live(w.db, mill.id)?.origin).toBe('adam')
    expect(live(w.db, tobin.id)?.origin).toBe('adam')
    // What each was shows struck through under what happened to it.
    const removed = fdb.flowLines(w.db).filter((l) => l.action === 'removed')
    expect(removed.map((l) => [l.text, l.before])).toEqual([
      ['Taken out when the time gap was worked out again', 'Died long ago'],
      ['Plot thread open again after the time gap was worked out again', 'Plot thread left unanswered']
    ])
    expect([TAKEN_OUT, OPEN_AGAIN]).toEqual(removed.map((l) => l.text))

    // The thread's "Still open?" can still be answered, but never brings back what the new run took out.
    const closedLine = lineFor(w.db, thread.id)
    expect(closedLine.action).toBe('removed')
    const asked = fdb.flowLines(w.db).find((l) => l.factId === thread.id && l.question)!
    answerItem(w.db, asked.id, 'open')
    answerItem(w.db, asked.id, 'unanswered')
    expect(live(w.db, thread.id)).toBeNull()
    // In the first run's lines, both say they are no longer in the memory, with nothing to answer or undo.
    const first = flowRuns(w.db, loadShape(w.db)).find((run) => asked.id in run.places)!
    const maraAdded = fdb.flowLines(w.db).find((l) => l.factId === mara.id && l.action === 'added')!
    expect(first.gone).toEqual([maraAdded.id, asked.id])
    expect([first.places[maraAdded.id], first.places[asked.id], first.places[lineFor(w.db, mill.id).id]]).toEqual([
      GONE,
      GONE,
      'Start of The Far Shore'
    ])

    // Undo brings an earlier one back as it was.
    undoItem(w.db, removed[0].id)
    expect(live(w.db, mara.id)).toMatchObject({ origin: 'ai', storyId: w.storyId, payload: { note: 'died long ago' } })
    expect(flowRuns(w.db, loadShape(w.db)).find((run) => asked.id in run.places)!.gone).toEqual([asked.id])
  })

  it('names fields as the entry page does, and says a change with only fields once', () => {
    const w = gapWorld()
    const story = repo.getStory(w.db, w.storyId)
    const totals = { providerId: null, modelId: null, promptTokens: null, completionTokens: null, cost: null, generationIds: [] }
    const fields = { age: 'would be 240', pastEvents: 'Fell at the siege of Harrow' }
    const plan = { changes: [{ entryId: w.id('mara'), data: { kind: 'update' as const, payload: { note: '', fields } } }], closed: [] }
    applyGap(w.db, story, plan, totals)
    expect(fdb.flowLines(w.db).map((l) => [l.text, l.after])).toEqual([
      ['Age or birth date: would be 240; Key past events: Fell at the siege of Harrow', '']
    ])
  })

  it("doesn't bring back what Adam undid or kept open", async () => {
    const w = gapWorld()
    await runTimeGap(opts(w.db), w.storyId)
    const [mara, , thread] = fdb.startChanges(w.db, w.storyId)
    undoItem(w.db, lineFor(w.db, mara.id).id)
    answerItem(w.db, lineFor(w.db, thread.id).id, 'open')
    const r = await runTimeGap(opts(w.db), w.storyId)
    expect(r).toMatchObject({ status: 'done', message: 'Nothing needed changing' })
    expect(fdb.startChanges(w.db, w.storyId).map((c) => c.entryId)).toEqual([w.id('mill')])
  })

  it('never adds beside a change Adam already has for the same thing', async () => {
    const w = gapWorld()
    mem.insertChange(w.db, {
      kind: 'update',
      payload: { note: 'became a legend' },
      entryId: w.id('mara'),
      anchor: 'story-start',
      storyId: w.storyId,
      origin: 'adam'
    })
    await runTimeGap(opts(w.db), w.storyId)
    const mara = fdb.startChanges(w.db, w.storyId).filter((c) => c.entryId === w.id('mara'))
    expect(mara.map((c) => [c.origin, c.kind === 'update' ? c.payload.note : ''])).toEqual([['adam', 'became a legend']])
  })

  it('needs the time since the previous story', async () => {
    const w = gapWorld()
    repo.updateStory(w.db, w.storyId, { timeGap: '' })
    expect(await runTimeGap(opts(w.db), w.storyId)).toEqual({ status: 'failed', message: NO_GAP })
    expect(count(w.db, 'memory_runs')).toBe(0)
  })
})

describe('Starting cast for a prequel', () => {
  it('drafts a starting description for each character, place, group and item, and makes each exist from the prequel', async () => {
    const w = dbWorld()
    const ym = w.id('ym')
    const original = fdb.startChanges(w.db, ym).find((c) => c.entryId === w.id('mara'))!
    const r = await runStartingCast(opts(w.db), ym, [w.id('mara'), w.id('tobin'), w.id('mill'), w.id('burned')])
    expect(r).toMatchObject({ status: 'done', message: 'Drafted 3 starting descriptions, listed under What changed' })

    const fulls = fdb.startChanges(w.db, ym).filter((c) => c.kind === 'full')
    expect(fulls.map((c) => [c.entryId, c.origin])).toEqual([
      [w.id('mara'), 'ai'],
      [w.id('tobin'), 'ai'],
      [w.id('mill'), 'ai']
    ])
    expect(fulls[1].kind === 'full' && fulls[1].payload.description).toContain('Tobin is young here')
    // The thread isn't part of the cast; Mara's earlier draft (not Adam's) was drafted again.
    expect(fulls[0].id).toBe(original.id)
    const lines = fdb.flowLines(w.db)
    expect(lines.map((l) => [l.entryName, l.action, l.text])).toEqual([
      ['Mara', 'updated', 'Starting description, drafted again by AI'],
      ['Tobin', 'added', 'Starting description, drafted by AI'],
      ['Harrow Mill', 'added', 'Starting description, drafted by AI']
    ])
    expect(flowRuns(w.db, loadShape(w.db))[0]).toMatchObject({ heading: 'Starting cast for Young Mara' })

    // Each exists from the prequel's start, and keeps that when the defaults are worked out again.
    const pre = (entry: string) => mem.listExistsPoints(w.db, w.id(entry)).filter((p) => p.kind === 'story-pre' && p.storyId === ym)
    for (const e of ['mara', 'tobin', 'mill']) expect(pre(e)).toHaveLength(1)
    mem.refreshDefaultExistsPoints(w.db)
    mem.setStoryPlacement(w.db, ym, {
      kind: 'prequel',
      startStoryId: w.id('b1'),
      startAt: 'pre',
      startRefId: null,
      endAt: null,
      endRefId: null,
      leadsIntoId: w.id('b1')
    })
    for (const e of ['mara', 'tobin', 'mill']) expect(pre(e)).toHaveLength(1)
    expect(startState(w.db, ym).entries.has(w.id('mill'))).toBe(true)
  })

  it("skips what Adam wrote, keeps a draft that hasn't changed, and Undo restores", async () => {
    const w = dbWorld()
    const ym = w.id('ym')
    const original = fdb.startChanges(w.db, ym).find((c) => c.entryId === w.id('mara'))!
    await runStartingCast(opts(w.db), ym, [w.id('mara'), w.id('tobin'), w.id('mill')])
    const tobin = fdb.startChanges(w.db, ym).find((c) => c.entryId === w.id('tobin'))!
    mem.replaceChange(w.db, tobin.id, {
      kind: 'full',
      payload: { description: 'A boy who already keeps the ferry.', knows: [], relationships: [] },
      entryId: tobin.entryId,
      anchor: 'story-start',
      storyId: ym,
      origin: 'adam'
    })
    const r = await runStartingCast(opts(w.db), ym, [w.id('tobin'), w.id('mara')])
    expect(r).toMatchObject({ status: 'done', message: 'Nothing needed drafting' })
    expect(live(w.db, tobin.id)).toMatchObject({ origin: 'adam', payload: { description: 'A boy who already keeps the ferry.' } })

    // Undo: Mara's earlier description comes back; the mill's draft and its point go.
    undoItem(w.db, lineFor(w.db, original.id).id)
    expect(live(w.db, original.id)).toMatchObject({ origin: 'ai', payload: original.payload })
    const mill = fdb.startChanges(w.db, ym).find((c) => c.entryId === w.id('mill'))!
    undoItem(w.db, lineFor(w.db, mill.id).id)
    expect(live(w.db, mill.id)).toBeNull()
    expect(mem.listExistsPoints(w.db, w.id('mill')).some((p) => p.storyId === ym)).toBe(false)
  })

  it("goes before the changes at the prequel's start it would otherwise wipe, so Adam's still count", async () => {
    const w = dbWorld()
    const ym = w.id('ym')
    const tobin = w.id('tobin')
    const adams = (data: ChangeData & { entryId: ID }): Change =>
      mem.insertChange(w.db, { ...data, anchor: 'story-start', storyId: ym, origin: 'adam' } as Parameters<typeof mem.insertChange>[1])
    const sworn = adams({
      kind: 'relationship',
      payload: { otherId: w.id('mara'), type: 'sworn brother', feels: '', otherFeels: '' },
      entryId: tobin
    })
    adams({ kind: 'knowledge', payload: { factId: 'f-rope', fact: 'The ferry rope is frayed.' }, entryId: tobin })
    adams({ kind: 'update', payload: { note: 'is twelve', fields: { age: '12' } }, entryId: tobin })
    const pair = (a: ID, b: ID): string | undefined =>
      startState(w.db, ym).relationships.find((r) => [r.aId, r.bId].sort().join() === [a, b].sort().join())?.type
    expect(pair(tobin, w.id('mara'))).toBe('sworn brother')

    await runStartingCast(opts(w.db), ym, [tobin])
    const draft = fdb.startChanges(w.db, ym).find((c) => c.entryId === tobin && c.kind === 'full')!
    expect(draft.origin).toBe('ai')
    // Before Mara's starting description (which names Tobin) and each of Adam's.
    expect(fdb.startChanges(w.db, ym)[0].id).toBe(draft.id)
    expect(draft.position).toBeLessThan(sworn.position)
    const state = startState(w.db, ym)
    expect(pair(tobin, w.id('mara'))).toBe('sworn brother')
    expect(state.entries.get(tobin)!.fields.age).toBe('12')
    expect(state.facts.filter((f) => f.knownBy.includes(tobin)).map((f) => f.fact)).toEqual(['The ferry rope is frayed.'])
  })

  it('keeps every relationship a draft names, on both sides, and those already at the start', async () => {
    const w = dbWorld()
    const ym = w.id('ym')
    repo.updateStory(w.db, ym, { premise: 'Mara as a girl. [[fake: related]]' })
    await runStartingCast(opts(w.db), ym, [w.id('tobin'), w.id('mill')])
    // Tobin's draft names the mill, one way only: the mill's draft gets it the other way round.
    const mill = fdb.startChanges(w.db, ym).find((c) => c.entryId === w.id('mill'))!
    expect(mill.kind === 'full' && mill.payload.relationships).toEqual([
      { otherId: w.id('tobin'), type: 'works at', feels: '', otherFeels: 'proud of it' }
    ])
    const of = (id: ID) =>
      startState(w.db, ym)
        .relationships.filter((r) => r.aId === id || r.bId === id)
        .map((r) => r.type)
        .sort()
    // Mara's starting description, already there, still names Tobin as her neighbour.
    expect(of(w.id('tobin'))).toEqual(['neighbour', 'works at'])
    expect(of(w.id('mill'))).toEqual(['works at'])
  })

  it('drafted again, moves before what it would wipe, and Undo puts it back where it was', async () => {
    const w = dbWorld()
    const ym = w.id('ym')
    const original = fdb.startChanges(w.db, ym).find((c) => c.entryId === w.id('mara'))!
    // A relationship of Adam's that Mara's earlier draft, coming after it, wipes.
    mem.insertChange(w.db, {
      kind: 'relationship',
      payload: { otherId: w.id('tobin'), type: 'rival', feels: '', otherFeels: '' },
      entryId: w.id('mara'),
      anchor: 'story-start',
      storyId: ym,
      origin: 'adam',
      position: original.position - 5
    })
    await runStartingCast(opts(w.db), ym, [w.id('mara')])
    const redrafted = live(w.db, original.id)!
    expect(redrafted.position).toBe(original.position - 6)
    const rel = () => startState(w.db, ym).relationships.find((r) => r.aId === w.id('mara') || r.bId === w.id('mara'))?.type
    expect(rel()).toBe('rival')
    undoItem(w.db, lineFor(w.db, original.id).id)
    expect(live(w.db, original.id)).toMatchObject({ position: original.position, payload: original.payload, origin: 'ai' })
  })

  it('is only for a prequel', async () => {
    const w = dbWorld()
    expect(await runStartingCast(opts(w.db), w.id('b2'), [w.id('mara')])).toEqual({ status: 'failed', message: NOT_PREQUEL })
  })
})

/** Book 2's start, with three changes on it, and a scene of The Quiet Year (which Book 2 now continues after) about the mill. */
function whenWorld() {
  const w = dbWorld()
  const at = (entry: string, note: string, origin: 'adam' | 'ai'): Change =>
    mem.insertChange(w.db, {
      kind: 'update',
      payload: { note },
      entryId: w.id(entry),
      anchor: 'story-start',
      storyId: w.id('b2'),
      origin
    })
  const tobin = at('tobin', 'took over the ferry', 'adam')
  const mara = at('mara', 'moved to the coast', 'ai')
  const mill = at('mill', 'was rebuilt', 'ai')
  const text = 'The walls of Harrow Mill go up again, stone by stone.'
  const doc = { type: 'doc', content: [{ type: 'paragraph', attrs: { pid: 'p1' }, content: [{ type: 'text', text }] }] }
  repo.saveSceneText(w.db, w.id('qy.c1.s1'), doc, text)
  return { ...w, tobin, mara, mill }
}

describe('When did these happen?', () => {
  it('sorts each change as the model picks, with a question on each line', async () => {
    const w = whenWorld()
    const r = await runWhen(opts(w.db), w.id('qy'), w.id('b2'))
    expect(r).toMatchObject({ status: 'done', message: 'Sorted 3 changes, listed under What changed' })
    // Adam's own change moves to the new story but stays his.
    expect(live(w.db, w.tobin.id)).toMatchObject({ storyId: w.id('qy'), origin: 'adam' })
    expect(live(w.db, w.mara.id)).toMatchObject({ storyId: w.id('b2'), origin: 'ai' })
    expect(live(w.db, w.mill.id)).toBeNull()
    expect([w.tobin, w.mara, w.mill].map((c) => lineFor(w.db, c.id).question)).toEqual([
      { ...WHEN, answer: 'before' },
      { ...WHEN, answer: 'after' },
      { ...WHEN, answer: 'in' }
    ])
    const run = flowRuns(w.db, loadShape(w.db))[0]
    expect(run.heading).toBe('When did these happen?')
    expect([w.tobin, w.mara, w.mill].map((c) => run.places[lineFor(w.db, c.id).id])).toEqual([
      'Start of The Quiet Year',
      'Start of Book 2',
      'The Quiet Year, Ch 1, Sc 1'
    ])

    // Sorting again leaves what was sorted alone.
    expect(await runWhen(opts(w.db), w.id('qy'), w.id('b2'))).toMatchObject({ message: 'Nothing needed sorting' })
  })

  it('applies each answer any time, and Undo puts the change back where it was', async () => {
    const w = whenWorld()
    await runWhen(opts(w.db), w.id('qy'), w.id('b2'))
    const answer = (c: Change, option: string): void => void answerItem(w.db, lineFor(w.db, c.id).id, option)

    answer(w.mara, 'before')
    expect(live(w.db, w.mara.id)).toMatchObject({ storyId: w.id('qy'), origin: 'ai' })
    answer(w.mara, 'in')
    expect(live(w.db, w.mara.id)).toBeNull()
    answer(w.mara, 'after')
    expect(live(w.db, w.mara.id)).toMatchObject({ storyId: w.id('b2'), position: w.mara.position, origin: 'ai' })

    answer(w.mill, 'after')
    expect(live(w.db, w.mill.id)).toMatchObject({ storyId: w.id('b2'), position: w.mill.position, origin: 'ai' })

    answer(w.tobin, 'in')
    expect(live(w.db, w.tobin.id)).toBeNull()
    answer(w.tobin, 'before')
    expect(live(w.db, w.tobin.id)).toMatchObject({ storyId: w.id('qy'), origin: 'adam' })

    undoItem(w.db, lineFor(w.db, w.tobin.id).id)
    expect(live(w.db, w.tobin.id)).toMatchObject({ storyId: w.id('b2'), position: w.tobin.position, origin: 'adam' })
    expect(fdb.startChanges(w.db, w.id('b2')).map((c) => c.id)).toEqual([w.tobin.id, w.mara.id, w.mill.id])
  })

  it("leaves out a change something else took out: answers and Undo don't bring it back", async () => {
    const w = whenWorld()
    await runWhen(opts(w.db), w.id('qy'), w.id('b2'))
    // Adam deletes Mara's change (left on Book 2) on her page.
    mem.deleteChange(w.db, w.mara.id)
    const line = (): kdb.LogRow => lineFor(w.db, w.mara.id)
    const run = () => flowRuns(w.db, loadShape(w.db))[0]
    expect(run().gone).toEqual([line().id])
    expect(run().places[line().id]).toBe(GONE)
    answerItem(w.db, line().id, 'before')
    expect(live(w.db, w.mara.id)).toBeNull()
    answerItem(w.db, line().id, 'in')
    answerItem(w.db, line().id, 'after')
    expect(live(w.db, w.mara.id)).toBeNull()
    undoItem(w.db, line().id)
    expect(live(w.db, w.mara.id)).toBeNull()
    expect(line().undone).toBe(true)
    expect(run().gone).toEqual([])

    // The mill's change, taken out by its own line ("It happens in the new story"), still comes back.
    answerItem(w.db, lineFor(w.db, w.mill.id).id, 'before')
    expect(live(w.db, w.mill.id)).toMatchObject({ storyId: w.id('qy'), origin: 'ai' })
  })

  it('never removes anything when the new story has no scenes', () => {
    const changes = new ShortIds('C')
    changes.of('c1')
    const picks = readWhen({ changes: [{ change: 'C1', when: 'in', scene: 'S1' }] }, changes, new ShortIds('S'))
    expect(picks.get('c1')).toEqual({ pick: 'after', sceneId: null })
  })

  it("needs the book to continue after the new story", async () => {
    const w = whenWorld()
    const r = await runWhen(opts(w.db), w.id('b1'), w.id('b2'))
    expect(r).toEqual({ status: 'failed', message: "Book 2 doesn't continue after Book 1. Set it to continue after Book 1 first." })
  })
})

describe('When the model fails', () => {
  it('says what to do with no memory model, and writes nothing', async () => {
    const w = gapWorld()
    const r = await runTimeGap(opts(w.db, { model: () => ({ error: NO_FLOW_MODEL }) }), w.storyId)
    expect(r).toEqual({ status: 'failed', message: 'Choose a memory model in Settings › Models, then try again.' })
    expect([count(w.db, 'memory_runs'), count(w.db, 'generations'), fdb.startChanges(w.db, w.storyId).length]).toEqual([0, 0, 0])
  })

  it('turns an empty reply into plain words, keeping the record of what the AI saw', async () => {
    const w = gapWorld()
    repo.updateStory(w.db, w.storyId, { premise: 'A sailor comes home. [[fake: empty]]' })
    const r = await runTimeGap(opts(w.db), w.storyId)
    expect(r).toEqual({ status: 'failed', message: EMPTY_REPLY })
    expect(EMPTY_REPLY).toBe("The model didn't answer. Try again, or pick another memory model in Settings › Models.")
    expect([count(w.db, 'memory_runs'), fdb.startChanges(w.db, w.storyId).length]).toEqual([0, 0])
    expect(w.db.prepare('SELECT job, scene_id FROM generations').all()).toEqual([{ job: 'story', scene_id: '' }])
  })

  it('asks once more after a reply that cannot be read, then gives up in plain words', async () => {
    const w = dbWorld()
    repo.updateStory(w.db, w.id('ym'), { premise: 'Mara as a girl. [[fake: broken]]' })
    const before = fdb.startChanges(w.db, w.id('ym')).map((c) => c.id)
    const r = await runStartingCast(opts(w.db), w.id('ym'), [w.id('tobin')])
    expect(r).toEqual({ status: 'failed', message: BROKEN_REPLY })
    expect(count(w.db, 'generations')).toBe(2)
    expect(fdb.startChanges(w.db, w.id('ym')).map((c) => c.id)).toEqual(before)
    expect(count(w.db, 'memory_runs')).toBe(0)
  })
})

describe('flowFailure', () => {
  const target = { id: 'p1', name: 'Fake', kind: 'custom' as const, baseUrl: 'http://localhost:1/v1', apiKey: 'k' }
  const http = (status: number, message: string) => flowFailure({ type: 'http', status, message }, target, 'fake/memory')

  it("never talks about the draft's options or a refused scene", () => {
    expect(http(400, "This model's maximum context length is 8192 tokens")).toBe(TOO_MUCH)
    expect(http(413, 'Request too large')).toBe(TOO_MUCH)
    expect(http(400, 'max_tokens: must be at most 4096 (output tokens)')).toBe(REPLY_TOO_LONG)
    expect(http(403, 'Flagged by moderation')).toBe(REFUSED)
    expect(flowFailure({ type: 'refused' }, target, 'fake/memory')).toBe(REFUSED)
    expect(TOO_MUCH).toBe(
      'That was too much for the memory model to read at once. Pick a memory model that can read more in Settings › Models.'
    )
    // Everything else as the writer is told it, about the memory model.
    expect(http(500, 'oops')).toBe(
      'Fake is having trouble right now. Try again in a few minutes, or switch the memory model in Settings › Models.'
    )
  })
})

describe('Running in the background', () => {
  function runner(db: DB, fetchImpl?: typeof fetch) {
    const statuses: StoryFlowStatus[] = []
    const changed: ID[][] = []
    const r = new FlowRunner({
      db,
      model,
      prefs: defaultWritingPrefs,
      emitStatus: (s) => statuses.push(s),
      emitChanged: (p) => changed.push(p.entryIds),
      fetchImpl,
      retryDelays: [0, 0]
    })
    return { r, statuses, changed }
  }

  /** A fetch that waits until `release` is called (or the call is stopped). */
  function gate() {
    let open: () => void = () => undefined
    let opened = new Promise<void>((res) => (open = res))
    let calls = 0
    const fetchImpl: typeof fetch = async (input, init) => {
      calls++
      await new Promise<void>((res, rej) => {
        void opened.then(res)
        init?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('Stopped'), { name: 'AbortError' })))
      })
      return fetch(input, init)
    }
    return {
      fetchImpl,
      calls: () => calls,
      release: () => {
        open()
        opened = Promise.resolve()
      }
    }
  }

  it('says how it is going, and keeps the last result for the story', async () => {
    const w = gapWorld()
    const { r, statuses, changed } = runner(w.db)
    r.start({ flow: 'time-gap', storyId: w.storyId })
    await r.idle()
    expect(statuses).toEqual([
      { storyId: w.storyId, flow: 'time-gap', state: 'running', message: 'Working out what changed in the 300 years…' },
      {
        storyId: w.storyId,
        flow: 'time-gap',
        state: 'done',
        message: 'Added 2 changes and closed 1 plot thread, listed under What changed'
      }
    ])
    expect(new Set(changed[0])).toEqual(new Set([w.id('mara'), w.id('mill'), w.crownId]))
    expect(r.list(w.storyId)).toEqual([statuses[1]])
    expect(r.list(w.id('b1'))).toEqual([])
  })

  it('runs one at a time per story and flow: a second call runs after the first', async () => {
    const w = gapWorld()
    const g = gate()
    const { r, statuses } = runner(w.db, g.fetchImpl)
    r.start({ flow: 'time-gap', storyId: w.storyId })
    r.start({ flow: 'time-gap', storyId: w.storyId })
    r.start({ flow: 'time-gap', storyId: w.storyId })
    await new Promise((res) => setTimeout(res, 20))
    expect(g.calls()).toBe(1)
    g.release()
    await r.idle()
    expect(g.calls()).toBe(2)
    expect(statuses.map((s) => s.state)).toEqual(['running', 'running', 'done'])
    // The second run changed nothing, so the first one's result stays on show.
    expect(statuses.at(-1)!.message).toBe('Added 2 changes and closed 1 plot thread, listed under What changed')
    expect(r.list(w.storyId)).toEqual([statuses.at(-1)])
    expect(fdb.flowRunIds(w.db)).toHaveLength(1)
  })

  it('can be stopped, keeping nothing', async () => {
    const w = gapWorld()
    const g = gate()
    const { r, statuses } = runner(w.db, g.fetchImpl)
    r.start({ flow: 'time-gap', storyId: w.storyId })
    r.start({ flow: 'time-gap', storyId: w.storyId })
    await new Promise((res) => setTimeout(res, 20))
    r.stop(w.storyId, 'time-gap')
    await r.idle()
    expect(statuses.at(-1)).toEqual({ storyId: w.storyId, flow: 'time-gap', state: 'done', message: STOPPED })
    expect(g.calls()).toBe(1)
    expect([count(w.db, 'memory_runs'), fdb.startChanges(w.db, w.storyId).length]).toEqual([0, 0])
    expect(w.db.prepare('SELECT status FROM generations').all()).toEqual([{ status: 'stopped' }])
  })

  it('stops when the world closes, writing nothing after', async () => {
    const w = gapWorld()
    const g = gate()
    const { r, statuses } = runner(w.db, g.fetchImpl)
    r.start({ flow: 'starting-cast', storyId: w.id('ym'), entryIds: [w.id('tobin')] })
    await new Promise((res) => setTimeout(res, 20))
    r.close()
    await r.idle()
    expect(statuses.map((s) => s.state)).toEqual(['running'])
    expect(count(w.db, 'memory_runs')).toBe(0)
    r.start({ flow: 'time-gap', storyId: w.storyId })
    expect(statuses).toHaveLength(1)
  })

  it('fails in plain words, without sticking at "running"', async () => {
    const w = gapWorld()
    const { r, statuses } = runner(w.db)
    r.start({ flow: 'starting-cast', storyId: w.storyId, entryIds: [w.id('mara')] })
    await r.idle()
    expect(statuses.at(-1)).toMatchObject({ state: 'failed', message: NOT_PREQUEL })
  })
})

describe('flowPlace', () => {
  const title = (id: ID): string => ({ b2: 'Book 2', qy: 'The Quiet Year' })[id] ?? 'Untitled story'
  const scene = (_: ID, sceneId: ID): string | null => (sceneId === 's1' ? 'The Quiet Year, Ch 1, Sc 1' : null)
  const sorted = (pick: 'before' | 'after' | 'in', sceneId: ID | null = null) =>
    ({
      op: 'story-flow',
      flow: 'when',
      storyId: 'qy',
      changeId: 'c1',
      did: 'sorted',
      bookId: 'b2',
      position: 0,
      origin: 'ai',
      pick,
      removedByLine: pick === 'in',
      sceneId
    }) as const

  it('says where the change is now', () => {
    expect(flowPlace(sorted('before'), false, { storyId: 'qy', deleted: false }, title, scene)).toBe('Start of The Quiet Year')
    expect(flowPlace(sorted('after'), false, { storyId: 'b2', deleted: false }, title, scene)).toBe('Start of Book 2')
    expect(flowPlace(sorted('in', 's1'), false, { storyId: 'b2', deleted: true }, title, scene)).toBe('The Quiet Year, Ch 1, Sc 1')
    expect(flowPlace(sorted('in', 's9'), false, { storyId: 'b2', deleted: true }, title, scene)).toBe('In The Quiet Year')
    // Undone: back where it was.
    expect(flowPlace(sorted('in', 's1'), true, { storyId: 'b2', deleted: false }, title, scene)).toBe('Start of Book 2')
    // A time gap's change moved to another story since.
    const gap = { op: 'story-flow', flow: 'time-gap', storyId: 'b2', changeId: 'c2', did: 'added' } as const
    expect(flowPlace(gap, false, { storyId: 'qy', deleted: false }, title, scene)).toBe('Start of The Quiet Year')
    // Taken out since by something else (Adam, or the time gap worked out again).
    expect(flowPlace(gap, false, null, title, scene)).toBe(GONE)
    expect(flowPlace(gap, false, { storyId: 'b2', deleted: true }, title, scene)).toBe(GONE)
    expect(flowPlace(gap, true, { storyId: 'b2', deleted: true }, title, scene)).toBe('Start of Book 2')
    expect(flowPlace(sorted('after'), false, { storyId: 'b2', deleted: true }, title, scene)).toBe(GONE)
    expect(flowPlace({ ...sorted('in', 's1'), removedByLine: false }, false, { storyId: 'b2', deleted: true }, title, scene)).toBe(GONE)
  })
})

describe('gapPhrase', () => {
  it('uses the gap in the running note when it reads as a span of time', () => {
    expect(gapPhrase('200 years', 'Book 4')).toBe('Working out what changed in the 200 years…')
    expect(gapPhrase('200 years later', 'Book 4')).toBe('Working out what changed in the 200 years…')
    expect(gapPhrase('three weeks', 'Book 4')).toBe('Working out what changed in the three weeks…')
    expect(gapPhrase('a few months', 'Book 4')).toBe('Working out what changed over a few months…')
    expect(gapPhrase('Two centuries', 'Book 4')).toBe('Working out what changed in the two centuries…')
    expect(gapPhrase('A few months later', 'Book 4')).toBe('Working out what changed over a few months…')
    expect(gapPhrase('1 year', 'Book 4')).toBe('Working out what changed over the year…')
    expect(gapPhrase('One winter later', 'Book 4')).toBe('Working out what changed over the winter…')
    expect(gapPhrase('one hundred years', 'Book 4')).toBe('Working out what changed in the one hundred years…')
    expect(gapPhrase('long after the war', 'Book 4')).toBe('Working out what changed before Book 4 starts…')
    expect(gapPhrase('', 'Book 4')).toBe('Working out what changed before Book 4 starts…')
  })
})
