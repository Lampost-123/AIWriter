import { describe, expect, it } from 'vitest'
import { compareTexts, diffWords, editScript, likeness, paragraphsOf, tokenize, type Piece, type Row } from './wordDiff'

/** A side written with its marked words in [brackets], to read the tests at a glance. */
const show = (pieces: Piece[]): string => pieces.map((p) => (p.changed ? `[${p.text}]` : p.text)).join('')

/** Applies an edit script to check it turns `a` into `b`. */
function apply<T>(a: T[], b: T[], ops: string[]): { then: T[]; now: T[] } {
  const then: T[] = []
  const now: T[] = []
  let i = 0
  let j = 0
  for (const op of ops) {
    if (op === 'same') {
      then.push(a[i++])
      now.push(b[j++])
    } else if (op === 'then') then.push(a[i++])
    else now.push(b[j++])
  }
  return { then, now }
}

describe('editScript', () => {
  const eq = (x: string, y: string) => x === y

  it('finds the shortest script, and every item is accounted for', () => {
    const a = 'ABCABBA'.split('')
    const b = 'CBABAC'.split('')
    const ops = editScript(a, b, eq)!
    expect(ops.filter((o) => o !== 'same')).toHaveLength(5)
    expect(apply(a, b, ops)).toEqual({ then: a, now: b })
  })

  it('handles empty sides and identical ones', () => {
    expect(editScript([], [], eq)).toEqual([])
    expect(editScript(['a'], [], eq)).toEqual(['then'])
    expect(editScript([], ['a', 'b'], eq)).toEqual(['now', 'now'])
    expect(editScript(['a', 'b'], ['a', 'b'], eq)).toEqual(['same', 'same'])
  })

  it('gives up (null) when the two differ in more places than asked', () => {
    const a = Array.from({ length: 50 }, (_, i) => `a${i}`)
    const b = Array.from({ length: 50 }, (_, i) => `b${i}`)
    expect(editScript(a, b, eq, 10)).toBeNull()
    expect(editScript(a, b, eq, 200)).toHaveLength(100)
  })

  it('stays right on longer random sequences', () => {
    let seed = 7
    const rand = () => (seed = (seed * 48271) % 2147483647) / 2147483647
    for (let round = 0; round < 30; round++) {
      const a = Array.from({ length: Math.floor(rand() * 40) }, () => 'abcde'[Math.floor(rand() * 5)])
      const b = Array.from({ length: Math.floor(rand() * 40) }, () => 'abcde'[Math.floor(rand() * 5)])
      const ops = editScript(a, b, eq)!
      expect(apply(a, b, ops)).toEqual({ then: a, now: b })
    }
  })
})

describe('tokenize', () => {
  it('keeps words whole, with their hyphens and apostrophes, and punctuation apart', () => {
    expect(tokenize("Mara's well-worn coat, wet.")).toEqual(["Mara's", ' ', 'well-worn', ' ', 'coat', ',', ' ', 'wet', '.'])
    expect(tokenize('Zoë — “Go!”').join('')).toBe('Zoë — “Go!”')
  })
})

describe('diffWords', () => {
  it('marks only the words that differ on each side', () => {
    const d = diffWords('The rain had not stopped since dawn.', 'The rain had stopped at last since dawn.')
    expect(show(d.then)).toBe('The rain had [not] stopped since dawn.')
    expect(show(d.now)).toBe('The rain had stopped [at last] since dawn.')
  })

  it('marks a change as one stretch, spaces included', () => {
    const d = diffWords('She ran to the old mill.', 'She walked slowly toward the old mill.')
    expect(show(d.then)).toBe('She [ran to] the old mill.')
    expect(show(d.now)).toBe('She [walked slowly toward] the old mill.')
  })

  it('marks changed punctuation without the word beside it', () => {
    const d = diffWords('Wait.', 'Wait!')
    expect(show(d.then)).toBe('Wait[.]')
    expect(show(d.now)).toBe('Wait[!]')
  })

  it('leaves identical text unmarked', () => {
    expect(diffWords('Same.', 'Same.')).toEqual({ then: [{ text: 'Same.', changed: false }], now: [{ text: 'Same.', changed: false }] })
  })

  it('keeps every character on its side', () => {
    const then = 'One two three, four five six.\nSeven eight.'
    const now = 'One three, four six seven.\nEight nine.'
    const d = diffWords(then, now)
    expect(d.then.map((p) => p.text).join('')).toBe(then)
    expect(d.now.map((p) => p.text).join('')).toBe(now)
  })
})

describe('paragraphs', () => {
  it('splits a scene at its blank lines, keeping scene breaks', () => {
    expect(paragraphsOf('One.\n\n* * *\n\nTwo,\nwith a line break.\n\n\n')).toEqual(['One.', '* * *', 'Two,\nwith a line break.'])
    expect(paragraphsOf('')).toEqual([])
  })

  it('measures how alike two paragraphs are', () => {
    expect(likeness('The rain fell.', 'The rain fell.')).toBe(1)
    expect(likeness('The rain fell on the town.', 'Snow came instead.')).toBe(0)
    expect(likeness('The rain fell on the town.', 'The rain fell on the old town.')).toBeGreaterThan(0.8)
  })
})

describe('compareTexts', () => {
  const kinds = (rows: Row[]) => rows.map((r) => r.kind)

  it('lines up the paragraphs that stayed, and pairs a changed one with what it became', () => {
    const then = 'The rain fell.\n\nMara waited by the door.\n\nThe end.'
    const now = 'The rain fell.\n\nMara waited by the old door, cold.\n\nThe end.'
    const rows = compareTexts(then, now)
    expect(kinds(rows)).toEqual(['same', 'changed', 'same'])
    const changed = rows[1] as Extract<Row, { kind: 'changed' }>
    expect(show(changed.then)).toBe('Mara waited by the door.')
    expect(show(changed.now)).toBe('Mara waited by the [old] door[, cold].')
  })

  it('shows a paragraph that went, or one that came, on its own side', () => {
    expect(kinds(compareTexts('A.\n\nGone entirely.\n\nB.', 'A.\n\nB.'))).toEqual(['same', 'then', 'same'])
    expect(kinds(compareTexts('A.\n\nB.', 'A.\n\nB.\n\nA whole new ending.'))).toEqual(['same', 'same', 'now'])
  })

  it("doesn't pair paragraphs that have nothing in common", () => {
    const rows = compareTexts('Night fell over the harbour.', 'Breakfast was cold porridge again.')
    expect(kinds(rows)).toEqual(['then', 'now'])
  })

  it('pairs the most alike when several paragraphs changed at once', () => {
    const then = 'Mara opened the door slowly.\n\nTobin said nothing at all.'
    const now = 'A gull cried.\n\nMara opened the heavy door slowly.\n\nTobin said nothing.'
    const rows = compareTexts(then, now)
    expect(kinds(rows)).toEqual(['now', 'changed', 'changed'])
  })

  it('compares an empty side', () => {
    expect(kinds(compareTexts('', 'New words.'))).toEqual(['now'])
    expect(kinds(compareTexts('Old words.', ''))).toEqual(['then'])
    expect(compareTexts('', '')).toEqual([])
  })
})
