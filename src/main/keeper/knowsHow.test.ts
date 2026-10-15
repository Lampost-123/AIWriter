// The who-knows-what ledger (long story memory fix 9), as the memory keeper fills it: a "knows" item says how it was
// learned and from whom, and whether it is a belief that isn't true; a belief is kept apart from what is known and can be
// ended when they see through it. Made-up scenes, read by the fake memory model with items added: no paid calls.

import type Database from 'better-sqlite3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ID } from '@shared/types'
import { startFakeProvider, type FakeProvider } from '../../../tests/fake-provider/server.mjs'
import { entryNamed, readScene, saveParas, testWorld } from '../../../tests/unit/keeperRead'
import * as mem from '../db/memory'
import * as repo from '../db/repo'
import * as kdb from '../db/keeper'
import { READING_SYSTEM } from './prompts'
import { knowHow } from './apply'
import { readingBudget } from './request'
import { sceneMemory, ledgerForScene } from '../memory/scene'

let fake: FakeProvider
beforeAll(async () => {
  fake = await startFakeProvider({ delayMs: 0 })
})
afterAll(() => fake.close())

const CAST = 'Mara lost her hat. Tobin lost his oar. Ash lost his bag.'
const TOLD = '“The will was burned,” Ash whispered to Tobin.'
const LIE = 'Tobin was sure the letter was genuine.'

const knowledge = (db: Database.Database, entryId: ID) =>
  mem.changesForEntry(db, entryId).flatMap((c) => (c.kind === 'knowledge' && c.entryId === entryId ? [c] : []))

describe('the reading prompt asks how it was learned, within its room', () => {
  it('has the knows item with how, from and wrong, and still fits a 3,000-token model', () => {
    expect(READING_SYSTEM).toContain('"how": "saw|told|overheard|read|guessed", "from": "E1", "wrong": false')
    expect(READING_SYSTEM).toContain('- Knows: give "how" and, if told or overheard, "from" whom; "wrong": true if what they believe isn\'t true.')
    expect(READING_SYSTEM).toContain('known fact or wrong belief no longer true')
    expect(READING_SYSTEM.length).toBeLessThanOrEqual(6000)
    expect(readingBudget({ contextLength: 3000, maxOutput: null })).not.toBeNull()
  })

  it('reads the way it was learned from the first word, whatever the model calls it', () => {
    expect(knowHow('saw')).toBe('saw')
    expect(knowHow('Witnessed')).toBe('saw')
    expect(knowHow('told by Ash')).toBe('told')
    expect(knowHow('heard')).toBe('told')
    expect(knowHow('overheard')).toBe('overheard')
    expect(knowHow('read')).toBe('read')
    expect(knowHow('inferred')).toBe('guessed')
    expect(knowHow('dreamt')).toBeUndefined()
    expect(knowHow(undefined)).toBeUndefined()
    expect(knowHow(7)).toBeUndefined()
  })
})

describe('a knows item', () => {
  it('keeps how and from whom, and the next scene knows since when', async () => {
    const w = testWorld(1)
    saveParas(w.db, w.scenes[0], [
      ['a', CAST],
      ['b', TOLD]
    ])
    await readScene(w.db, fake, w.scenes[0], {
      add: [{ type: 'knows', entry: 'Tobin', fact: 'The will was burned', how: 'told', from: 'Ash', quote: TOLD }]
    })
    const [tobin, ash] = [entryNamed(w.db, 'Tobin')!, entryNamed(w.db, 'Ash')!]
    const [c] = knowledge(w.db, tobin.id)
    expect(c.payload).toMatchObject({ fact: 'The will was burned', how: 'told', from: ash.id })
    expect(c.payload.wrong).toBeUndefined()
    const fact = sceneMemory(w.db, w.scenes[1]).facts.find((f) => f.factId === c.payload.factId)!
    expect(fact.since?.[tobin.id]).toMatchObject({ how: 'told', from: ash.id, sceneId: w.scenes[0] })
    expect(ledgerForScene(w.db, w.scenes[1]).couldKnow(tobin.id, c.payload.factId)).toMatchObject({ knows: true })
    // Not before the scene it was learned in.
    expect(ledgerForScene(w.db, w.scenes[0]).couldKnow(tobin.id, c.payload.factId).knows).toBe(false)
  })

  it('keeps no "from" that isn’t someone else, and no "how" it doesn’t know', async () => {
    const w = testWorld(1)
    saveParas(w.db, w.scenes[0], [
      ['a', CAST],
      ['b', TOLD]
    ])
    await readScene(w.db, fake, w.scenes[0], {
      add: [
        { type: 'knows', entry: 'Tobin', fact: 'The will was burned', how: 'told', from: 'Tobin', quote: TOLD },
        { type: 'knows', entry: 'Mara', fact: 'Ash keeps secrets', how: 'dreamt', from: 'Ash', quote: TOLD }
      ]
    })
    const [tobin, mara, ash] = [entryNamed(w.db, 'Tobin')!, entryNamed(w.db, 'Mara')!, entryNamed(w.db, 'Ash')!]
    expect(knowledge(w.db, tobin.id)[0].payload).toMatchObject({ how: 'told' })
    expect(knowledge(w.db, tobin.id)[0].payload.from).toBeUndefined()
    // No way it knows, but someone named as telling them: they were told.
    expect(knowledge(w.db, mara.id)[0].payload).toMatchObject({ from: ash.id })
  })
})

