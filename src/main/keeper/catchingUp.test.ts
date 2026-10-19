// The calm overhaul (2026-10-19): a draft or a check waiting on the memory says how far it has got ("Catching up the
// memory: scene 2 of 3"), never silently; and a scene the memory model turned down is known as such, as its words are
// now, so Issues › Memory can say so with Try again. The fake provider stands in for the models; all text is invented.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { MemoryStatus } from '@shared/types'
import { startFakeProvider, type FakeProvider } from '../../../tests/fake-provider/server.mjs'
import { fakeModel, saveParas, testWorld } from '../../../tests/unit/keeperRead'
import * as kdb from '../db/keeper'
import { Keeper } from './engine'
import { hashText } from './text'
import { markRefused, modelKeyOf, refusedKind } from './refusals'

let fake: FakeProvider
beforeAll(async () => {
  fake = await startFakeProvider({ delayMs: 0 })
})
afterAll(() => fake.close())

describe('waiting on the memory, said', () => {
  it('says which earlier scene it is reading of how many, then nothing once caught up', async () => {
    const w = testWorld(3)
    const [one, two, three, four] = w.scenes
    saveParas(w.db, one, [['p1', 'Mara crossed the quay.']])
    saveParas(w.db, two, [['p2', 'Tobin waited by the boats.']])
    saveParas(w.db, three, [['p3', 'The ferry came in at dusk.']])
    saveParas(w.db, four, [['p4', 'Mara went aboard.']], false)
    const seen: NonNullable<MemoryStatus['catchingUp']>[] = []
    const k = new Keeper({
      db: w.db,
      model: () => fakeModel(fake),
      emitStatus: (s) => {
        if (s.catchingUp) seen.push(s.catchingUp)
      },
      emitChanged: () => {},
      quietMs: 60_000,
      summaries: false,
      retryDelays: [0]
    })
    await k.catchUpBefore(four)
    const forFour = seen.map((c) => c.find((x) => x.sceneId === four)).filter((x) => !!x)
    expect(forFour[0]).toEqual({ sceneId: four, done: 0, total: 3, stage: 'earlier' })
    expect(forFour.map((c) => c.done)).toEqual(expect.arrayContaining([0, 1, 2]))
    expect(Math.max(...forFour.map((c) => c.done))).toBeLessThanOrEqual(3)
    // Caught up: the status says nothing of it any more.
    expect(k.status().catchingUp).toBeUndefined()
    k.stop()
  })

  it('says nothing when there is nothing to catch up', async () => {
    const w = testWorld(1)
    const seen: MemoryStatus[] = []
    const k = new Keeper({ db: w.db, model: () => fakeModel(fake), emitStatus: (s) => seen.push(s), emitChanged: () => {}, quietMs: 60_000, summaries: false })
    await k.catchUpBefore(w.scenes[1])
    expect(seen.some((s) => s.catchingUp)).toBe(false)
    k.stop()
  })
})

describe('a scene the memory model turned down, as its words are now', () => {
  it('is its reading, else its summary; new words or another model are not', () => {
    const w = testWorld(0)
    const scene = w.scenes[0]
    saveParas(w.db, scene, [['p1', 'EXPLICIT. Mara crossed the quay.']])
    const key = modelKeyOf(fakeModel(fake, 'fake/refuse'))
    const hash = hashText(kdb.keeperScene(w.db, scene)!.text)
    expect(refusedKind(w.db, scene, hash, key)).toBeNull()
    markRefused(w.db, 'summary', scene, hash, key)
    expect(refusedKind(w.db, scene, hash, key)).toBe('summary')
    markRefused(w.db, 'read', scene, hash, key)
    expect(refusedKind(w.db, scene, hash, key)).toBe('read')
    expect(refusedKind(w.db, scene, hash, modelKeyOf(fakeModel(fake, 'fake/writer')))).toBeNull()
    expect(refusedKind(w.db, scene, hashText('Other words.'), key)).toBeNull()
    expect(refusedKind(w.db, scene, hash, null)).toBeNull()
  })
})
