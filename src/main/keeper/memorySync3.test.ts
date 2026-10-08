// World memory follows the words, round 3 (fixes from the review of World Memory Overhaul part A, 2026-10-08): Undo of a
// removal or an update gives the fact back to the writer for good, the world builder's drafts are never removed with
// words, a typo doesn't make a scene summary due, a draft's fresh read goes before summary jobs, an edited fact whose
// paragraph was joined to another isn't removed unchecked, and the tidy-up of a big world goes a few scenes at a time.
// All text is invented; the memory model is the fake one (tests/fake-provider), its replies shaped per test: no paid
// calls.

import type Database from 'better-sqlite3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ID } from '@shared/types'
import { defaultWritingPrefs } from '@shared/defaults'
import { startFakeProvider, type FakeProvider } from '../../../tests/fake-provider/server.mjs'
import { entryNamed, fakeModel, readScene, saveParas, shapedFetch, testWorld, textOf } from '../../../tests/unit/keeperRead'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import * as hist from '../db/history'
import * as kdb from '../db/keeper'
import { READING_MARKER, SUMMARY_MARKER } from './prompts'
import { sceneSummaryDue, writeSceneSummary, type SummaryOptions } from './summaries'
import { Keeper } from './engine'
import { undoItem } from './undo'
import { tidyMemory } from './tidy'
import { gatherContextInput } from '../ai/gather'
import { mustStayTrue } from '../ai/mustStay'

let fake: FakeProvider
beforeAll(async () => {
  fake = await startFakeProvider({ delayMs: 0 })
})
afterAll(() => fake.close())

type DB = Database.Database

const writerMemory = (db: DB, sceneId: ID) =>
  gatherContextInput(db, sceneId, undefined, { prefs: defaultWritingPrefs(), contextLength: 32000, creativity: 'balanced' }).memory
const writerEntry = (db: DB, sceneId: ID, name: string) => writerMemory(db, sceneId).entries.find((e) => e.name === name) ?? null
const mustLines = (db: DB, sceneId: ID, names: string[]): string[] => {
  const m = writerMemory(db, sceneId)
  return mustStayTrue({
    stand: null,
    reach: 'later',
    people: names.map((n) => m.entries.find((e) => e.name === n)!).filter(Boolean),
    named: [],
    facts: m.facts,
    sceneId,
    storyTitle: '',
    places: {}
  })
}
const changesOf = (db: DB, name: string) => {
  const e = entryNamed(db, name)
  return e ? mem.changesForEntry(db, e.id) : []
}
const logLine = (db: DB, pred: (l: kdb.LogRow) => boolean) => kdb.listLog(db, { limit: 100 }).find(pred) ?? null

const MARA_RIVER = 'Mara lost her knife in the river.'
const TIDE = 'Mara said the tide would turn by dusk.'

