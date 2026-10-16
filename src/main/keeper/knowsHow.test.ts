// The who-knows-what ledger (long story memory fix 9), as the memory keeper fills it: a "knows" item says how it was
// learned and from whom, and whether it is a belief that isn't true; a belief is kept apart from what is known and can be
// ended when they see through it. Made-up scenes, read by the fake memory model with items added: no paid calls.

import type Database from 'better-sqlite3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ID } from '@shared/types'
import { startFakeProvider, type FakeProvider } from '../../../tests/fake-provider/server.mjs'
import { entryNamed, fakeModel, readScene, saveParas, testWorld, textOf } from '../../../tests/unit/keeperRead'
import * as mem from '../db/memory'
import * as repo from '../db/repo'
import * as kdb from '../db/keeper'
import { READING_MARKER, READING_SYSTEM } from './prompts'
import { knowHow } from './apply'
import { FACT_LINES, Ids, readingBudget } from './request'
import { runScene } from './run'
import { gatherContextInput } from '../ai/gather'
import { buildBlocks, MUST_BLOCK } from '../ai/context'
import { LEDGER_BLOCK } from '../ai/whoKnows'
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

// ---------- Fix 9 review ----------

/** Reads a scene with only these items in the reply: entries by name, a K by "belief:words" or "known:words", and verdicts. */
async function readNaming(
  db: Database.Database,
  sceneId: ID,
  items: Record<string, unknown>[],
  verdicts: (user: string) => Record<string, unknown>[] = () => []
): Promise<string[]> {
  const asked: string[] = []
  const fetchImpl: typeof fetch = async (input, init) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { messages?: { role: string; content: unknown }[] }
    if (!textOf(body.messages?.find((m) => m.role === 'system')?.content).includes(READING_MARKER)) return fetch(input, init)
    const user = textOf(body.messages?.find((m) => m.role === 'user')?.content)
    asked.push(user)
    const ids = new Map([...user.matchAll(/^- (E\d+) [a-z]+ "([^"]+)"/gm)].map((m) => [m[2], m[1]]))
    const ks = [...user.matchAll(/^- (K\d+) "([^"]+)"(: wrongly believed by)?/gm)]
    const kOf = (v: unknown): unknown => {
      const m = typeof v === 'string' ? /^(belief|known):(.*)$/.exec(v) : null
      return m ? (ks.find((x) => x[2] === m[2] && !!x[3] === (m[1] === 'belief'))?.[1] ?? v) : v
    }
    const add = items.map((a) => ({ ...a, entry: ids.get(String(a.entry)) ?? a.entry, ...('factId' in a ? { factId: kOf(a.factId) } : {}) }))
    const reply = { facts: verdicts(user), add, clashes: [] }
    const chunk = { choices: [{ index: 0, delta: { content: JSON.stringify(reply) }, finish_reason: 'stop' }] }
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
  }
  await runScene({ db, model: fakeModel(fake), signal: new AbortController().signal, closed: () => false, retryDelays: [0, 0], fetchImpl }, sceneId)
  return asked
}

/** Scene 1: the cast, and Tobin coming to believe wrongly that the letter is genuine (Ash knows it as true, apart). */
async function belief(extra = 2) {
  const w = testWorld(extra)
  saveParas(w.db, w.scenes[0], [
    ['a', CAST],
    ['b', LIE]
  ])
  await readScene(w.db, fake, w.scenes[0], { add: [{ type: 'knows', entry: 'Tobin', fact: 'The letter is genuine', wrong: true, quote: LIE }] })
  const tobin = entryNamed(w.db, 'Tobin')!
  const [held] = knowledge(w.db, tobin.id)
  expect(held.payload.wrong).toBe(true)
  return { ...w, tobin, factId: held.payload.factId, held }
}

const TRUTH = 'Tobin saw at last that the letter was forged.'

