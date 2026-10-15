// The promises ledger (long story memory fix 10): where each plot thread stands (open, advanced, paid off, dropped), the
// scene it was set up in and last moved on in, when it is due (Adam's "Pay off by", or a scene card's plan) as of a
// point, and which threads are worth a look (overdue, or untouched for a long stretch). The pure rules first, then the
// same over a real world: the writer's scene memory, overdueThreads, the board and Worth a look. All text is invented.

import { describe, expect, it } from 'vitest'
import type { ID, ThreadPlan, ThreadState } from '@shared/types'
import { emptySceneCard } from '@shared/defaults'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import * as hist from '../db/history'
import { memoryWorld } from '../../../tests/unit/helpers'
import { setThreadPlan, threadPlan, threadPlans, cleanPlan, dropPlansOfGoneThreads } from '../db/threadPlans'
import { purgeTrash } from '../db/trash'
import { chapterChoice, LONG_QUIET_MIN, longQuiet, promiseLedger, threadWarnings, type PromiseInput } from './promises'
import type { ThreadTouch } from './threadQuiet'
import type { Line, WorldShape } from './types'
import { overdueThreads, sceneMemory } from './scene'
import { threadsBoardOf } from '../worldViews'
import { keepMemoryChecks, listMemoryChecks, planThread, removeMemoryCheck, undoMemoryCheck } from '../keeper/checkQueue'
import { gatherContextInput } from '../ai/gather'
import { assembleContext } from '../ai/context'
import { defaultWritingPrefs } from '@shared/defaults'

// ---------- The pure rules ----------

/** A story of `chapters` chapters of `per` scenes each: c1..cN, scenes s<chapter>_<scene>, with its line through the end. */
function shapeOf(chapters = 4, per = 3): { shape: WorldShape; line: Line; scene: (c: number, s: number) => ID } {
  const scene = (c: number, s: number): ID => `s${c}_${s}`
  const story = {
    id: 'b1',
    title: 'Book 1',
    kind: 'standalone',
    seriesId: null,
    startStoryId: null,
    startAt: 'pre',
    startRefId: null,
    endAt: null,
    endRefId: null,
    leadsIntoId: null,
    leadsIn: false,
    position: 0,
    createdOrder: 0,
    chapters: Array.from({ length: chapters }, (_, c) => ({
      id: `c${c + 1}`,
      title: '',
      scenes: Array.from({ length: per }, (_, s) => ({ id: scene(c + 1, s + 1), title: '' }))
    }))
  } as unknown as WorldShape['stories'][number]
  const steps: Line['steps'] = [
    { type: 'start', storyId: 'b1', via: 'line' },
    { type: 'start-changes', storyId: 'b1', via: 'line' }
  ]
  for (const c of story.chapters) {
    for (const s of c.scenes) steps.push({ type: 'scene', storyId: 'b1', chapterId: c.id, sceneId: s.id, via: 'line' })
    steps.push({ type: 'chapter-end', storyId: 'b1', chapterId: c.id, via: 'line' })
  }
  steps.push({ type: 'end', storyId: 'b1', via: 'line' })
  const line = { target: { storyId: 'b1', through: 'end' }, steps, segments: [{ storyId: 'b1', via: 'line' }] } as unknown as Line
  return { shape: { stories: [story], answers: [] }, line, scene }
}

/** The line just before a scene (what counts for drafting it). */
const before = (line: Line, sceneId: ID): Line => ({ ...line, steps: line.steps.slice(0, line.steps.findIndex((s) => s.type === 'scene' && s.sceneId === sceneId)) })

const stepOf = (line: Line, sceneId: ID): number => line.steps.findIndex((s) => s.type === 'scene' && s.sceneId === sceneId)
const touch = (line: Line, last: ID, opened: ID, quiet = 0): ThreadTouch => ({
  step: stepOf(line, last),
  sceneId: last,
  storyId: 'b1',
  quiet,
  opened: { step: stepOf(line, opened), sceneId: opened, storyId: 'b1' }
})
const open = (entryId: ID, t: Partial<ThreadState> = {}): ThreadState => ({ entryId, status: 'open', setUp: '', paidOff: '', ...t })

