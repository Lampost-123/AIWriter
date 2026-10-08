// The memory check list (World Memory Overhaul B3) and "Check again now" (B2): everything the memory isn't sure about,
// in one place, with Keep, Remove (and its Undo), and a fresh read of one scene on request. All text is invented; the
// memory model is the fake one (tests/fake-provider), its replies shaped per test: no paid calls.

import type Database from 'better-sqlite3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ID } from '@shared/types'
import { defaultWritingPrefs } from '@shared/defaults'
import { startFakeProvider, type FakeProvider } from '../../../tests/fake-provider/server.mjs'
import { entryNamed, fakeModel, readScene, saveParas, shapedFetch, testWorld } from '../../../tests/unit/keeperRead'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import * as hist from '../db/history'
import * as kdb from '../db/keeper'
import { writeSceneSummary } from './summaries'
import { Keeper } from './engine'
import { undoItem } from './undo'
import { gatherContextInput } from '../ai/gather'
import { keepMemoryCheck, listMemoryChecks, removeMemoryCheck, undoMemoryCheck } from './checkQueue'

let fake: FakeProvider
beforeAll(async () => {
  fake = await startFakeProvider({ delayMs: 0 })
})
afterAll(() => fake.close())

type DB = Database.Database

const writerEntry = (db: DB, sceneId: ID, name: string) =>
  gatherContextInput(db, sceneId, undefined, { prefs: defaultWritingPrefs(), contextLength: 32000, creativity: 'balanced' }).memory.entries.find(
    (e) => e.name === name
  ) ?? null

const MARA_RIVER = 'Mara lost her knife in the river.'
const MARA_REEDS = 'The knife slipped from her belt into the reeds.'

/** Mara's knife, read from the text, then its words edited and the model giving no verdict: unconfirmed. */
async function unconfirmedKnife() {
  const w = testWorld(1)
  const [s1, s2] = w.scenes
  saveParas(w.db, s1, [
    ['p1', 'Mara laughed at the ferryman.'],
    ['p2', MARA_RIVER]
  ])
  await readScene(w.db, fake, s1)
  const mara = entryNamed(w.db, 'Mara')!
  const [c] = mem.changesForEntry(w.db, mara.id)
  saveParas(w.db, s1, [
    ['p1', 'Mara laughed at the ferryman.'],
    ['p2', MARA_REEDS]
  ])
  await readScene(w.db, fake, s1, { verdicts: 'none' })
  expect(hist.linksForFact(w.db, 'change', c.id).map((l) => l.state)).toEqual(['changed'])
  return { ...w, s1, s2, mara, change: c }
}

const forChange = (db: DB, id: ID) => listMemoryChecks(db).find((i) => i.fact.kind === 'change' && i.fact.changeId === id)

