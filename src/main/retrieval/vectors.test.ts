// Vectors kept between searches: each text read once however many ask, a search's own words stopped with it, and the
// background reading carried on and kept.
import { describe, expect, it } from 'vitest'
import type { Embedder } from './types'
import { Vectors } from './vectors'
import { memorySearchIndex } from './store'

/** A model that answers when told to, noting every text it was asked for and how. */
function slowModel() {
  const asked: { texts: string[]; how: 'now' | 'later'; signal?: AbortSignal }[] = []
  const waiting: (() => void)[] = []
  const answer = (texts: string[]) => texts.map((t) => Float32Array.from([t.length, 1]))
  const later = (texts: string[], how: 'now' | 'later', signal?: AbortSignal): Promise<Float32Array[]> => {
    asked.push({ texts, how, signal })
    return new Promise((resolve, reject) => {
      waiting.push(() => resolve(answer(texts)))
      signal?.addEventListener('abort', () => reject(new Error('Stopped')), { once: true })
    })
  }
  const model: Embedder = {
    model: 'm',
    floor: 0,
    embed: (texts, _kind, signal) => later(texts, 'now', signal),
    embedLater: (texts, signal) => later(texts, 'later', signal)
  }
  return { model, asked, release: () => waiting.splice(0).forEach((f) => f()) }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('vectors kept between searches', () => {
  it('reads a text once however many searches ask for it at the same time', async () => {
    const m = slowModel()
    const v = new Vectors()
    const texts = [{ hash: 'a', text: 'the well' }]
    const one = v.read({ embedder: m.model, texts, now: false })
    const two = v.read({ embedder: m.model, texts, now: false })
    await flush()
    expect(m.asked).toHaveLength(1)
    expect(v.reading).toBe(1)
    m.release()
    const [a, b] = await Promise.all([one, two])
    expect(a.get('a')).toEqual(b.get('a'))
    // Kept: asked again, nothing is read.
    await v.read({ embedder: m.model, texts, now: false })
    expect(m.asked).toHaveLength(1)
    expect(v.reading).toBe(0)
  })

  it('reads a search’s own words now, and stops them with the search', async () => {
    const m = slowModel()
    const v = new Vectors()
    const stop = new AbortController()
    const p = v.read({ embedder: m.model, texts: [{ hash: 'q:1', text: 'her brother' }], now: true, signal: stop.signal })
    await flush()
    expect(m.asked[0]).toMatchObject({ how: 'now', signal: stop.signal })
    stop.abort()
    const got = await p
    expect(got.size).toBe(0)
    await flush()
    // Nothing is left half-read: the next search asks again.
    expect(v.reading).toBe(0)
    void v.read({ embedder: m.model, texts: [{ hash: 'q:1', text: 'her brother' }], now: true })
    await flush()
    expect(m.asked).toHaveLength(2)
  })

  it('carries on reading facts in the background when a search stops waiting, and keeps them in the index', async () => {
    const m = slowModel()
    const v = new Vectors()
    const index = memorySearchIndex()
    const stop = new AbortController()
    const world = new AbortController()
    const p = v.read({ embedder: m.model, texts: [{ hash: 'f', text: 'Tobin: brother' }], now: false, index, store: 'other', signal: stop.signal, background: world.signal })
    await flush()
    expect(m.asked[0]).toMatchObject({ how: 'later', signal: world.signal })
    stop.abort()
    expect((await p).size).toBe(0)
    m.release()
    await flush()
    expect(v.get('m', 'f')).toBeTruthy()
    expect(index.vectors('m', ['f']).size).toBe(1)
    // The next search finds it kept.
    expect(v.kept('m', ['f', 'missing'], index).size).toBe(1)
  })

  it('lets the world closing stop the background reading', async () => {
    const m = slowModel()
    const v = new Vectors()
    const world = new AbortController()
    const p = v.read({ embedder: m.model, texts: [{ hash: 'f', text: 'x' }], now: false, background: world.signal })
    await flush()
    world.abort()
    expect((await p).size).toBe(0)
    expect(v.reading).toBe(0)
  })
})
