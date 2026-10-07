// A stand-in for the search model, for tests (and app tests, with AIWRITE_SEARCH_MODEL=stub): each word lands on a
// few of 128 places, and words of a small list of near meanings land on the same ones, so "her sibling" finds "her
// brother" and "vow" finds "promise" with no model at all. Never used for Adam's writing.

import type { Embedder } from './types'
import { stem, terms } from './text'

const DIMS = 128

/** Words that mean nearly the same, for the stand-in: each group shares its places. */
const NEAR: string[][] = [
  ['brother', 'sibling', 'sister', 'kin'],
  ['promise', 'vow', 'swore', 'swear', 'oath', 'pledge'],
  ['threat', 'threaten', 'kill', 'murder', 'harm'],
  ['secret', 'hidden', 'conceal', 'hid'],
  ['wound', 'scar', 'injury', 'hurt'],
  ['well', 'spring', 'fountain'],
  ['sword', 'blade'],
  ['ship', 'vessel', 'boat']
]
const GROUP = new Map<string, string>()
for (const g of NEAR) for (const w of g) GROUP.set(stem(w), stem(g[0]))

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** The stand-in's vector for a text (unit length; all zeros for a text with no words). */
export function stubVector(text: string): Float32Array {
  const v = new Float32Array(DIMS)
  for (const w of terms(text)) {
    const key = GROUP.get(w) ?? w
    const h = hash(key)
    v[h % DIMS] += 1
    v[(h >>> 8) % DIMS] += 0.5
  }
  let n = 0
  for (const x of v) n += x * x
  n = Math.sqrt(n) || 1
  for (let i = 0; i < DIMS; i++) v[i] /= n
  return v
}

export function stubEmbedder(o: { delayMs?: number; onEmbed?: (texts: string[], kind: 'query' | 'passage') => void } = {}): Embedder {
  return {
    model: 'stub',
    floor: 0.2,
    async embed(texts, kind) {
      o.onEmbed?.(texts, kind)
      if (o.delayMs) await new Promise((r) => setTimeout(r, o.delayMs))
      return texts.map(stubVector)
    }
  }
}