describe('the memory check list', () => {
  it('lists a fact whose words were edited and not yet confirmed, with the words and paragraph to show', async () => {
    const w = await unconfirmedKnife()
    const item = forChange(w.db, w.change.id)!
    expect(item).toMatchObject({
      group: 'unconfirmed',
      entryId: w.mara.id,
      entryName: 'Mara',
      sceneId: w.s1,
      quote: MARA_RIVER,
      paragraphId: 'p2'
    })
    expect(item.text).toMatch(/knife in the river/i)
    expect(item.where).toMatch(/Ch 1, Sc 1/)
  })

  it('lists the memory’s guesses on entries it found in the text, never the world builder’s drafts or Adam’s own', async () => {
    const w = testWorld(1)
    const [s1] = w.scenes
    saveParas(w.db, s1, [['p1', 'Kell learned that the bridge was down.']])
    await readScene(w.db, fake, s1)
    const kell = entryNamed(w.db, 'Kell')!
    repo.updateEntry(w.db, kell.id, { fields: { ...kell.fields, hair: 'black' } }, { origin: 'ai' })
    // The world builder's draft on Adam's own entry, and a field Adam typed himself.
    const oskar = repo.createEntry(w.db, 'character', { name: 'Oskar', fields: { eyes: 'brown' } })
    repo.updateEntry(w.db, oskar.id, { fields: { eyes: 'brown', hair: 'red' } }, { origin: 'ai' })
    const items = listMemoryChecks(w.db)
    const guesses = items.filter((i) => i.group === 'guess')
    expect(guesses.map((i) => [i.entryName, i.fact])).toEqual([['Kell', { kind: 'field', entryId: kell.id, field: 'hair' }]])
    expect(guesses[0].text).toBe('Hair: black')
    expect(items.some((i) => i.entryId === oskar.id)).toBe(false)
  })

  it('lists a scene summary being brought up to date', async () => {
    const w = testWorld(1)
    const [s1] = w.scenes
    const long = (s: string) => `${s} `.repeat(12).trim()
    saveParas(w.db, s1, [
      ['p1', long('The harbour lay grey under a low sky.')],
      ['p2', long('The market was setting out its stalls.')]
    ])
    expect(
      await writeSceneSummary(
        {
          db: w.db,
          model: fakeModel(fake),
          signal: new AbortController().signal,
          closed: () => false,
          retryDelays: [0],
          fetchImpl: (input, init) => fetch(input, init)
        },
        s1,
        null,
        'Ch 1, Sc 1'
      )
    ).toBe(true)
    expect(listMemoryChecks(w.db).filter((i) => i.group === 'summary')).toEqual([])
    saveParas(w.db, s1, [
      ['p1', long('The harbour lay grey under a low sky.')],
      ['p2', long('Night came down over the quays and every lantern was lit.')]
    ])
    const [item] = listMemoryChecks(w.db).filter((i) => i.group === 'summary')
    expect(item).toMatchObject({ fact: { kind: 'summary', sceneId: s1 }, sceneId: s1, entryId: null })
    expect(item.text.length).toBeGreaterThan(0)
  })

  it('lists a quiet note about one of Adam’s own facts until it is dismissed', async () => {
    const w = testWorld(1)
    const [s1] = w.scenes
    saveParas(w.db, s1, [
      ['p1', MARA_RIVER],
      ['p2', 'The ferry was late.']
    ])
    await readScene(w.db, fake, s1)
    const [c] = mem.listAllChanges(w.db)
    // Adam makes the knife his own, then the words go: the memory leaves his fact alone and says so quietly.
    mem.replaceChange(w.db, c.id, { kind: 'update', payload: { note: 'lost her knife in the Sel' }, entryId: c.entryId, anchor: 'scene', sceneId: s1, origin: 'adam' })
    saveParas(w.db, s1, [['p2', 'The ferry was very late.']])
    await readScene(w.db, fake, s1)
    const note = listMemoryChecks(w.db).find((i) => i.group === 'note')!
    expect(note).toMatchObject({ entryName: 'Mara', fact: { kind: 'note' }, quote: MARA_RIVER })
    expect(note.text).toMatch(/no longer says this/)
    // Keep: the note is dismissed, his fact stays as it is.
    keepMemoryCheck(w.db, note.fact)
    expect(listMemoryChecks(w.db).some((i) => i.group === 'note')).toBe(false)
    expect(mem.getChange(w.db, c.id).payload).toEqual({ note: 'lost her knife in the Sel' })
    const line = kdb.listLog(w.db).find((l) => (l.undo as { op?: string } | null)?.op === 'note')!
    expect(line.undone).toBe(true)
  })

  it('Keep makes an unconfirmed fact Adam’s: it no longer rests on the words, and the writer has it again', async () => {
    const w = await unconfirmedKnife()
    expect(writerEntry(w.db, w.s2, 'Mara')!.fields.marks ?? '').not.toContain('knife')
    keepMemoryCheck(w.db, { kind: 'change', changeId: w.change.id })
    expect(mem.getChange(w.db, w.change.id).origin).toBe('adam')
    expect(hist.linksForFact(w.db, 'change', w.change.id)).toEqual([])
    expect(forChange(w.db, w.change.id)).toBeUndefined()
    expect(writerEntry(w.db, w.s2, 'Mara')!.fields.marks).toContain('knife')
    // And the next read without a verdict doesn't take it away.
    saveParas(w.db, w.s1, [
      ['p1', 'Mara laughed at the old ferryman.'],
      ['p2', MARA_REEDS]
    ])
    await readScene(w.db, fake, w.s1, { verdicts: 'none' })
    expect(mem.getChange(w.db, w.change.id).id).toBe(w.change.id)
  })

  it('Keep makes a guess Adam’s', async () => {
    const w = testWorld(1)
    const [s1] = w.scenes
    saveParas(w.db, s1, [['p1', 'Kell learned that the bridge was down.']])
    await readScene(w.db, fake, s1)
    const kell = entryNamed(w.db, 'Kell')!
    repo.updateEntry(w.db, kell.id, { fields: { ...kell.fields, hair: 'black' } }, { origin: 'ai' })
    keepMemoryCheck(w.db, { kind: 'field', entryId: kell.id, field: 'hair' })
    const after = entryNamed(w.db, 'Kell')!
    expect(after.fields.hair).toBe('black')
    expect(after.fieldOrigins.hair).toBe('adam')
    expect(listMemoryChecks(w.db).filter((i) => i.group === 'guess')).toEqual([])
  })

  it('Remove takes an unconfirmed fact out, and Undo brings it back as it was', async () => {
    const w = await unconfirmedKnife()
    const undo = removeMemoryCheck(w.db, { kind: 'change', changeId: w.change.id })
    expect(mem.changesForEntry(w.db, w.mara.id)).toEqual([])
    expect(forChange(w.db, w.change.id)).toBeUndefined()
    undoMemoryCheck(w.db, undo)
    expect(mem.changesForEntry(w.db, w.mara.id).map((c) => c.id)).toEqual([w.change.id])
    expect(forChange(w.db, w.change.id)).toBeDefined()
  })

  it('Remove clears a guess, and Undo puts the guess back', async () => {
    const w = testWorld(1)
    const [s1] = w.scenes
    saveParas(w.db, s1, [['p1', 'Kell learned that the bridge was down.']])
    await readScene(w.db, fake, s1)
    const kell = entryNamed(w.db, 'Kell')!
    repo.updateEntry(w.db, kell.id, { fields: { ...kell.fields, hair: 'black' } }, { origin: 'ai' })
    const undo = removeMemoryCheck(w.db, { kind: 'field', entryId: kell.id, field: 'hair' })
    expect(entryNamed(w.db, 'Kell')!.fields.hair ?? '').toBe('')
    expect(listMemoryChecks(w.db).filter((i) => i.group === 'guess')).toEqual([])
    undoMemoryCheck(w.db, undo)
    const back = entryNamed(w.db, 'Kell')!
    expect(back.fields.hair).toBe('black')
    expect(back.fieldOrigins.hair).toBe('ai')
    expect(listMemoryChecks(w.db).filter((i) => i.group === 'guess')).toHaveLength(1)
  })

  it('a note undone from What changed leaves the list too', async () => {
    const w = await unconfirmedKnife()
    const line = kdb.insertLog(w.db, {
      runId: kdb.startRun(w.db, w.s1, 1),
      sceneId: w.s1,
      entryName: 'Mara',
      text: 'Lost her knife in the river: the scene no longer says this (yours is kept as it is)',
      before: '',
      after: '',
      action: 'updated',
      what: 'change',
      entryId: w.mara.id,
      factId: w.change.id,
      quote: MARA_RIVER,
      question: null,
      undo: { op: 'note', key: `no-longer:change:${w.change.id}:x` }
    })
    expect(listMemoryChecks(w.db).some((i) => i.fact.kind === 'note' && i.fact.logId === line.id)).toBe(true)
    undoItem(w.db, line.id)
    expect(listMemoryChecks(w.db).some((i) => i.fact.kind === 'note' && i.fact.logId === line.id)).toBe(false)
  })
})