describe('a belief’s K named without "wrong" (fix 9 review)', () => {
  it('known: they have learned the truth, so the belief ends there, on its own id, and nothing new is known', async () => {
    const w = await belief()
    saveParas(w.db, w.scenes[1], [['c', TRUTH]])
    const asked = await readNaming(w.db, w.scenes[1], [{ type: 'knows', entry: 'Tobin', fact: 'The letter is genuine', factId: 'belief:The letter is genuine', quote: TRUTH }])
    expect(asked.join('\n')).toMatch(/: wrongly believed by E\d+/)
    const all = knowledge(w.db, w.tobin.id)
    expect(all).toHaveLength(1)
    expect(all[0].until?.sceneId).toBe(w.scenes[1])
    const after = sceneMemory(w.db, w.scenes[2])
    expect(after.beliefs).toEqual([])
    expect(after.facts.some((f) => f.factId === w.factId)).toBe(false)
    expect(ledgerForScene(w.db, w.scenes[2]).couldKnow(w.tobin.id, w.factId)).toEqual({ knows: false, believesWrongly: false, since: null })
  })

  it('forgotten: the belief is forgotten on its own id, whatever "wrong" the reply gives', async () => {
    const w = await belief()
    saveParas(w.db, w.scenes[1], [['c', TRUTH]])
    await readNaming(w.db, w.scenes[1], [{ type: 'knows', entry: 'Tobin', fact: 'The letter is genuine', factId: 'belief:The letter is genuine', forgets: true, quote: TRUTH }])
    const forgot = knowledge(w.db, w.tobin.id).find((c) => c.payload.forgets)!
    expect(forgot.payload).toMatchObject({ factId: w.factId, forgets: true, wrong: true })
    expect(sceneMemory(w.db, w.scenes[2]).beliefs).toEqual([])
    expect(kdb.listLog(w.db).some((l) => l.text === 'No longer believes the letter is genuine')).toBe(true)
  })

  it('the same words as a belief, known again without "wrong", are that belief again, in its own scene or a later one', async () => {
    const w = await belief()
    // Read again in the scene it was come to in, the model leaving "wrong" off this time.
    saveParas(w.db, w.scenes[0], [
      ['a', CAST],
      ['b', LIE],
      ['c', 'He folded the letter away.']
    ])
    await readNaming(w.db, w.scenes[0], [{ type: 'knows', entry: 'Tobin', fact: 'The letter is genuine', quote: LIE }])
    // And in a later scene.
    saveParas(w.db, w.scenes[1], [['c', 'Tobin still thought the letter genuine.']])
    await readNaming(w.db, w.scenes[1], [{ type: 'knows', entry: 'Tobin', fact: 'The letter is genuine', quote: 'Tobin still thought the letter genuine.' }])
    expect(knowledge(w.db, w.tobin.id).every((c) => c.payload.factId === w.factId && c.payload.wrong)).toBe(true)
    const m = sceneMemory(w.db, w.scenes[2])
    expect(m.beliefs?.map((b) => b.factId)).toEqual([w.factId])
    expect(m.facts.some((f) => f.knownBy.includes(w.tobin.id))).toBe(false)
  })

  it('a known K with "wrong" stays known: one fact id is never both', async () => {
    const w = await belief()
    const ash = entryNamed(w.db, 'Ash')!
    // Ash knows the will was burned; the reply then says Tobin believes it "wrongly", naming Ash's K.
    mem.insertChange(w.db, { entryId: ash.id, anchor: 'baseline', kind: 'knowledge', payload: { factId: 'f-will', fact: 'The will was burned' }, origin: 'adam' })
    saveParas(w.db, w.scenes[1], [['c', 'Tobin and Ash talked of the will.']])
    await readNaming(w.db, w.scenes[1], [
      { type: 'knows', entry: 'Tobin', fact: 'The will was burned', factId: 'known:The will was burned', wrong: true, quote: 'Tobin and Ash talked of the will.' }
    ])
    const c = knowledge(w.db, w.tobin.id).find((x) => x.payload.factId === 'f-will')!
    expect(c.payload.wrong).toBeUndefined()
    const m = sceneMemory(w.db, w.scenes[2])
    expect(m.facts.find((f) => f.factId === 'f-will')?.knownBy.sort()).toEqual([ash.id, w.tobin.id].sort())
    expect(m.beliefs?.some((b) => b.factId === 'f-will')).toBe(false)
  })

  it('a verdict on its edited words never turns a belief into knowledge', async () => {
    const w = await belief()
    saveParas(w.db, w.scenes[0], [
      ['a', CAST],
      ['b', 'Tobin was certain the letter was genuine.']
    ])
    await readNaming(w.db, w.scenes[0], [], (user) => {
      const f = /^- (F\d+) believes wrongly E\d+: /m.exec(user)?.[1]
      return f ? [{ id: f, do: 'update', fact: 'The letter is genuine', wrong: false, quote: 'Tobin was certain the letter was genuine.' }] : []
    })
    const [held] = knowledge(w.db, w.tobin.id)
    expect(held.payload).toMatchObject({ factId: w.factId, wrong: true })
    expect(sceneMemory(w.db, w.scenes[1]).beliefs?.map((b) => b.factId)).toEqual([w.factId])
  })
})