describe('how a chapter is offered', () => {
  it('by number, with its title when it has one of its own', () => {
    expect(chapterChoice(6, 'The Ferry')).toBe('Ch 6 · The Ferry')
    expect(chapterChoice(6, 'Chapter 6')).toBe('Ch 6')
    expect(chapterChoice(2, '  ')).toBe('Ch 2')
  })
})

describe('how long is a long stretch', () => {
  it('a quarter of the story written so far, never fewer than twelve scenes', () => {
    expect(LONG_QUIET_MIN).toBe(12)
    expect(longQuiet(0)).toBe(12)
    expect(longQuiet(48)).toBe(12)
    expect(longQuiet(49)).toBe(13)
    expect(longQuiet(100)).toBe(25)
    expect(longQuiet(200)).toBe(50)
  })
})

describe('where each thread stands, and when it is due', () => {
  const { shape, line, scene } = shapeOf()
  const base = (over: Partial<PromiseInput>): PromiseInput => ({
    storyId: 'b1',
    shape,
    line: before(line, scene(3, 2)),
    threads: [],
    touches: new Map(),
    plans: new Map(),
    paysOff: new Map(),
    now: { sceneId: scene(3, 2) },
    ...over
  })

  it('open, advanced (touched again after its set-up), paid off, or dropped by Adam', () => {
    const l = before(line, scene(3, 2))
    const rows = promiseLedger(
      base({
        line: l,
        threads: [open('a'), open('b'), open('c', { status: 'resolved' }), open('d')],
        touches: new Map([
          ['a', touch(l, scene(1, 2), scene(1, 2))],
          ['b', touch(l, scene(2, 3), scene(1, 1))],
          ['c', touch(l, scene(2, 1), scene(1, 1))],
          ['d', touch(l, scene(2, 1), scene(1, 1))]
        ]),
        plans: new Map<ID, ThreadPlan>([['d', { dropped: true }]])
      })
    )
    expect(rows.get('a')).toEqual({ standing: 'open', setUpSceneId: scene(1, 2) })
    expect(rows.get('b')).toEqual({ standing: 'advanced', setUpSceneId: scene(1, 1), advanced: { sceneId: scene(2, 3), storyId: 'b1' } })
    expect(rows.get('c')?.standing).toBe('paid')
    expect(rows.get('c')?.advanced).toBeUndefined()
    expect(rows.get('d')?.standing).toBe('dropped')
  })

  it('by a chapter Adam chose: overdue once that chapter is over, due now in it, later before it', () => {
    const plans = new Map<ID, ThreadPlan>([
      ['a', { payBy: 'c2' }],
      ['b', { payBy: 'c3' }],
      ['c', { payBy: 'c4' }],
      ['d', { payBy: 'gone' }]
    ])
    const rows = promiseLedger(base({ threads: ['a', 'b', 'c', 'd'].map((id) => open(id)), plans }))
    expect(rows.get('a')?.due).toEqual({ chapterId: 'c2', label: 'Ch 2', from: 'adam', state: 'overdue' })
    expect(rows.get('b')?.due).toEqual({ chapterId: 'c3', label: 'Ch 3', from: 'adam', state: 'now' })
    expect(rows.get('c')?.due).toEqual({ chapterId: 'c4', label: 'Ch 4', from: 'adam', state: 'later' })
    // A chapter that is gone is no date at all.
    expect(rows.get('d')?.due).toBeUndefined()
    // A paid-off thread is never due.
    expect(promiseLedger(base({ threads: [open('a', { status: 'resolved' })], plans })).get('a')?.due).toBeUndefined()
  })

  it('or by the first scene card planning its pay-off after its set-up, unless Adam chose a chapter', () => {
    const l = before(line, scene(3, 2))
    const touches = new Map([['a', touch(l, scene(1, 2), scene(1, 2))]])
    const at = (planned: ID, plans = new Map<ID, ThreadPlan>()) =>
      promiseLedger(base({ line: l, threads: [open('a')], touches, plans, paysOff: new Map([[planned, ['a']], [scene(1, 1), ['a']]]) })).get('a')?.due
    // Later in this chapter: still to come (that scene's card will say "this scene pays it off").
    expect(at(scene(3, 3))).toEqual({ chapterId: 'c3', label: 'Ch 3', from: 'card', sceneId: scene(3, 3), sceneLabel: 'Ch 3, Sc 3', state: 'later' })
    // Earlier in this chapter, and still open: due by the end of it.
    expect(at(scene(3, 1))?.state).toBe('now')
    // In a chapter that is over: overdue. (The card before its set-up, Sc 1 of Ch 1, doesn't count.)
    expect(at(scene(2, 2))).toMatchObject({ chapterId: 'c2', sceneLabel: 'Ch 2, Sc 2', state: 'overdue' })
    expect(at(scene(4, 1))?.state).toBe('later')
    expect(at(scene(2, 2), new Map([['a', { payBy: 'c4' }]]))).toMatchObject({ from: 'adam', chapterId: 'c4', state: 'later' })
  })

  it('as the story stands now: against its latest scene with words, and nothing is due before any', () => {
    const plans = new Map<ID, ThreadPlan>([['a', { payBy: 'c2' }]])
    const now = (written: ID[]) => promiseLedger(base({ line, threads: [open('a')], plans, now: { written: new Set(written) } })).get('a')?.due?.state
    expect(now([])).toBe('later')
    expect(now([scene(1, 1), scene(2, 1)])).toBe('now')
    expect(now([scene(1, 1), scene(2, 3), scene(3, 1)])).toBe('overdue')
  })
})