describe('Check again now', () => {
  it('reads the scene again for a fact left unconfirmed, though its text has not changed since the last read', async () => {
    const w = await unconfirmedKnife()
    expect(kdb.keeperScene(w.db, w.s1)!.memoryState).toBe('current')
    const asked: string[] = []
    const k = new Keeper({
      db: w.db,
      model: () => fakeModel(fake),
      emitStatus: () => {},
      emitChanged: () => {},
      quietMs: 60_000,
      summaries: false,
      retryDelays: [0],
      fetchImpl: shapedFetch({}, asked)
    })
    k.checkAgain(w.s1)
    await k.whenIdle()
    k.stop()
    expect(asked).toHaveLength(1)
    expect(asked[0]).toMatch(/^- F\d+ change E\d+: lost her knife in the river/m)
    expect(kdb.keeperScene(w.db, w.s1)!.memoryState).toBe('current')
  })

  it('asks the model nothing when nothing in the scene is unsure', async () => {
    const w = testWorld(1)
    const [s1] = w.scenes
    saveParas(w.db, s1, [['p1', MARA_RIVER]])
    await readScene(w.db, fake, s1)
    const asked: string[] = []
    const k = new Keeper({
      db: w.db,
      model: () => fakeModel(fake),
      emitStatus: () => {},
      emitChanged: () => {},
      quietMs: 60_000,
      summaries: false,
      retryDelays: [0],
      fetchImpl: shapedFetch({}, asked)
    })
    k.checkAgain(s1)
    await k.whenIdle()
    k.stop()
    expect(asked).toEqual([])
  })
})