describe('Undo gives a removed or updated fact back to the writer for good', () => {
  it('a fact removed because its words were deleted', async () => {
    const w = testWorld(1)
    const [s1, s2] = w.scenes
    saveParas(w.db, s1, [
      ['p1', MARA_RIVER],
      ['p3', TIDE]
    ])
    await readScene(w.db, fake, s1)
    const [c] = changesOf(w.db, 'Mara')
    saveParas(w.db, s1, [['p3', TIDE]])
    await readScene(w.db, fake, s1)
    expect(changesOf(w.db, 'Mara')).toEqual([])
    const line = logLine(w.db, (l) => l.action === 'removed' && l.factId === c.id)!
    undoItem(w.db, line.id)
    expect(changesOf(w.db, 'Mara').map((x) => x.id)).toEqual([c.id])
    // Nothing left saying its words are gone: the writer, "must stay true" and the checks see it.
    expect(hist.linksForFact(w.db, 'change', c.id).filter((l) => l.state !== 'ok')).toEqual([])
    expect(writerEntry(w.db, s2, 'Mara')!.fields.marks ?? '').toContain('knife')
    expect(mustLines(w.db, s2, ['Mara']).join('\n')).toContain('knife')
    // And later reads leave it be.
    saveParas(w.db, s1, [['p3', 'Mara said the tide would turn by nightfall.']])
    await readScene(w.db, fake, s1, { verdicts: 'none' })
    saveParas(w.db, s1, [['p3', 'Mara said the tide would surely turn by nightfall.']])
    await readScene(w.db, fake, s1, { verdicts: 'none' })
    expect(changesOf(w.db, 'Mara').map((x) => x.id)).toEqual([c.id])
    expect(writerEntry(w.db, s2, 'Mara')!.fields.marks ?? '').toContain('knife')
  })

  it('a field removed because its words were deleted', async () => {
    const w = testWorld(1)
    const [s1, s2] = w.scenes
    saveParas(w.db, s1, [
      ['p1', "Kell's eyes were grey."],
      ['p3', 'Kell said the tide would turn by dusk.']
    ])
    await readScene(w.db, fake, s1)
    expect(entryNamed(w.db, 'Kell')!.fields.eyes).toBe('grey')
    saveParas(w.db, s1, [['p3', 'Kell said the tide would turn by dusk.']])
    await readScene(w.db, fake, s1)
    expect(entryNamed(w.db, 'Kell')!.fields.eyes ?? '').toBe('')
    const line = logLine(w.db, (l) => l.action === 'removed' && l.text.startsWith('Eyes:'))!
    undoItem(w.db, line.id)
    const kell = entryNamed(w.db, 'Kell')!
    expect(kell.fields.eyes).toBe('grey')
    expect(hist.linksForEntry(w.db, kell.id).filter((l) => hist.isFieldLink(l, 'eyes') && l.state !== 'ok')).toEqual([])
    expect(writerEntry(w.db, s2, 'Kell')!.fields.eyes).toBe('grey')
  })

  it('a fact updated from edited words: Undo keeps the old one, not hidden or removed two reads later', async () => {
    const w = testWorld(1)
    const [s1, s2] = w.scenes
    saveParas(w.db, s1, [
      ['p1', 'The ferry was late.'],
      ['p2', MARA_RIVER]
    ])
    await readScene(w.db, fake, s1)
    const [c] = changesOf(w.db, 'Mara')
    saveParas(w.db, s1, [
      ['p1', 'The ferry was late.'],
      ['p2', 'Mara lost her knife on the bank.']
    ])
    await readScene(w.db, fake, s1)
    expect(mem.getChange(w.db, c.id).payload).toMatchObject({ note: 'lost her knife on the bank' })
    const line = logLine(w.db, (l) => l.action === 'updated' && l.factId === c.id)!
    undoItem(w.db, line.id)
    expect(mem.getChange(w.db, c.id).payload).toMatchObject({ note: 'lost her knife in the river' })
    expect(writerEntry(w.db, s2, 'Mara')!.fields.marks ?? '').toContain('river')
    // Two more reads with no verdict: still there, still given to the writer, not updated again from the same words.
    saveParas(w.db, s1, [
      ['p1', 'The ferry was very late.'],
      ['p2', 'Mara lost her knife on the bank.']
    ])
    await readScene(w.db, fake, s1, { verdicts: 'none' })
    saveParas(w.db, s1, [
      ['p1', 'The old ferry was very late.'],
      ['p2', 'Mara lost her knife on the bank.']
    ])
    await readScene(w.db, fake, s1, { verdicts: 'none' })
    expect(changesOf(w.db, 'Mara').map((x) => x.id)).toEqual([c.id])
    expect(mem.getChange(w.db, c.id).payload).toMatchObject({ note: 'lost her knife in the river' })
    expect(writerEntry(w.db, s2, 'Mara')!.fields.marks ?? '').toContain('river')
  })
})