describe('which threads are worth a look', () => {
  const { line, scene } = shapeOf(8, 5)
  const t = (id: ID, quiet: number, over: Partial<ThreadTouch> = {}): [ID, ThreadTouch] => [id, { ...touch(line, scene(1, 2), scene(1, 1), quiet), ...over }]
  const warn = (o: { threads: ThreadState[]; rows: Map<ID, ReturnType<typeof promiseLedger> extends Map<ID, infer R> ? R : never>; touches: Map<ID, ThreadTouch>; plans?: Map<ID, ThreadPlan>; written?: number }) =>
    threadWarnings({ storyId: 'b1', plans: new Map(), written: 30, ...o })

  it('an open thread past its due chapter, unless Adam kept it for that chapter', () => {
    const rows = new Map([['a', { standing: 'open' as const, due: { chapterId: 'c2', label: 'Ch 2', from: 'adam' as const, state: 'overdue' as const } }]])
    const touches = new Map([t('a', 3)])
    expect(warn({ threads: [open('a')], rows, touches })).toEqual([{ threadId: 'a', why: 'overdue', due: rows.get('a')!.due }])
    expect(warn({ threads: [open('a')], rows, touches, plans: new Map([['a', { kept: { due: 'c2' } }]]) })).toEqual([])
    // Kept for another due chapter: it asks again.
    expect(warn({ threads: [open('a')], rows, touches, plans: new Map([['a', { kept: { due: 'c1' } }]]) })).toHaveLength(1)
  })

  it('one with no due date untouched for a long stretch in this story; never one dropped, paid off, planned or due later', () => {
    const rows = new Map([
      ['a', { standing: 'open' as const }],
      ['b', { standing: 'advanced' as const }],
      ['c', { standing: 'dropped' as const }],
      ['d', { standing: 'open' as const, due: { chapterId: 'c8', label: 'Ch 8', from: 'adam' as const, state: 'later' as const } }],
      ['e', { standing: 'open' as const }],
      ['f', { standing: 'open' as const }]
    ])
    const touches = new Map([t('a', 13), t('b', 20), t('c', 30), t('d', 30), t('e', 11), t('f', 40, { storyId: 'b0' })])
    const threads = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => open(id))
    expect(warn({ threads, rows, touches }).map((w) => [w.threadId, w.why, w.quiet])).toEqual([
      ['b', 'quiet', 20],
      ['a', 'quiet', 13]
    ])
    // The stretch grows with the story: 13 isn't long in a story of 80 scenes (20).
    expect(warn({ threads, rows, touches, written: 80 }).map((w) => w.threadId)).toEqual(['b'])
    expect(warn({ threads: [open('a', { planned: true })], rows, touches })).toEqual([])
  })

  it('Keep on a quiet one holds while nothing touches it, until another long stretch goes by', () => {
    const rows = new Map([['a', { standing: 'open' as const }]])
    const kept = new Map<ID, ThreadPlan>([['a', { kept: { touch: scene(1, 2), quiet: 13 } }]])
    expect(warn({ threads: [open('a')], rows, touches: new Map([t('a', 20)]), plans: kept })).toEqual([])
    expect(warn({ threads: [open('a')], rows, touches: new Map([t('a', 25)]), plans: kept })).toHaveLength(1)
    // Touched since (another scene), then quiet a long stretch again: it asks again.
    expect(warn({ threads: [open('a')], rows, touches: new Map([t('a', 12, { sceneId: scene(4, 1) })]), plans: kept })).toHaveLength(1)
  })
})

