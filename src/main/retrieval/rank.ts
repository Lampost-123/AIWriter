// Ranking for recall (story memory step 5): keyword search over a small set of texts (BM25, in memory), likeness of
// meaning between vectors, and the two joined (reciprocal rank fusion). Pure.

import { terms } from './text'

/** BM25's usual settings. */
const K1 = 1.2
const B = 0.75

export interface Ranked<T> {
  item: T
  score: number
}

/**
 * Keyword search over texts held in memory (the codex facts as of a scene, summaries): BM25 over `terms`, best first.
 * Only texts sharing a word with the query, and within `keep` of the best score (so one stray word doesn't count as
 * a find when others match far better).
 */
export class KeywordIndex<T> {
  private readonly docs: { item: T; tf: Map<string, number>; len: number }[] = []
  private readonly df = new Map<string, number>()
  private totalLen = 0

  constructor(items: T[], text: (item: T) => string) {
    for (const item of items) {
      const words = terms(text(item))
      const tf = new Map<string, number>()
      for (const w of words) tf.set(w, (tf.get(w) ?? 0) + 1)
      for (const w of tf.keys()) this.df.set(w, (this.df.get(w) ?? 0) + 1)
      this.docs.push({ item, tf, len: words.length })
      this.totalLen += words.length
    }
  }

  get size(): number {
    return this.docs.length
  }

  search(query: string, limit = 10, keep = 0.3): Ranked<T>[] {
    const q = [...new Set(terms(query))]
    if (!q.length || !this.docs.length) return []
    const n = this.docs.length
    const avg = this.totalLen / n || 1
    const idf = new Map(q.map((w) => [w, Math.log(1 + (n - (this.df.get(w) ?? 0) + 0.5) / ((this.df.get(w) ?? 0) + 0.5))]))
    const out: Ranked<T>[] = []
    for (const d of this.docs) {
      let s = 0
      for (const w of q) {
        const f = d.tf.get(w)
        if (!f) continue
        s += idf.get(w)! * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * d.len) / avg)))
      }
      if (s > 0) out.push({ item: d.item, score: s })
    }
    out.sort((a, b) => b.score - a.score)
    const best = out[0]?.score ?? 0
    return out.filter((r) => r.score >= best * keep).slice(0, limit)
  }
}

/** How alike two unit-length vectors are (their dot product): 1 the same meaning, 0 unrelated. */
export function likeness(a: Float32Array, b: Float32Array): number {
  let s = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) s += a[i] * b[i]
  return s
}

/** The items closest in meaning to a query vector, best first: at least `floor` alike, at most `limit`. */
export function nearest<T>(query: Float32Array, items: { item: T; vec: Float32Array }[], limit = 10, floor = 0): Ranked<T>[] {
  const out: Ranked<T>[] = []
  for (const x of items) {
    const s = likeness(query, x.vec)
    if (s >= floor) out.push({ item: x.item, score: s })
  }
  out.sort((a, b) => b.score - a.score)
  return out.slice(0, limit)
}

/** Reciprocal rank fusion's constant: how much a first place counts over a tenth. */
export const RRF_K = 60

/**
 * Joins ranked lists (keyword and meaning, for each part of the query) into one, best first: each item scores
 * 1 / (RRF_K + its place) in every list it is in, so what several lists agree on comes first. `key` tells the same
 * item apart across lists.
 */
export function fuse<T>(lists: Ranked<T>[][], key: (item: T) => string): Ranked<T>[] {
  const score = new Map<string, { item: T; score: number; first: number }>()
  let order = 0
  for (const list of lists) {
    list.forEach((r, i) => {
      const k = key(r.item)
      const cur = score.get(k)
      if (cur) cur.score += 1 / (RRF_K + i + 1)
      else score.set(k, { item: r.item, score: 1 / (RRF_K + i + 1), first: order++ })
    })
  }
  return [...score.values()].sort((a, b) => b.score - a.score || a.first - b.first).map(({ item, score }) => ({ item, score }))
}
