import { describe, expect, it } from 'vitest'
import { EventEmitter } from 'node:events'
import { BertPool, type WorkerLike } from './pool'
import { BgeEmbedder, checkModel, CHECK_SENTENCES, QUERY_INSTRUCTION } from './embedder'
import { WordPiece } from './wordpiece'
import type { Embedder } from '../types'

/** A pretend worker: answers each text with [its first piece, how many pieces], a moment later. */
class FakeWorker extends EventEmitter implements WorkerLike {
  seen: number[][] = []
  terminated = false
  constructor(private readonly fail = false) {
    super()
  }
  postMessage(msg: unknown): void {
    const m = msg as { type: string; id?: number; ids?: number[] }
    setTimeout(() => {
      if (m.type === 'init') this.emit('message', this.fail ? { type: 'failed', error: 'no model here' } : { type: 'ready' })
      else if (m.type === 'embed') {
        this.seen.push(m.ids!)
        this.emit('message', { type: 'done', id: m.id, vec: Float32Array.from([m.ids![0], m.ids!.length]) })
      }
    }, 1)
  }
  terminate(): void {
    this.terminated = true
  }
}

const weights = { buffer: new SharedArrayBuffer(4), tensors: {} }
const config = { hidden: 1, heads: 1, layers: 0, intermediate: 1, eps: 1e-12, maxPositions: 8 }

describe("the search model's worker threads", () => {
  it('shares texts out and gives each vector back in order', async () => {
    const made: FakeWorker[] = []
    const pool = new BertPool(() => (made.push(new FakeWorker()), made[made.length - 1]), weights, config, 2)
    await pool.ready
    const vecs = await pool.run([[1], [2, 2], [3, 3, 3]])
    expect(vecs.map((v) => Array.from(v))).toEqual([
      [1, 1],
      [2, 2],
      [3, 3]
    ])
    expect(made.every((w) => w.seen.length > 0)).toBe(true)
    pool.close()
    expect(made.every((w) => w.terminated)).toBe(true)
  })

  it('reads a search before the background indexing waiting behind it', async () => {
    const w = new FakeWorker()
    const pool = new BertPool(() => w, weights, config, 1)
    await pool.ready
    const later = pool.run([[10], [11], [12]], { background: true })
    const now = pool.run([[1]])
    await Promise.all([later, now])
    // The first background text was already under way; the search goes next.
    expect(w.seen.map((ids) => ids[0])).toEqual([10, 1, 11, 12])
    pool.close()
  })

  it('says when the model could not start, and drops texts that were stopped', async () => {
    const pool = new BertPool(() => new FakeWorker(true), weights, config, 1)
    await expect(pool.ready).rejects.toThrow('no model here')
    pool.close()
    const ok = new BertPool(() => new FakeWorker(), weights, config, 1)
    await ok.ready
    const stop = new AbortController()
    stop.abort()
    await expect(ok.run([[1]], { signal: stop.signal })).rejects.toThrow('Stopped')
    ok.close()
    await expect(ok.run([[1]])).rejects.toThrow(/closed/)
  })
})

describe('the search model as recall uses it', () => {
  it('asks a search with bge’s instruction, and reads passages as they are', async () => {
    const vocab = new WordPiece(['[PAD]', '[UNK]', '[CLS]', '[SEP]', 'well'].join('\n'))
    const asked: number[][][] = []
    const e = new BgeEmbedder(vocab, async (ids) => {
      asked.push(ids)
      return ids.map((x) => Float32Array.from([x.length]))
    })
    await e.embed(['the well'], 'query')
    await e.embed(['the well'], 'passage')
    // The instruction's words are unknown to this tiny vocabulary: each is one [UNK] piece more.
    expect(asked[0][0].length).toBeGreaterThan(asked[1][0].length)
    expect(asked[1][0]).toEqual([2, 1, 4, 3])
    expect(QUERY_INSTRUCTION).toMatch(/^Represent this sentence for searching relevant passages: $/)
  })

  it('passes a model that tells related sentences apart, and fails one that does not', async () => {
    const flat = CHECK_SENTENCES.flat()
    const good: Embedder = {
      model: 'good',
      floor: 0,
      embed: async (texts) =>
        texts.map((t) => {
          // The first two of each three point the same way; the third elsewhere.
          const i = flat.indexOf(t)
          const group = Math.floor(i / 3)
          const v = new Float32Array(CHECK_SENTENCES.length + 1)
          v[i % 3 === 2 ? CHECK_SENTENCES.length : group] = 1
          return v
        })
    }
    expect(await checkModel(good)).toEqual({ ok: true })
    const noisy: Embedder = { model: 'bad', floor: 0, embed: async (texts) => texts.map(() => Float32Array.from([1, 0])) }
    const r = await checkModel(noisy)
    expect(r.ok).toBe(false)
    expect(r.why).toMatch(/couldn't tell/)
  })
})