// ---------- Over a real world ----------

/** A story of `chapters` chapters of `per` scenes, and a plot thread, the bell, opened in Ch 1, Sc 1. */
function book(chapters = 4, per = 3) {
  const db = memoryWorld()
  const story = repo.listStories(db)[0]
  const o = repo.getOutline(db, story.id)
  const ch = [o.chapters[0].id]
  for (let i = 1; i < chapters; i++) ch.push(repo.createChapter(db, story.id, {}).id)
  const scenes: ID[][] = ch.map((c, i) => {
    const list: ID[] = i === 0 ? [o.scenes[0].id] : []
    while (list.length < per) list.push(repo.createScene(db, c, {}).id)
    return list
  })
  const bell = repo.createEntry(db, 'thread', { name: 'The drowned bell', fields: { promise: 'Who rang it at night?' } })
  const moves = (entryId: ID, sceneId: ID, note = '') =>
    mem.insertChange(db, { kind: 'thread', payload: { status: 'open', note }, entryId, anchor: 'scene', sceneId, origin: 'text' })
  moves(bell.id, scenes[0][0])
  const write = (upTo: [number, number]) => {
    for (let c = 0; c < ch.length; c++)
      for (let s = 0; s < per; s++) if (c < upTo[0] - 1 || (c === upTo[0] - 1 && s < upTo[1])) repo.saveSceneText(db, scenes[c][s], null, `The tide came in, ${c + 1}.${s + 1}.`)
  }
  return { db, storyId: story.id, chapters: ch, scenes, bell, moves, write }
}

describe('the writer’s scene memory', () => {
  it('gives each thread where it stands, where it was set up and last moved on, and when it is due as the scene is written', () => {
    const w = book()
    w.moves(w.bell.id, w.scenes[1][0], 'the bell rang again')
    setThreadPlan(w.db, w.bell.id, { payBy: w.chapters[2] })
    const at = (c: number, s: number) => sceneMemory(w.db, w.scenes[c][s]).threads.find((t) => t.entryId === w.bell.id)!
    const inCh3 = at(2, 1)
    expect(inCh3).toMatchObject({ standing: 'advanced', setUpSceneId: w.scenes[0][0], advancedSceneId: w.scenes[1][0] })
    expect(inCh3.advancedWhere).toMatch(/Ch 2, Sc 1$/)
    expect(inCh3.due).toEqual({ chapterId: w.chapters[2], label: 'Ch 3', from: 'adam', state: 'now' })
    expect(at(1, 2).due?.state).toBe('later')
    expect(at(3, 0).due?.state).toBe('overdue')
    // Before anything moved it on: open, with no last step on.
    const early = at(1, 0)
    expect(early.standing).toBe('open')
    expect(early.advancedSceneId).toBeUndefined()
  })

  it('tells the writer plainly when it is due, and leaves out a thread Adam dropped', () => {
    const w = book()
    setThreadPlan(w.db, w.bell.id, { payBy: w.chapters[2] })
    const block = (c: number, s: number) =>
      assembleContext(gatherContextInput(w.db, w.scenes[c][s], undefined, { prefs: defaultWritingPrefs(), contextLength: 32000, creativity: 'balanced' }), (t) =>
        Math.ceil(t.length / 4)
      ).blocks.find((b) => b.id === 'open-threads')
    expect(block(2, 1)?.text).toContain('- The drowned bell — Who rang it at night? — Pay this off by the end of this chapter.')
    expect(block(1, 1)?.text).toContain('to be paid off by the end of Ch 3, not yet')
    setThreadPlan(w.db, w.bell.id, { payBy: w.chapters[2], dropped: true })
    expect(block(2, 1)).toBeUndefined()
  })
})

