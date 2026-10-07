import { describe, expect, it } from 'vitest'
import { countWords, PASSAGE_MAX_WORDS, PASSAGE_MIN_WORDS, scenePassages, searchWords, stem, terms, textHash } from './text'

const words = (n: number, w = 'word'): string => Array.from({ length: n }, (_, i) => `${w}${i}`).join(' ')

describe('passages', () => {
  it('joins short paragraphs until a passage is long enough, never across the limit', () => {
    const paras = Array.from({ length: 12 }, (_, i) => `Line ${i} ${words(18)}.`)
    const ps = scenePassages(paras.join('\n\n'))
    expect(ps.length).toBeGreaterThan(1)
    for (const p of ps.slice(0, -1)) {
      expect(countWords(p.text)).toBeGreaterThanOrEqual(PASSAGE_MIN_WORDS)
      expect(countWords(p.text)).toBeLessThanOrEqual(PASSAGE_MAX_WORDS)
    }
    // Every word is kept, in order.
    expect(ps.map((p) => p.text).join('\n\n')).toBe(paras.join('\n\n'))
    expect(ps.map((p) => p.n)).toEqual(ps.map((_, i) => i))
  })

  it('cuts a very long paragraph at sentences', () => {
    const long = Array.from({ length: 60 }, (_, i) => `Sentence ${i} has a few more words in it.`).join(' ')
    const ps = scenePassages(long)
    expect(ps.length).toBeGreaterThan(1)
    for (const p of ps) expect(countWords(p.text)).toBeLessThanOrEqual(PASSAGE_MAX_WORDS + 12)
    expect(ps[0].text.endsWith('.')).toBe(true)
  })

  it('gives the same hash for the same words, and none for an empty scene', () => {
    expect(scenePassages('')).toEqual([])
    const a = scenePassages('She waited by the well.')
    expect(a[0].hash).toBe(textHash('She waited by the well.'))
  })

  it('joins a short last piece to the passage before it', () => {
    const ps = scenePassages(`${words(80)}\n\nThe end.`)
    expect(ps).toHaveLength(1)
    expect(ps[0].text.endsWith('The end.')).toBe(true)
  })
})

describe('words for keyword search', () => {
  it('leaves out common words, folds case and accents, and stems', () => {
    expect(terms('She PROMISED the Café owner she would come back')).toEqual(['promis', 'cafe', 'owner', 'come'])
    expect(stem('promise')).toBe(stem('promises'))
    expect(stem('promised')).toBe(stem('promising'))
    expect(stem('well')).toBe('well')
  })

  it('gives SQLite plain words, each once', () => {
    expect(searchWords('The well, the WELL and the old well.')).toEqual(['well', 'old'])
  })
})
