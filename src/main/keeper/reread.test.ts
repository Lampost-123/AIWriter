// Re-read buttons (World Memory Overhaul B8, 2026-10-08): "Re-read this scene" and "Re-read the whole story" read every
// paragraph again, though the text hasn't changed, through the memory keeper's usual queue, one scene at a time, with
// progress in the memory status and Stop; the cost is worked out first from the memory model's own run records (else its
// prices), and the call is refused while the monthly spending limit holds AI calls. All text is invented; the memory
// model is the fake one: no paid calls.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { MemoryStatus } from '@shared/types'
import { startFakeProvider, type FakeProvider } from '../../../tests/fake-provider/server.mjs'
import { entryNamed, fakeModel, readScene, saveParas, shapedFetch, testWorld } from '../../../tests/unit/keeperRead'
import * as mem from '../db/memory'
import * as kdb from '../db/keeper'
import { Keeper } from './engine'
import { runScene } from './run'
import { guessReread, rereadCost } from '../importing/estimate'

let fake: FakeProvider
beforeAll(async () => {
  fake = await startFakeProvider({ delayMs: 0 })
})
afterAll(() => fake.close())

const LOST = 'Mara lost her knife.'

describe('reading a scene again in full', () => {
  it('reads every paragraph though nothing changed, and adds only what is new', async () => {
    const w = testWorld(0)
    const [s1] = w.scenes
    saveParas(w.db, s1, [
      ['p1', 'The ferry was late.'],
      ['p2', LOST]
    ])
    // The first read missed it.
    await readScene(w.db, fake, s1, { nothing: true })
    expect(entryNamed(w.db, 'Mara')).toBeNull()
    // An ordinary read now has nothing to do.
    const asked: string[] = []
    const plain = await runScene(
      { db: w.db, model: fakeModel(fake), signal: new AbortController().signal, closed: () => false, fetchImpl: shapedFetch({}, asked) },
      s1
    )
    expect(plain.status).toBe('nothing')
    expect(asked).toEqual([])
    // Read again in full: both paragraphs go to the model, and the knife is found.
    const out = await runScene(
      { db: w.db, model: fakeModel(fake), whole: true, signal: new AbortController().signal, closed: () => false, fetchImpl: shapedFetch({}, asked) },
      s1
    )
    expect(out.status).toBe('done')
    expect(asked.join('\n')).toContain('The ferry was late.')
    expect(mem.changesForEntry(w.db, entryNamed(w.db, 'Mara')!.id).map((c) => c.kind === 'update' && c.payload.note)).toEqual(['lost her knife'])
    // Again: what is already there is told as read, and not added twice.
    await runScene(
      { db: w.db, model: fakeModel(fake), whole: true, signal: new AbortController().signal, closed: () => false, fetchImpl: shapedFetch({}, asked) },
      s1
    )
    expect(mem.changesForEntry(w.db, entryNamed(w.db, 'Mara')!.id)).toHaveLength(1)
  })
})

describe('the keeper’s re-read', () => {
  it('goes through the queue in order, with progress in the status, and ends', async () => {
    const w = testWorld(2)
    for (const [i, s] of w.scenes.entries()) saveParas(w.db, s, [[`p${i}`, `${['Mara', 'Tobin', 'Kell'][i]} lost her map.`]], false)
    for (const s of w.scenes) kdb.markProcessed(w.db, s, kdb.keeperScene(w.db, s)!.textVersion, [])
    const statuses: MemoryStatus[] = []
    const read: string[] = []
    const k = new Keeper({
      db: w.db,
      model: () => fakeModel(fake),
      emitStatus: (s) => statuses.push(s),
      emitChanged: () => {},
      quietMs: 60_000,
      summaries: false,
      retryDelays: [0],
      fetchImpl: shapedFetch({}, read)
    })
    k.reread(w.scenes)
    expect(k.status().rereading).toEqual({ left: 3, total: 3 })
    await k.whenIdle()
    expect(read).toHaveLength(3)
    expect(read[0]).toContain('Mara lost her map.')
    expect(read[2]).toContain('Kell lost her map.')
    expect(statuses.some((s) => s.rereading?.left === 1)).toBe(true)
    expect(k.status().rereading).toBeUndefined()
    k.stop()
  })

  it('Stop drops the scenes still waiting', async () => {
    const w = testWorld(2)
    for (const s of w.scenes) saveParas(w.db, s, [['p1', 'The gulls were loud.']], false)
    for (const s of w.scenes) kdb.markProcessed(w.db, s, kdb.keeperScene(w.db, s)!.textVersion, [])
    const read: string[] = []
    const k = new Keeper({ db: w.db, model: () => fakeModel(fake), emitStatus: () => {}, emitChanged: () => {}, quietMs: 60_000, summaries: false, fetchImpl: shapedFetch({}, read) })
    k.reread(w.scenes)
    k.stopReread()
    expect(k.status().rereading).toBeUndefined()
    await k.whenIdle()
    expect(read.length).toBeLessThanOrEqual(1)
    k.stop()
  })

  it('waits, still asked for, while there is no model (the spending limit), and goes on when there is one', async () => {
    const w = testWorld(0)
    const [s1] = w.scenes
    saveParas(w.db, s1, [['p1', LOST]], false)
    kdb.markProcessed(w.db, s1, kdb.keeperScene(w.db, s1)!.textVersion, [])
    let paused = true
    const k = new Keeper({
      db: w.db,
      model: () => (paused ? { error: 'This month’s AI spending has reached your limit.' } : fakeModel(fake)),
      emitStatus: () => {},
      emitChanged: () => {},
      quietMs: 60_000,
      summaries: false,
      retryDelays: [0],
      fetchImpl: shapedFetch({})
    })
    k.reread([s1])
    await k.whenIdle()
    expect(k.status().rereading).toEqual({ left: 1, total: 1 })
    expect(k.status().error).toContain('limit')
    paused = false
    k.updateNow()
    await k.whenIdle()
    expect(k.status().rereading).toBeUndefined()
    expect(entryNamed(w.db, 'Mara')).not.toBeNull()
    k.stop()
  })
})

describe('what a re-read costs', () => {
  it('grows with the words, and is priced from the memory model’s own records when there are any', () => {
    const choice = { contextLength: 64000, maxOutput: null, promptPrice: 1e-6, completionPrice: 4e-6 }
    const one = guessReread([{ chars: 3500 }], choice, 'off')
    const three = guessReread([{ chars: 3500 }, { chars: 3500 }, { chars: 3500 }], choice, 'off')
    expect(three.input).toBeGreaterThan(one.input * 2.5)
    expect(rereadCost(one, choice, null)).toBeCloseTo(one.input * 1e-6 + one.output * 4e-6)
    expect(rereadCost(one, choice, 2e-6)).toBeCloseTo((one.input + one.output) * 2e-6)
    expect(rereadCost(one, { promptPrice: null, completionPrice: null }, null)).toBeNull()
  })

  it('reads the cost per token from the last runs with that model', () => {
    const w = testWorld(0)
    expect(kdb.memoryCostPerToken(w.db, 'fake/writer')).toBeNull()
    const run = kdb.startRun(w.db, w.scenes[0], 1)
    kdb.finishRun(w.db, run, 'done', null, {
      providerId: 'p1',
      modelId: 'fake/writer',
      promptTokens: 9000,
      completionTokens: 1000,
      cost: 0.002,
      generationIds: []
    })
    expect(kdb.memoryCostPerToken(w.db, 'fake/writer')).toBeCloseTo(0.002 / 10000)
    expect(kdb.memoryCostPerToken(w.db, 'other/model')).toBeNull()
  })
})
