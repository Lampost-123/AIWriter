// Memory sync, review fixes (World Memory Overhaul, 2026-10-08): Undo of "True again" lasts; the memory never ends
// what the world builder or a story flow made (Adam's, even where stored as the AI's); an "end" ends the learning that
// is true at that scene. All text is invented; the memory model is the fake one (tests/fake-provider): no paid calls.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startFakeProvider, type FakeProvider } from '../../../tests/fake-provider/server.mjs'
import { readScene, saveParas, testWorld } from '../../../tests/unit/keeperRead'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import * as kdb from '../db/keeper'
import { undoItem } from './undo'

let fake: FakeProvider
beforeAll(async () => {
  fake = await startFakeProvider({ delayMs: 0 })
})
afterAll(() => fake.close())

const LOST = 'Mara lost her knife.'
const FOUND = 'The next morning, Mara found her knife again.'

describe('Undo of "True again"', () => {
  it('lasts: the end stays through the next read of that scene, with one "True again" line', async () => {
    const w = testWorld(2)
    const [s1, s2] = w.scenes
    saveParas(w.db, s1, [['p1', LOST]])
    await readScene(w.db, fake, s1)
    saveParas(w.db, s2, [['p2', 'The ferry was late.'], ['p3', FOUND]])
    await readScene(w.db, fake, s2)
    const mara = repo.listEntries(w.db).find((e) => e.name === 'Mara')!
    const c = mem.changesForEntry(w.db, mara.id)[0]
    expect(mem.getChange(w.db, c.id).until?.sceneId).toBe(s2)
    // The words that ended it are deleted: true again.
    saveParas(w.db, s2, [['p2', 'The ferry was late.']])
    await readScene(w.db, fake, s2)
    expect(mem.getChange(w.db, c.id).until).toBeUndefined()
    const trueAgain = () => kdb.listLog(w.db, { limit: 100 }).filter((l) => l.factId === c.id && l.text.startsWith('True again'))
    expect(trueAgain()).toHaveLength(1)
    undoItem(w.db, trueAgain()[0].id)
    expect(mem.getChange(w.db, c.id).until?.sceneId).toBe(s2)
    // An edit elsewhere in the scene, read again: the end Adam kept stays.
    saveParas(w.db, s2, [['p2', 'The ferry was late.'], ['p5', 'The gulls were loud.']])
    await readScene(w.db, fake, s2)
    expect(mem.getChange(w.db, c.id).until?.sceneId).toBe(s2)
    expect(trueAgain()).toHaveLength(1)
  })
})

describe('what the world builder or a story flow made', () => {
  const builderMara = (w: ReturnType<typeof testWorld>) => {
    const mara = repo.createEntry(w.db, 'character', { name: 'Mara' })
    // The world builder (and a story flow) store their changes as drafted by the AI, on an entry Adam made.
    const c = mem.insertChange(w.db, { kind: 'update', payload: { note: 'lost her knife' }, entryId: mara.id, anchor: 'baseline', origin: 'ai' })
    return { mara, c }
  }
  const note = (w: ReturnType<typeof testWorld>, id: string) =>
    kdb.listLog(w.db, { limit: 100 }).filter((l) => l.factId === id && l.text.endsWith('the scene says this is no longer true (yours is kept as it is)'))

  it('is never ended by the memory: a quiet note instead', async () => {
    const w = testWorld(2)
    const [, s2] = w.scenes
    const { c } = builderMara(w)
    saveParas(w.db, s2, [['p2', FOUND]])
    await readScene(w.db, fake, s2)
    expect(mem.getChange(w.db, c.id).until).toBeUndefined()
    expect(note(w, c.id)).toHaveLength(1)
  })

  it('stays Adam’s after he edits it', async () => {
    const w = testWorld(2)
    const [, s2] = w.scenes
    const { c } = builderMara(w)
    mem.replaceChange(w.db, c.id, { kind: 'update', payload: { note: 'lost her knife in the river' }, entryId: c.entryId, anchor: 'baseline', origin: 'adam' })
    saveParas(w.db, s2, [['p2', FOUND]])
    await readScene(w.db, fake, s2)
    expect(mem.getChange(w.db, c.id).until).toBeUndefined()
  })
})