describe('overdueThreads (for Worth a look, and rule-based checks to come)', () => {
  it('as the story stands: a thread past its pay-off chapter, by name, with where it was last touched', () => {
    const w = book()
    setThreadPlan(w.db, w.bell.id, { payBy: w.chapters[1] })
    w.write([2, 3])
    expect(overdueThreads(w.db, w.storyId)).toEqual([])
    w.write([3, 1])
    const [o] = overdueThreads(w.db, w.storyId)
    expect(o).toMatchObject({ threadId: w.bell.id, why: 'overdue', name: 'The drowned bell', due: { chapterId: w.chapters[1], label: 'Ch 2', state: 'overdue' } })
    expect(o.lastWhere).toMatch(/Ch 1, Sc 1$/)
    // As a scene begins: told against its own chapter.
    expect(overdueThreads(w.db, w.storyId, w.scenes[1][2])).toEqual([])
    expect(overdueThreads(w.db, w.storyId, w.scenes[2][0]).map((x) => x.why)).toEqual(['overdue'])
    // Not for a scene of another story, nor one that is gone.
    expect(overdueThreads(w.db, 'no-such-story')).toEqual([])
  })

  it('a thread untouched for a long stretch: a quarter of the story written, at least twelve scenes', () => {
    const w = book(5, 3)
    w.write([5, 3]) // 15 scenes with words: the bell untouched for 14 since Ch 1, Sc 1
    expect(overdueThreads(w.db, w.storyId).map((x) => [x.why, x.quiet])).toEqual([['quiet', 14]])
    // A clue's words in Ch 2 touch it: 9 scenes since, not a long stretch.
    hist.addLink(w.db, { factKind: 'field', factId: w.bell.id, field: 'clues', sceneId: w.scenes[1][2], sceneVersion: 1, paragraphId: 'p1', start: 0, end: 5, quote: 'A bell', state: 'ok' })
    expect(overdueThreads(w.db, w.storyId)).toEqual([])
  })
})

describe('the board', () => {
  it('says where each stands, its last step on, when it is due and what is worth a look; dropped has its own column', () => {
    const w = book()
    w.moves(w.bell.id, w.scenes[1][1], 'a second ringing')
    w.write([3, 1])
    setThreadPlan(w.db, w.bell.id, { payBy: w.chapters[1] })
    const board = threadsBoardOf(w.db, w.storyId)
    const bell = board.threads.find((t) => t.id === w.bell.id)!
    expect(bell).toMatchObject({ column: 'open', standing: 'advanced', warn: 'overdue', due: { label: 'Ch 2', from: 'adam', state: 'overdue' } })
    expect(bell.advanced?.sceneId).toBe(w.scenes[1][1])
    expect(board.chapters?.map((c) => c.label)).toEqual(['Ch 1', 'Ch 2', 'Ch 3', 'Ch 4'])
    planThread(w.db, w.bell.id, { dropped: true })
    const dropped = threadsBoardOf(w.db, w.storyId).threads.find((t) => t.id === w.bell.id)!
    expect(dropped).toMatchObject({ column: 'dropped', standing: 'dropped', warn: null, due: null, openChapters: null, longOpen: false })
  })

  it('a scene card’s planned pay-off is the due date, until Adam chooses one', () => {
    const w = book()
    repo.updateSceneCard(w.db, w.scenes[3][1], { ...emptySceneCard(), paysOffIds: [w.bell.id] })
    w.write([2, 2])
    const bell = () => threadsBoardOf(w.db, w.storyId).threads.find((t) => t.id === w.bell.id)!
    expect(bell().due).toEqual({ chapterId: w.chapters[3], label: 'Ch 4', from: 'card', sceneId: w.scenes[3][1], sceneLabel: 'Ch 4, Sc 2', state: 'later' })
    planThread(w.db, w.bell.id, { payBy: w.chapters[1] })
    expect(bell().due).toMatchObject({ from: 'adam', label: 'Ch 2', state: 'now' })
  })
})

