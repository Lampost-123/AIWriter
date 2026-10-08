import { describe, expect, it } from 'vitest'
import { compactDiff, diffSize, folds, wordDiff, type DiffPart } from './wordDiff'

/** The words before and after a change, from its parts. */
const before = (parts: DiffPart[]): string => parts.map((p) => (p.kind === 'same' || p.kind === 'del' ? p.text : '')).join('')
const after = (parts: DiffPart[]): string => parts.map((p) => (p.kind === 'same' || p.kind === 'ins' ? p.text : '')).join('')

describe('a change word by word', () => {
  it('keeps what stays and marks what is cut and added', () => {
    const d = wordDiff('The tide came in over the flats.', 'The tide roared in over the flats.')
    expect(d).toEqual([
      { kind: 'same', text: 'The tide ' },
      { kind: 'del', text: 'came' },
      { kind: 'ins', text: 'roared ' },
      { kind: 'same', text: 'in over the flats.' }
    ])
    expect(diffSize(d)).toEqual({ cut: 1, added: 1 })
  })

  it('gives the new words back exactly, paragraphs and all', () => {
    const a = 'The tide came in.\n\nThe gulls went quiet.'
    const b = 'The tide came in.\n\nThe gulls screamed once, then nothing.'
    const d = wordDiff(a, b)
    expect(after(d)).toBe(b)
    expect(before(d).replace(/\s+/g, ' ')).toBe(a.replace(/\s+/g, ' '))
    expect(d.filter((p) => p.kind === 'ins').map((p) => (p as { text: string }).text)).toEqual(['screamed once, then nothing.'])
  })

  it('shows a cut, or new words, on their own', () => {
    expect(wordDiff('Cut this.', '')).toEqual([{ kind: 'del', text: 'Cut this.' }])
    expect(wordDiff('', 'All new.')).toEqual([{ kind: 'ins', text: 'All new.' }])
    expect(wordDiff('SHOUTED WORDS.', 'Shouted words.')).toEqual([
      { kind: 'del', text: 'SHOUTED WORDS.' },
      { kind: 'ins', text: 'Shouted words.' }
    ])
  })
})

describe('a change folded to what changes', () => {
  const long = 'one two three four five six seven eight nine ten eleven twelve'
  it('keeps a few words either side and counts the rest', () => {
    const d = wordDiff(`${long} old ${long}`, `${long} new ${long}`)
    const c = compactDiff(d, 3)
    expect(c[0]).toEqual({ kind: 'gap', words: 9 })
    expect(c[1]).toEqual({ kind: 'same', text: 'ten eleven twelve ' })
    expect(c.at(-1)).toEqual({ kind: 'gap', words: 9 })
    expect(folds(d, 3)).toBe(true)
  })

  it('leaves a short change whole', () => {
    const d = wordDiff('The tide came in.', 'The tide roared in.')
    expect(compactDiff(d)).toEqual(d)
    expect(folds(d)).toBe(false)
  })
})