describe('a belief has its own seat in the reading request (fix 9 review)', () => {
  it('past the 40 lines of what is known', async () => {
    const w = await belief()
    for (let i = 0; i < FACT_LINES + 5; i++)
      mem.insertChange(w.db, { entryId: w.tobin.id, anchor: 'baseline', kind: 'knowledge', payload: { factId: `f${i}`, fact: `Fact number ${i}` }, origin: 'adam' })
    saveParas(w.db, w.scenes[1], [['c', 'Tobin waited by the gate.']])
    const asked = (await readNaming(w.db, w.scenes[1], [])).join('\n')
    expect(asked.match(/^- K\d+ "Fact number/gm)).toHaveLength(FACT_LINES)
    expect(asked).toMatch(/^- K\d+ "The letter is genuine": wrongly believed by E\d+$/m)
  })

  it('gets a K of its own even should a fact id turn up as both', () => {
    const ids = new Ids()
    const known = ids.knownFact('x', 'The ford is safe')
    const believed = ids.knownFact('x', 'The ford is safe', true)
    expect(believed).not.toBe(known)
    expect(ids.wrong.has(believed)).toBe(true)
    expect(ids.wrong.has(known)).toBe(false)
    expect(ids.knownFact('x', 'The ford is safe', true)).toBe(believed)
  })
})

describe('Adam’s own knowledge keeps one kind to a fact id (fix 9 review)', () => {
  it('a fact id used for the other kind gets one of its own', async () => {
    const w = await belief()
    const ash = entryNamed(w.db, 'Ash')!
    const asKnown = mem.cleanChangeInput(w.db, { entryId: ash.id, anchor: 'baseline', kind: 'knowledge', payload: { factId: w.factId, fact: 'The letter is genuine' } })
    expect(asKnown.kind === 'knowledge' && asKnown.payload.factId).not.toBe(w.factId)
    const asBelief = mem.cleanChangeInput(w.db, { entryId: ash.id, anchor: 'baseline', kind: 'knowledge', payload: { factId: w.factId, fact: 'The letter is genuine', wrong: true } })
    expect(asBelief.kind === 'knowledge' && asBelief.payload.factId).toBe(w.factId)
    // Editing the only change with it: its own kind may change, and the id stays.
    const own = mem.cleanChangeInput(w.db, { entryId: w.tobin.id, anchor: 'scene', sceneId: w.scenes[0], kind: 'knowledge', payload: { factId: w.factId, fact: 'The letter is genuine' } }, w.held.id)
    expect(own.kind === 'knowledge' && own.payload.factId).toBe(w.factId)
    expect(mem.factIsBelief(w.db, w.factId)).toBe(true)
    expect(mem.factIsBelief(w.db, 'nothing')).toBeNull()
  })
})

describe('a scene with a belief deleted or moved (fix 9 review)', () => {
  /** The briefing's who knows what and must stay true for a scene with Mara (point of view) and Tobin on its card. */
  const briefing = (db: Database.Database, sceneId: ID, mara: ID, tobin: ID): { ledger: string; must: string } => {
    repo.updateSceneCard(db, sceneId, { ...repo.getScene(db, sceneId).card, povId: mara, presentIds: [mara, tobin] })
    const input = gatherContextInput(db, sceneId, undefined, { prefs: { spelling: 'UK', pov: '', tense: '', voiceNotes: '', avoidWords: [] }, contextLength: null, creativity: 'steady' })
    const blocks = buildBlocks(input)
    return { ledger: blocks.find((b) => b.id === LEDGER_BLOCK.id)?.text ?? '', must: blocks.find((b) => b.id === MUST_BLOCK)?.text ?? '' }
  }

  /** Scene 1 the cast; scene 2 Tobin coming to believe wrongly that the letter is genuine. */
  async function inSecond(extra: number) {
    const w = testWorld(extra)
    saveParas(w.db, w.scenes[0], [['a', CAST]])
    await readScene(w.db, fake, w.scenes[0])
    saveParas(w.db, w.scenes[1], [['b', LIE]])
    await readScene(w.db, fake, w.scenes[1], { add: [{ type: 'knows', entry: 'Tobin', fact: 'The letter is genuine', wrong: true, quote: LIE }] })
    return { ...w, mara: entryNamed(w.db, 'Mara')!, tobin: entryNamed(w.db, 'Tobin')! }
  }

  it('deleted: later scenes no longer see it, in the ledger, the briefing or what must stay true', async () => {
    const w = await inSecond(1)
    const mara = w.mara
    const third = repo.createScene(w.db, w.chapterId, { title: 'Third' }).id
    expect(ledgerForScene(w.db, third).couldKnow(w.tobin.id, knowledge(w.db, w.tobin.id).at(-1)!.payload.factId).believesWrongly).toBe(true)
    const before = briefing(w.db, third, mara.id, w.tobin.id)
    expect(before.ledger).toContain("Tobin:\n- Wrongly believes: The letter is genuine (since Ch 1, Sc 2). It isn't true.")
    expect(before.must).toContain('Tobin wrongly believes: The letter is genuine')

    saveParas(w.db, third, [['d', 'Tobin waited by the gate.']])
    expect((await readNaming(w.db, third, [])).join('\n')).toContain('wrongly believed by')
    repo.deleteScene(w.db, w.scenes[1])
    expect(sceneMemory(w.db, third).beliefs).toEqual([])
    // The memory keeper isn't told it any more either.
    saveParas(w.db, third, [['d', 'Tobin waited by the gate, then sat.']])
    expect((await readNaming(w.db, third, [])).join('\n')).not.toContain('wrongly believed by')
    const after = briefing(w.db, third, mara.id, w.tobin.id)
    expect(after.ledger).not.toContain('Wrongly believes')
    expect(after.must).not.toContain('wrongly believes')
  })

  it('moved after another: it counts from its new place, and says so', async () => {
    const w = await inSecond(2)
    const mara = w.mara
    // Scene 2 moves to the end, after scene 3.
    repo.moveScene(w.db, w.scenes[1], w.chapterId, 2)
    expect(sceneMemory(w.db, w.scenes[2]).beliefs).toEqual([])
    expect(briefing(w.db, w.scenes[2], mara.id, w.tobin.id).ledger).not.toContain('Wrongly believes')
    const fourth = repo.createScene(w.db, w.chapterId, { title: 'Fourth' }).id
    const [b] = sceneMemory(w.db, fourth).beliefs ?? []
    expect(b.since[w.tobin.id]).toMatchObject({ where: 'Book 1, Ch 1, Sc 3', sceneId: w.scenes[1] })
    expect(briefing(w.db, fourth, mara.id, w.tobin.id).ledger).toContain('Wrongly believes: The letter is genuine (since Ch 1, Sc 3).')
  })
})