describe('Worth a look: plot threads left waiting', () => {
  it('lists an overdue thread with the chapters it can move to; Keep, Mark as dropped and Pay off later, each with Undo', () => {
    const w = book()
    setThreadPlan(w.db, w.bell.id, { payBy: w.chapters[0] })
    w.write([2, 2])
    const rows = () => listMemoryChecks(w.db).filter((i) => i.group === 'promise')
    const [row] = rows()
    expect(row).toMatchObject({
      group: 'promise',
      fact: { kind: 'promise', threadId: w.bell.id, why: 'overdue', due: w.chapters[0] },
      entryId: w.bell.id,
      entryName: 'The drowned bell',
      entryKind: 'thread',
      text: 'Still open, and due by the end of Ch 1',
      sceneId: w.scenes[0][0],
      canRemove: true
    })
    expect(row.where).toMatch(/Ch 1, Sc 1$/)
    // Pay off later: from the chapter being written to the story's end.
    expect(row.later?.map((c) => c.label)).toEqual(['Ch 2', 'Ch 3', 'Ch 4'])

    // Keep: not asked again for this due chapter; Undo asks again.
    const kept = keepMemoryChecks(w.db, [row.fact])
    expect(rows()).toEqual([])
    expect(threadPlan(w.db, w.bell.id)).toEqual({ payBy: w.chapters[0], kept: { due: w.chapters[0] } })
    undoMemoryCheck(w.db, kept)
    expect(rows()).toHaveLength(1)

    // Mark as dropped: gone from the list and from the writer's threads; Undo picks it up again.
    const dropped = removeMemoryCheck(w.db, row.fact)
    expect(threadPlan(w.db, w.bell.id)?.dropped).toBe(true)
    expect(rows()).toEqual([])
    undoMemoryCheck(w.db, dropped)
    expect(threadPlan(w.db, w.bell.id)?.dropped).toBeUndefined()

    // Pay off later: a chapter still to come, so nothing to look at; Undo puts the old chapter back.
    const later = planThread(w.db, w.bell.id, { payBy: w.chapters[3] })
    expect(rows()).toEqual([])
    undoMemoryCheck(w.db, later)
    expect(threadPlan(w.db, w.bell.id)?.payBy).toBe(w.chapters[0])
    expect(rows()).toHaveLength(1)
  })

  it('refuses a thread or chapter that is gone, in plain words', () => {
    const w = book()
    expect(() => planThread(w.db, 'nope', { dropped: true })).toThrow('That plot thread no longer exists.')
    expect(() => planThread(w.db, w.bell.id, { payBy: 'nope' })).toThrow('That chapter no longer exists. Choose another one.')
    const undo = planThread(w.db, w.bell.id, { payBy: w.chapters[1] })
    planThread(w.db, w.bell.id, { payBy: null })
    expect(threadPlan(w.db, w.bell.id)).toBeNull()
    expect(undo.steps).toHaveLength(1)
  })
})

describe('the plans in the world', () => {
  it('keeps only what it can read, takes the row away when empty, and goes with the thread for good', () => {
    expect(cleanPlan({ payBy: 'c1', dropped: true, kept: { due: 'c1', touch: null, quiet: 3.7 }, other: 1 })).toEqual({
      payBy: 'c1',
      dropped: true,
      kept: { due: 'c1', touch: null, quiet: 3 }
    })
    expect(cleanPlan({ payBy: '', dropped: 'yes', kept: { quiet: -1 } })).toBeNull()
    expect(cleanPlan('{oops')).toBeNull()
    const w = book()
    setThreadPlan(w.db, w.bell.id, { payBy: w.chapters[1] })
    expect(threadPlans(w.db).get(w.bell.id)).toEqual({ payBy: w.chapters[1] })
    repo.setMeta(w.db, 'thread_plan:broken', '{oops')
    expect([...threadPlans(w.db).keys()]).toEqual([w.bell.id])
    setThreadPlan(w.db, w.bell.id, {})
    expect(repo.getMeta(w.db, `thread_plan:${w.bell.id}`)).toBeNull()
    setThreadPlan(w.db, w.bell.id, { dropped: true })
    repo.deleteEntry(w.db, w.bell.id)
    dropPlansOfGoneThreads(w.db)
    // Only in Recently deleted: kept, so a restore brings it back.
    expect(threadPlan(w.db, w.bell.id)).toEqual({ dropped: true })
    purgeTrash(w.db, 0, Date.now() + 60_000)
    expect(threadPlan(w.db, w.bell.id)).toBeNull()
    expect(repo.getMeta(w.db, 'thread_plan:broken')).toBeNull()
  })
})
