// Who knows what, from who was there (World Memory Overhaul B5, 2026-10-08): when something is said or happens, the
// people on stage at that paragraph know it too (linked to the same words, so it follows edits like any fact), and "X
// does not know it" reaches the writer only when it rests on that or on Adam: a fact the memory read on its own says
// nothing of who doesn't know it. All text is invented; the memory model is the fake one, its replies shaped per test.

import type Database from 'better-sqlite3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ID } from '@shared/types'
import { defaultWritingPrefs, emptySceneCard } from '@shared/defaults'
import { startFakeProvider, type FakeProvider } from '../../../tests/fake-provider/server.mjs'
import { readScene, saveParas, testWorld } from '../../../tests/unit/keeperRead'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import * as kdb from '../db/keeper'
import { undoItem } from './undo'
import { onStageAt, WHISPERED } from './presence'
import { sceneParagraphs } from './text'
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
const mustLines = (db: DB, sceneId: ID, names: string[]): string => {
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
  }).join('\n')
}
const knowers = (db: DB, fact: string): string[] => {
  const names = new Map(repo.listEntries(db).map((e) => [e.id, e.name]))
  return mem
    .listAllChanges(db)
    .filter((c) => c.kind === 'knowledge' && c.payload.fact === fact)
    .map((c) => names.get(c.entryId) ?? '?')
    .sort()
}

/** A world whose scenes have Mara (point of view) and Tobin on the card, with Ash, Wren and a dog, Cinder, known. */
function cast(scenes = 2) {
  const w = testWorld(scenes)
  const db = w.db
  const person = (name: string) => repo.createEntry(db, 'character', { name })
  const mara = person('Mara')
  const tobin = person('Tobin')
  const ash = person('Ash')
  const wren = person('Wren')
  const cinder = repo.createEntry(db, 'character', { name: 'Cinder', summary: 'A grey dog.', tags: ['animal'] })
  for (const s of w.scenes) repo.updateSceneCard(db, s, { ...emptySceneCard(), povId: mara.id, presentIds: [tobin.id] })
  return { ...w, mara, tobin, ash, wren, cinder }
}

const SAID = '“The key is under the bell,” Mara said.'
const secret = (quote = SAID) => ({ type: 'said', kind: 'secret', entry: 'Mara', heard: [], fact: 'the key is under the bell', quote })

describe('who is on stage at a paragraph', () => {
  it('is the card’s people and anyone named just before, less who left, never an animal', () => {
    const paras = sceneParagraphs(
      {
        type: 'doc',
        content: ['Ash came in from the yard.', 'Rain on the glass.', 'Wren had gone to bed.', 'The fire was low.', SAID].map((t, i) => ({
          type: 'paragraph',
          attrs: { pid: `p${i}` },
          content: [{ type: 'text', text: t }]
        }))
      },
      ''
    )
    const people = [
      { id: 'm', name: 'Mara', kind: 'character' as const },
      { id: 't', name: 'Tobin', kind: 'character' as const },
      { id: 'a', name: 'Ash', kind: 'character' as const },
      { id: 'w', name: 'Wren', kind: 'character' as const },
      { id: 'c', name: 'Cinder', kind: 'character' as const, summary: 'A grey dog.' }
    ]
    // At p4: Ash was named three paragraphs back (too long ago), Wren two back.
    expect(onStageAt({ paras, index: 4, onCard: ['m', 't', 'c'], people, gone: [] })).toEqual(['m', 't', 'w'])
    expect(onStageAt({ paras, index: 1, onCard: ['m', 't'], people, gone: [] })).toEqual(['m', 't', 'a'])
    expect(onStageAt({ paras, index: 4, onCard: ['m', 't'], people, gone: [{ id: 't', index: 2 }] })).toEqual(['m', 'w'])
    expect(WHISPERED.test('Mara whispered to Tobin.')).toBe(true)
  })
})

