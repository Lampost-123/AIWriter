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
import { entryNamed, readScene, saveParas, testWorld } from '../../../tests/unit/keeperRead'
import * as mem from '../db/memory'
import * as hist from '../db/history'
import * as kdb from '../db/keeper'
import { undoItem } from './undo'
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
