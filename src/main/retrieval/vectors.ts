// The search model's vectors for the open world: kept in memory (and passages' and facts' in the search index), each
// text read once however many searches ask for it at the same time. A search's own words are read at the front of the
// queue and stop with the search (Stop, or it ran out of time); everything else (facts, summaries) is read in the
// background, behind any search's words, and kept for the next search even when this one has stopped waiting.

import type { SearchIndex } from './store'
import type { Embedder } from './types'

export interface ToRead {
  /** What the vector is kept by (textHash of the text; a search's own words are kept apart from passages). */
  hash: string
  text: string
}

export class Vectors {
  private readonly map = new Map<string, Float32Array>()
  private readonly inflight = new Map<string, Promise<Float32Array | null>>()

  constructor(private readonly most = 60_000) {}

  private key = (model: string, hash: string): string => `${model}|${hash}`

  get(model: string, hash: string): Float32Array | undefined {
    return this.map.get(this.key(model, hash))
  }

  set(model: string, hash: string, vec: Float32Array): void {
    const k = this.key(model, hash)
    this.map.delete(k)
    this.map.set(k, vec)
    if (this.map.size > this.most) this.map.delete(this.map.keys().next().value as string)
  }

  /** How many texts are being read now (tests). */
  get reading(): number {
    return this.inflight.size
  }

  clear(): void {
    this.map.clear()
  }

  /** The vectors already kept for these texts (memory, then `index`), by hash; nothing is read. */
  kept(model: string, hashes: string[], index?: SearchIndex | null): Map<string, Float32Array> {
    const out = new Map<string, Float32Array>()
    const missing: string[] = []
    for (const h of new Set(hashes)) {
      const v = this.get(model, h)
      if (v) out.set(h, v)
      else missing.push(h)
    }
    if (missing.length && index?.open) {
      for (const [h, v] of index.vectors(model, missing)) {
        out.set(h, v)
        this.set(model, h, v)
      }
    }
    return out
  }

  /**
   * Vectors for these texts, by hash: kept ones first (memory, then `index`), the rest read by the model. `now` reads
   * them at the front of the queue as searches (`kind` 'query') and stops with `signal`; otherwise they are read in the
   * background as passages, stopped only by `background` (the world closing), and kept in `index` as `store`. Texts
   * already being read are waited for, not read again. Resolves with what it has when `signal` stops it.
   */
  async read(o: {
    embedder: Embedder
    texts: ToRead[]
    now: boolean
    index?: SearchIndex | null
    store?: 'passage' | 'other'
    signal?: AbortSignal
    background?: AbortSignal
  }): Promise<Map<string, Float32Array>> {
    const { embedder } = o
    const model = embedder.model
    const out = new Map<string, Float32Array>()
    const missing = new Map<string, ToRead>()
    for (const t of o.texts) {
      const v = this.get(model, t.hash)
      if (v) out.set(t.hash, v)
      else missing.set(t.hash, t)
    }
    if (missing.size && o.index?.open && !o.now) {
      for (const [h, v] of o.index.vectors(model, [...missing.keys()])) {
        out.set(h, v)
        this.set(model, h, v)
        missing.delete(h)
      }
    }
    const waits: Promise<void>[] = []
    const fresh: ToRead[] = []
    for (const t of missing.values()) {
      const going = this.inflight.get(this.key(model, t.hash))
      if (going) waits.push(going.then((v) => void (v && out.set(t.hash, v))))
      else fresh.push(t)
    }
    if (fresh.length) {
      const signal = o.now ? o.signal : o.background
      const asked = o.now
        ? embedder.embed(
            fresh.map((t) => t.text),
            'query',
            signal
          )
        : embedder.embedLater
          ? embedder.embedLater(
              fresh.map((t) => t.text),
              signal
            )
          : embedder.embed(
              fresh.map((t) => t.text),
              'passage',
              signal
            )
      const all = asked.then(
        (vecs) => {
          const made = fresh.map((t, i) => ({ hash: t.hash, vec: vecs[i] })).filter((x) => x.vec)
          for (const x of made) this.set(model, x.hash, x.vec)
          if (!o.now && o.store && o.index?.open) {
            try {
              o.index.putVectors(model, o.store, made)
            } catch (e) {
              console.warn('Could not keep the vectors in the search index', e instanceof Error ? e.message : e)
            }
          }
          return vecs
        },
        () => null
      )
      fresh.forEach((t, i) => {
        const k = this.key(model, t.hash)
        const one = all.then((vecs) => vecs?.[i] ?? null)
        this.inflight.set(k, one)
        void one.finally(() => {
          if (this.inflight.get(k) === one) this.inflight.delete(k)
        })
        waits.push(one.then((v) => void (v && out.set(t.hash, v))))
      })
    }
    if (waits.length) {
      // A search that stops (Stop, or out of time) goes on with what it has; the background reading carries on.
      const stopped = new Promise<void>((resolve) => {
        if (!o.signal) return
        if (o.signal.aborted) resolve()
        o.signal.addEventListener('abort', () => resolve(), { once: true })
      })
      await Promise.race([Promise.all(waits), stopped])
    }
    return out
  }
}