describe('something said', () => {
  it('is known by everyone on stage, with who was there; who wasn’t there is told as not knowing it', async () => {
    const w = cast(1)
    const [s1, s2] = w.scenes
    saveParas(w.db, s1, [
      ['p1', 'Ash came in from the yard, shaking off the rain.'],
      ['p2', SAID]
    ])
    await readScene(w.db, fake, s1, { add: [secret()] })
    expect(knowers(w.db, 'the key is under the bell')).toEqual(['Ash', 'Mara', 'Tobin'])
    const c = mem.listAllChanges(w.db).find((x) => x.kind === 'knowledge' && x.entryId === w.tobin.id)!
    expect(c.kind === 'knowledge' && [...(c.payload.there ?? [])].sort()).toEqual([w.ash.id, w.mara.id, w.tobin.id].sort())
    // Wren wasn't there.
    expect(mustLines(w.db, s2, ['Mara', 'Wren'])).toContain('Kept from Wren: the key is under the bell')
    // Not kept from the dog.
    expect(mustLines(w.db, s2, ['Mara', 'Cinder'])).not.toContain('Kept from')
  })

  it('whispered, it reaches only those the memory model says heard it', async () => {
    const w = cast(1)
    const [s1] = w.scenes
    const WHISPER = 'Ash came in. Mara whispered to Tobin, “The key is under the bell.”'
    saveParas(w.db, s1, [['p1', WHISPER]])
    await readScene(w.db, fake, s1, { add: [{ ...secret('Mara whispered to Tobin, “The key is under the bell.”'), heard: ['Tobin'] }] })
    expect(knowers(w.db, 'the key is under the bell')).toEqual(['Mara', 'Tobin'])
  })

  it('leaves out someone who left earlier in the scene', async () => {
    const w = cast(1)
    const [s1] = w.scenes
    saveParas(w.db, s1, [
      ['p1', 'Ash left the inn without a word.'],
      ['p2', 'The fire hissed.'],
      ['p3', SAID]
    ])
    await readScene(w.db, fake, s1, {
      add: [{ type: 'change', entry: 'Ash', note: 'left the inn', quote: 'Ash left the inn without a word.' }, secret()]
    })
    expect(knowers(w.db, 'the key is under the bell')).toEqual(['Mara', 'Tobin'])
  })
})

describe('something seen happening', () => {
  it('is known by everyone on stage, and goes with the event’s Undo', async () => {
    const w = cast(1)
    const [s1] = w.scenes
    const FELL = 'The chapel bell fell into the sea while Ash watched.'
    saveParas(w.db, s1, [['p1', FELL]])
    await readScene(w.db, fake, s1, { add: [{ type: 'event', name: 'The bell falls', summary: 'The chapel bell fell into the sea', involved: [], quote: FELL }] })
    expect(knowers(w.db, 'The chapel bell fell into the sea')).toEqual(['Ash', 'Mara', 'Tobin'])
    const line = kdb.listLog(w.db, { limit: 50 }).find((l) => l.text === 'New event')!
    expect(kdb.listLog(w.db, { limit: 50 }).some((l) => l.text === 'Saw it happen: The chapel bell fell into the sea')).toBe(true)
    undoItem(w.db, line.id)
    expect(knowers(w.db, 'The chapel bell fell into the sea')).toEqual([])
  })
})

describe('“does not know” only when it rests on who was there, or on Adam', () => {
  it('a fact the memory read on its own says nothing of who doesn’t know it', async () => {
    const w = cast(1)
    const [s1, s2] = w.scenes
    saveParas(w.db, s1, [['p1', 'Tobin learned that the bridge was out.']])
    await readScene(w.db, fake, s1)
    expect(knowers(w.db, 'the bridge was out')).toEqual(['Tobin'])
    expect(writerMemory(w.db, s2).facts.find((f) => f.fact === 'the bridge was out')?.backed).toBe(false)
    expect(mustLines(w.db, s2, ['Tobin', 'Wren'])).not.toContain('Kept from')
  })

  it('what Adam says someone knows does', () => {
    const w = cast(1)
    const [, s2] = w.scenes
    mem.insertChange(w.db, {
      kind: 'knowledge',
      payload: { factId: 'f-heir', fact: 'Mara is the heir' },
      entryId: w.mara.id,
      anchor: 'baseline',
      origin: 'adam'
    })
    expect(mustLines(w.db, s2, ['Mara', 'Wren'])).toContain('Kept from Wren: Mara is the heir')
  })
})