describe('a belief that isn’t true', () => {
  async function believed() {
    const w = testWorld(2)
    saveParas(w.db, w.scenes[0], [
      ['a', CAST],
      ['b', LIE]
    ])
    await readScene(w.db, fake, w.scenes[0], {
      add: [
        { type: 'knows', entry: 'Ash', fact: 'The letter is genuine', quote: LIE },
        { type: 'knows', entry: 'Tobin', fact: 'The letter is genuine', wrong: true, quote: LIE }
      ]
    })
    return { ...w, tobin: entryNamed(w.db, 'Tobin')!, ash: entryNamed(w.db, 'Ash')! }
  }

  it('is kept as a belief, never as knowledge, and never shares an id with a fact someone knows', async () => {
    const w = await believed()
    const [belief] = knowledge(w.db, w.tobin.id)
    const [known] = knowledge(w.db, w.ash.id)
    expect(belief.payload.wrong).toBe(true)
    expect(belief.payload.factId).not.toBe(known.payload.factId)
    const m = sceneMemory(w.db, w.scenes[1])
    expect(m.beliefs?.map((b) => [b.fact, b.believedBy])).toEqual([['The letter is genuine', [w.tobin.id]]])
    expect(m.facts.find((f) => f.factId === belief.payload.factId)).toBeUndefined()
    expect(mem.listFacts(w.db).find((f) => f.factId === belief.payload.factId)?.wrong).toBe(true)
    expect(kdb.listLog(w.db).some((l) => l.text === 'Wrongly believes the letter is genuine')).toBe(true)
  })

  it('is listed for the memory model as believed wrongly, and ends when they see through it', async () => {
    const w = await believed()
    const TRUTH = 'Tobin saw at last that the letter was forged.'
    saveParas(w.db, w.scenes[1], [['c', TRUTH]])
    const out = await readScene(w.db, fake, w.scenes[1], {
      add: [{ type: 'end', entry: 'Tobin', fact: 'The letter is genuine', quote: TRUTH }]
    })
    expect(out.asked.join('\n')).toMatch(/- K\d+ "The letter is genuine": wrongly believed by E\d+/)
    const [belief] = knowledge(w.db, w.tobin.id)
    expect(belief.until?.sceneId).toBe(w.scenes[1])
    expect(sceneMemory(w.db, w.scenes[1]).beliefs?.length).toBe(1)
    expect(sceneMemory(w.db, w.scenes[2]).beliefs).toEqual([])
  })
})

describe('Adam’s own knowledge', () => {
  it('keeps how, from whom and a belief that isn’t true; never a "from" that is themselves, nor a way it doesn’t know', () => {
    const { db } = testWorld(0)
    const ash = repo.createEntry(db, 'character', { name: 'Ash' })
    const tobin = repo.createEntry(db, 'character', { name: 'Tobin' })
    const clean = (payload: object) => mem.cleanChangeInput(db, { entryId: tobin.id, anchor: 'baseline', kind: 'knowledge', payload } as never).payload
    expect(clean({ factId: 'f', fact: 'The ford is safe', how: 'told', from: ash.id, wrong: true })).toEqual({
      factId: 'f',
      fact: 'The ford is safe',
      how: 'told',
      from: ash.id,
      wrong: true
    })
    expect(clean({ factId: 'f', fact: 'The ford is safe', how: 'dreamt', from: tobin.id, wrong: false })).toEqual({ factId: 'f', fact: 'The ford is safe' })
  })
})
