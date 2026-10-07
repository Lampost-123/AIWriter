import { describe, expect, it } from 'vitest'
import { fuse, KeywordIndex, nearest, RRF_K } from './rank'

describe('keyword search in memory (BM25)', () => {
  const docs = [
    { id: 'a', text: 'Mara and Tobin: brother, estranged.' },
    { id: 'b', text: 'The Old Mill: a ruined mill by the river.' },
    { id: 'c', text: 'Kell: a dockhand who owes Mara money.' },
    { id: 'd', text: 'The copper ring: carried by Kell, stolen from the mill.' }
  ]
  const ix = new KeywordIndex(docs, (d) => d.text)

  it('finds texts sharing a word with the search, best first', () => {
    expect(ix.search('her brother').map((r) => r.item.id)).toEqual(['a'])
    const mill = ix.search('the ruined mill', 10, 0).map((r) => r.item.id)
    expect(mill).toEqual(['b', 'd'])
    // By default a find far below the best (one word of three) is left out.
    expect(ix.search('the ruined mill').map((r) => r.item.id)).toEqual(['b'])
  })

  it('finds nothing for a search of common words only', () => {
    expect(ix.search('she was there and then')).toEqual([])
  })

  it('leaves out stray finds far below the best', () => {
    const r = ix.search('ruined river mill copper', 10, 0.9)
    expect(r.map((x) => x.item.id)).toEqual(['b'])
  })
})

describe('meaning and fusion', () => {
  const v = (...xs: number[]): Float32Array => {
    const a = Float32Array.from(xs)
    const n = Math.hypot(...xs)
    return a.map((x) => x / n)
  }

  it('ranks by likeness and keeps only what is alike enough', () => {
    const items = [
      { item: 'near', vec: v(1, 0.1) },
      { item: 'far', vec: v(0, 1) },
      { item: 'nearer', vec: v(1, 0) }
    ]
    expect(nearest(v(1, 0), items, 10, 0.5).map((r) => r.item)).toEqual(['nearer', 'near'])
  })

  it('puts first what several lists agree on (reciprocal rank fusion)', () => {
    const list = (...ids: string[]) => ids.map((id, i) => ({ item: id, score: 10 - i }))
    const fused = fuse([list('a', 'b', 'c'), list('b', 'c', 'd'), list('e', 'b')], (x) => x)
    expect(fused[0].item).toBe('b')
    expect(fused[0].score).toBeCloseTo(1 / (RRF_K + 2) + 1 / (RRF_K + 1) + 1 / (RRF_K + 2))
    expect(fused.map((r) => r.item)).toContain('d')
    // A tie keeps the order first seen.
    expect(fused.map((r) => r.item).indexOf('a')).toBeLessThan(fused.map((r) => r.item).indexOf('e'))
  })
})
