// The editor chat's tolerant matching (lab switch ANCHOR): words a model copies loosely are found at the scene's exact
// words, several matches are never guessed between, and nothing found comes back with the closest words. Invented text.
import { describe, expect, it } from 'vitest'
import { evenOut, findWords, pageFinds, paraRef, parasOfPlain, type MatchWords, type Para } from './anchor'

describe('paraRef (TEXTTOOLS): a paragraph named by its [n] or its id', () => {
  const ps: Para[] = [
    { n: 1, pid: 'ab12', from: 0, to: 5 },
    { n: 0, pid: null, from: 7, to: 12 },
    { n: 2, pid: 'cd34', from: 14, to: 20 }
  ]
  it('takes a number, digits, "[n]" or an id; never a scene break or a paragraph that isn’t there', () => {
    expect(paraRef(ps, 2)?.pid).toBe('cd34')
    expect(paraRef(ps, 1.2)?.pid).toBe('ab12')
    expect(paraRef(ps, '2')?.pid).toBe('cd34')
    expect(paraRef(ps, ' [1] ')?.pid).toBe('ab12')
    expect(paraRef(ps, 'cd34')?.n).toBe(2)
    expect(paraRef(ps, 'id: ab12')?.n).toBe(1)
    expect(paraRef(ps, 0)).toBeNull()
    expect(paraRef(ps, 3)).toBeNull()
    expect(paraRef(ps, 'zz99')).toBeNull()
    expect(paraRef(ps, null)).toBeNull()
  })
})

const PARAS = [
  'The tide came in over the flats—slow, then sudden—and took the nets.',
  '“I don’t care what the ledger says,” Odile said. She closed the tally book.',
  'Odile closed the tally book again and said nothing.',
  'The gulls said nothing.\nThe lamp burned on.'
]
const plain = PARAS.join('\n\n')
/** Words with no italics. */
const wordsOf = (text: string): MatchWords => ({
  plain: text,
  marked: text,
  toPlain: Array.from({ length: text.length + 1 }, (_, i) => i),
  toMarked: Array.from({ length: text.length + 1 }, (_, i) => i)
})
const words = wordsOf(plain)
const paras = parasOfPlain(plain)
const find = (raw: string, o = {}): ReturnType<typeof findWords> => findWords(words, paras, raw, o)
const taken = (raw: string, o = {}): string | null => {
  const f = find(raw, o)
  return f.ok ? plain.slice(f.from, f.to) : null
}

describe('evening words out', () => {
  it('straightens quotes, makes any dash one hyphen, squashes spacing and drops asterisks', () => {
    expect(evenOut('“It’s—*late*,”  she\nsaid -- twice', false).t).toBe(`"It's-late," she said-twice`)
    expect(evenOut('Odile', true).t).toBe('odile')
  })
})

describe('finding a model’s words', () => {
  it('takes exact words, and loosely copied ones, at the scene’s exact words', () => {
    expect(taken('took the nets')).toBe('took the nets')
    expect(taken(`"I don't care what the ledger says," Odile said.`)).toBe('“I don’t care what the ledger says,” Odile said.')
    expect(taken('the flats - slow, then sudden -- and took')).toBe('the flats—slow, then sudden—and took')
    expect(taken('the tide came in')).toBe('The tide came in')
    expect(taken('The gulls said nothing. The lamp')).toBe('The gulls said nothing.\nThe lamp')
    expect(taken('"The tide came in over the flats"')).toBe('The tide came in over the flats')
    expect(taken('[3] Odile closed the tally book again')).toBe('Odile closed the tally book again')
  })

  it('reads "A … B" as A, then B after it in the same paragraph', () => {
    expect(taken('The tide came in … took the nets.')).toBe(PARAS[0])
    expect(find('The tide came in … took the nets.')).toMatchObject({ ok: true, how: 'ellipsis' })
  })

  it('never guesses between several matches, unless the paragraph or occurrence says which', () => {
    expect(find('said nothing.')).toMatchObject({ ok: false, why: 'many', count: 2 })
    expect(find('said nothing.', { paragraph: 4 })).toMatchObject({ ok: true, para: { n: 4 } })
    expect(find('closed the tally book', { paragraph: 2 })).toMatchObject({ ok: true, para: { n: 2 } })
    expect(find('the')).toMatchObject({ ok: false, why: 'many' })
    expect(find('the', { paragraph: 1, occurrence: 2 })).toMatchObject({ ok: true, from: plain.indexOf('the nets') })
    // Whole words only, when there are any: "the" in "them" isn't counted.
    expect(findWords(wordsOf('Give them the nets.'), parasOfPlain('Give them the nets.'), 'the')).toMatchObject({ ok: true, from: 10 })
    expect(find('the', { paragraph: 1, occurrence: 9 })).toMatchObject({ ok: false, why: 'many', occurrence: 9 })
  })

  it('finds words in another paragraph than the one named, when they are there once', () => {
    expect(find('took the nets', { paragraph: 3 })).toMatchObject({ ok: true, para: { n: 1 }, elsewhere: true })
    expect(find('took the nets', { paragraph: 9 })).toMatchObject({ ok: false, why: 'no-paragraph', count: 4 })
  })

  it('says when words run across paragraphs', () => {
    expect(find('and took the nets. “I don’t care')).toMatchObject({ ok: false, why: 'spans', first: { n: 1 }, last: { n: 2 } })
  })

  it('takes one strong fuzzy match, and offers the closest words when none is strong', () => {
    // A word added: 7 of 8 in order.
    expect(taken('“I don’t care what the old ledger says,” Odile')).toBe('“I don’t care what the ledger says,” Odile')
    expect(find('“I don’t care what the old ledger says,” Odile')).toMatchObject({ ok: true, how: 'fuzzy' })
    // Punctuation changed, the words the same.
    expect(taken('Odile closed the tally book again, and said nothing')).toBe('Odile closed the tally book again and said nothing.')
    const none = find('The tide went out over the sand and the nets')
    expect(none).toMatchObject({ ok: false, why: 'none' })
    if (!none.ok && none.why === 'none') expect(plain.slice(none.near!.from, none.near!.to)).toMatch(/^The tide came in/)
  })

  it('finds a rewrite’s end after a place, taking the first', () => {
    const after = plain.indexOf('Odile closed')
    expect(find('the tally book', { after, first: true })).toMatchObject({ ok: true, from: plain.indexOf('the tally book again') })
  })
})

describe('where the page looks first', () => {
  it('matches as the page does: case and curly quotes aside, the first paragraph first', () => {
    expect(pageFinds(plain, paras, 'closed the tally book')).toBe(plain.indexOf('closed the tally book'))
    expect(pageFinds(plain, paras, 'odile CLOSED')).toBe(plain.indexOf('Odile closed'))
    expect(pageFinds(plain, paras, '"i don\'t care')).toBe(plain.indexOf('“I don’t'))
    expect(pageFinds(plain, paras, 'the tally book', plain.indexOf('Odile closed'))).toBe(plain.indexOf('the tally book again'))
  })
})