describe('the world builder’s drafts', () => {
  it('are never removed when the words that said the same go', async () => {
    const w = testWorld(1)
    const [s1, s2] = w.scenes
    const kell = repo.createEntry(w.db, 'character', { name: 'Kell' })
    repo.updateEntry(w.db, kell.id, { fields: { eyes: 'grey' } }, { origin: 'ai' })
    saveParas(w.db, s1, [
      ['p1', "Kell's eyes were grey."],
      ['p3', 'Kell said the tide would turn by dusk.']
    ])
    await readScene(w.db, fake, s1)
    // The words agree with the draft, but it doesn't come to rest on them.
    expect(hist.linksForEntry(w.db, kell.id).filter((l) => hist.isFieldLink(l, 'eyes'))).toEqual([])
    saveParas(w.db, s1, [['p3', 'Kell said the tide would turn by dusk.']])
    await readScene(w.db, fake, s1)
    expect(entryNamed(w.db, 'Kell')!.fields.eyes).toBe('grey')
    expect(writerEntry(w.db, s2, 'Kell')!.fields.eyes).toBe('grey')
  })

  it('are kept even when an older version left them resting on words that then go', async () => {
    const w = testWorld(1)
    const [s1] = w.scenes
    const kell = repo.createEntry(w.db, 'character', { name: 'Kell' })
    repo.updateEntry(w.db, kell.id, { fields: { eyes: 'grey' } }, { origin: 'ai' })
    saveParas(w.db, s1, [
      ['p1', "Kell's eyes were grey."],
      ['p3', 'Kell said the tide would turn by dusk.']
    ])
    await readScene(w.db, fake, s1)
    const v = kdb.keeperScene(w.db, s1)!.textVersion
    hist.addLink(w.db, { factKind: 'field', factId: kell.id, field: 'eyes', sceneId: s1, sceneVersion: v, paragraphId: 'p1', start: 0, end: 22, quote: "Kell's eyes were grey." })
    saveParas(w.db, s1, [['p3', 'Kell said the tide would turn by dusk.']])
    await readScene(w.db, fake, s1)
    expect(entryNamed(w.db, 'Kell')!.fields.eyes).toBe('grey')
  })
})

// About forty words each, invented.
const HARBOUR =
  'The harbour lay grey under a low sky, and the fishing boats rocked at their moorings while the gulls quarrelled over scraps on the stones. Nobody hurried; the tide would not turn for hours, and the nets still hung drying on the rails.'
const MARKET =
  'Up the hill the market was setting out its stalls, apples and rope and lamp oil, the traders calling to one another across the square. A cart with a broken wheel stood abandoned by the fountain, its load of turnips spilling slowly.'
const CHAPEL_EDITED =
  'Night fell quickly over Kestrel Point; lanterns flickered along every quay while sailors argued loudly about wages, storms, debts owed and whose turn it was to buy rum tonight. Two boys raced barrels downhill, shrieking, until somebody shouted from a window above. Somewhere distant, dogs barked twice, then went silent until dawn broke cold.'

const summaryOptions = (db: DB): SummaryOptions => ({
  db,
  model: fakeModel(fake),
  signal: new AbortController().signal,
  closed: () => false,
  retryDelays: [0]
})

describe('a scene summary', () => {
  it('isn’t due after a typo or a small edit in a paragraph that names someone', async () => {
    const w = testWorld(1)
    const [s1, s2] = w.scenes
    saveParas(w.db, s1, [
      ['p1', MARA_RIVER],
      ['p2', HARBOUR],
      ['p3', MARKET]
    ])
    await readScene(w.db, fake, s1)
    expect(await writeSceneSummary(summaryOptions(w.db), s1, null, 'Ch 1, Sc 1')).toBe(true)
    expect(sceneSummaryDue(w.db, s1, false)).toBe(false)
    // A typo.
    saveParas(w.db, s1, [
      ['p1', 'Mara lost her knif in the river.'],
      ['p2', HARBOUR],
      ['p3', MARKET]
    ])
    expect(sceneSummaryDue(w.db, s1, false)).toBe(false)
    // A word or two changed, naming no one new.
    saveParas(w.db, s1, [
      ['p1', 'Mara lost her old knife in the cold river.'],
      ['p2', HARBOUR],
      ['p3', MARKET]
    ])
    expect(sceneSummaryDue(w.db, s1, false)).toBe(false)
    // So the writer isn't told it is being updated either.
    expect(writerMemory(w.db, s2).storySoFar.scenes.find((x) => x.sceneId === s1)!.updating).toBeFalsy()
    // The paragraph rewritten (eight words or more changed): due.
    saveParas(w.db, s1, [
      ['p1', 'Mara found her brother’s knife lying in the reeds beside the mill that morning.'],
      ['p2', HARBOUR],
      ['p3', MARKET]
    ])
    expect(sceneSummaryDue(w.db, s1, false)).toBe(true)
  })
})

describe('before a draft', () => {
  it('the scene’s own fresh read goes before summary jobs for earlier scenes', async () => {
    const w = testWorld(1)
    const [s1, s2] = w.scenes
    saveParas(w.db, s1, [
      ['p1', HARBOUR],
      ['p2', MARKET]
    ])
    await readScene(w.db, fake, s1)
    expect(await writeSceneSummary(summaryOptions(w.db), s1, null, 'Ch 1, Sc 1')).toBe(true)
    // An earlier scene whose summary is now due (its words read), and unread words in this one.
    saveParas(w.db, s1, [
      ['p1', HARBOUR],
      ['p2', CHAPEL_EDITED]
    ])
    await readScene(w.db, fake, s1)
    expect(kdb.needsReading(w.db, s1)).toBe(false)
    expect(sceneSummaryDue(w.db, s1, false)).toBe(true)
    const order: string[] = []
    const shaped = shapedFetch({})
    const fetchImpl: typeof fetch = async (input, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { messages?: { role: string; content: unknown }[] }
      const system = textOf(body.messages?.find((m) => m.role === 'system')?.content)
      order.push(system.includes(READING_MARKER) ? 'read' : system.includes(SUMMARY_MARKER) ? 'summary' : 'other')
      return shaped(input, init)
    }
    const k = new Keeper({ db: w.db, model: () => fakeModel(fake), emitStatus: () => {}, emitChanged: () => {}, quietMs: 60_000, retryDelays: [0], fetchImpl })
    saveParas(w.db, s2, [['q1', 'Bryn lost her map.']], false)
    k.sceneSaved(s2)
    await k.beforeDraft(s2)
    expect(entryNamed(w.db, 'Bryn')).not.toBeNull()
    expect(order[0]).toBe('read')
    await k.whenIdle()
    k.stop()
    expect(order).toContain('summary')
  })
})

describe('an edited fact whose paragraph was then joined to another', () => {
  it('isn’t removed by the tidy-up while words much like it are still in the scene', async () => {
    const w = testWorld(1)
    const [s1] = w.scenes
    saveParas(w.db, s1, [
      ['p1', MARA_RIVER],
      ['p3', TIDE]
    ])
    await readScene(w.db, fake, s1)
    const [c] = changesOf(w.db, 'Mara')
    const [l] = hist.linksForFact(w.db, 'change', c.id)
    hist.updateLink(w.db, l.id, { state: 'changed', quote: MARA_RIVER })
    // p1 joined into p3, its words a little edited (an older version let this go unnoticed).
    saveParas(w.db, s1, [['p3', `Mara lost her old knife in the river. ${TIDE}`]], false)
    w.db.transaction(() => tidyMemory(w.db))()
    expect(changesOf(w.db, 'Mara').map((x) => x.id)).toEqual([c.id])
  })

  it('still goes when no words like it are left', async () => {
    const w = testWorld(1)
    const [s1] = w.scenes
    saveParas(w.db, s1, [
      ['p1', MARA_RIVER],
      ['p3', TIDE]
    ])
    await readScene(w.db, fake, s1)
    const [c] = changesOf(w.db, 'Mara')
    const [l] = hist.linksForFact(w.db, 'change', c.id)
    hist.updateLink(w.db, l.id, { state: 'changed', quote: MARA_RIVER })
    saveParas(w.db, s1, [['p3', TIDE]], false)
    w.db.transaction(() => tidyMemory(w.db))()
    expect(changesOf(w.db, 'Mara')).toEqual([])
  })
})
