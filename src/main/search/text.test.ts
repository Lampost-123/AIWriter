import { describe, expect, it } from 'vitest'
import type { TextPart } from '@shared/contracts/search'
import {
  findTerm,
  fold,
  foldMap,
  hasPhrase,
  marked,
  matchesAll,
  parseQuery,
  plainWords,
  snippet,
  wordsToReveal,
  type Term
} from './text'

const terms = (q: string): Term[] => parseQuery(q)!.terms
/** Marked text as a string: matches in [brackets]. */
const show = (parts: TextPart[]): string => parts.map((p) => (p.hit ? `[${p.text}]` : p.text)).join('')

describe('folding', () => {
  it('ignores case and accents', () => {
    expect(fold('Élodie ÆSIR Ångström naïve')).toBe('elodie æsir angstrom naive')
    expect(fold('Plain ASCII')).toBe('plain ascii')
  })

  it('maps folded characters back to the original text', () => {
    const text = 'Café ﬁne'
    const m = foldMap(text)
    expect(m.folded).toBe('cafe fine')
    // "fi" comes from the one ligature character.
    const at = m.folded.indexOf('fine')
    expect(text.slice(m.start[at], m.end[at + 3])).toBe('ﬁne')
    expect(text.slice(m.start[3], m.end[3])).toBe('é')
  })
})

describe('reading a query', () => {
  it('folds the words and matches the last one by its start while it is being typed', () => {
    expect(parseQuery('Iron Gà')!.terms).toEqual([
      { word: 'iron', prefix: false },
      { word: 'ga', prefix: true }
    ])
    // A space after the last word: it is finished.
    expect(parseQuery('iron gate ')!.terms).toEqual([
      { word: 'iron', prefix: false },
      { word: 'gate', prefix: false }
    ])
  })

  it('splits on marks and keeps each word once', () => {
    expect(parseQuery('iron-gate, iron')!.terms.map((t) => t.word)).toEqual(['iron', 'gate'])
    expect(parseQuery('  ,.!  ')).toBeNull()
    expect(parseQuery('')).toBeNull()
  })

  it('reads a possessive as its name, and keeps an apostrophe inside a word', () => {
    // Never a word "s" of its own, which would match every word starting with s.
    expect(parseQuery("Mara's")!.terms).toEqual([{ word: 'mara', prefix: false }])
    expect(parseQuery('Mara’s ship')!.terms).toEqual([
      { word: 'mara', prefix: false },
      { word: 'ship', prefix: true }
    ])
    expect(parseQuery("Mara's mara")!.terms.map((t) => t.word)).toEqual(['mara'])
    // Halfway through typing the possessive: still just the name.
    expect(parseQuery("Mara'")!.terms).toEqual([{ word: 'mara', prefix: false }])
    expect(parseQuery('don’t O’Brie')!.terms).toEqual([
      { word: "don't", prefix: false },
      { word: "o'brie", prefix: true }
    ])
    expect(plainWords(fold('Mara’s Rest'))).toBe('mara rest')
    expect(plainWords(fold('The Iron-Gate'))).toBe('the iron gate')
  })
})

describe('matching', () => {
  const text = fold('The iron gate creaked. Mara’s gatekeeper slept; the dragons waited by the Gatehouse.')

  it('finds finished words whole and the last word by its start', () => {
    expect(findTerm(text, { word: 'gate', prefix: false })).toBe(text.indexOf('gate '))
    expect(findTerm(text, { word: 'gatek', prefix: true })).toBe(text.indexOf('gatekeeper'))
    expect(findTerm(text, { word: 'dragon', prefix: false })).toBe(-1)
    expect(findTerm(text, { word: 'dragon', prefix: true })).toBeGreaterThan(0)
    // Never from the middle of a word.
    expect(findTerm(text, { word: 'ate', prefix: true })).toBe(-1)
    expect(findTerm(text, { word: 'mara', prefix: false })).toBeGreaterThan(0)
  })

  it('needs every word, in any order, in any of the texts', () => {
    expect(matchesAll([text], terms('slept mara'))).toBe(true)
    expect(matchesAll([text], terms('slept tobin'))).toBe(false)
    expect(matchesAll(['mara', text], terms('mara dragons'))).toBe(true)
    expect(matchesAll([text], terms('MARA DRAG'))).toBe(true)
  })

  it('knows when the words are together as typed', () => {
    expect(hasPhrase(text, terms('iron gate'))).toBe(true)
    expect(hasPhrase(text, terms('iron ga'))).toBe(true)
    expect(hasPhrase(text, terms('gate iron'))).toBe(false)
    expect(hasPhrase(text, terms('creaked mara'))).toBe(true)
    expect(hasPhrase(fold('iron\n\ngate'), terms('iron gate'))).toBe(false)
    // A possessive in the text or the query keeps the words together.
    expect(hasPhrase(text, terms('mara gatekeeper'))).toBe(true)
    expect(hasPhrase(text, terms("Mara's gatek"))).toBe(true)
  })

  it('reads a curly apostrophe as a plain one', () => {
    expect(findTerm(fold('He said don’t.'), terms("don't")[0])).toBe(8)
    expect(matchesAll([fold('Old O’Brien')], terms("o'bri"))).toBe(true)
    expect(matchesAll([fold('Mara’s ship')], terms("mara's"))).toBe(true)
  })
})

describe('marked text and snippets', () => {
  it('marks every match in a title, keeping the original letters', () => {
    expect(show(marked('Élodie of the Iron Gate', terms('elodie gat')))).toBe('[Élodie] of the Iron [Gat]e')
    expect(show(marked('Mara Ashford', terms('mara ma')))).toBe('[Mara] Ashford')
    expect(show(marked('Nothing here', terms('mara')))).toBe('Nothing here')
  })

  it('marks only the name for a possessive, not every word starting with s', () => {
    const text = 'She said nothing. Mara’s sister stood at the stern, and the sea spray stung her eyes as Mara’s ship slid south.'
    expect(show(snippet(text, terms("Mara's")).parts)).toBe(
      'She said nothing. [Mara]’s sister stood at the stern, and the sea spray stung her eyes as [Mara]’s ship slid south.'
    )
    expect(show(marked('Mara’s Rest', terms("mara's rest")))).toBe('[Mara]’s [Rest]')
  })

  it('shows the words around the best match, cut at word breaks, with the matches marked', () => {
    const before = 'Long before any of this, the valley was quiet and nobody came. '.repeat(4)
    const after = 'After that the rain fell for days on end. '.repeat(4)
    const para = `${before}Then the iron gate creaked open and Mara walked through it alone. ${after}`
    const s = snippet(para, terms('mara gate'))
    const text = show(s.parts)
    expect(text.startsWith('…')).toBe(true)
    expect(text.endsWith('…')).toBe(true)
    expect(text).toContain('the iron [gate] creaked open and [Mara] walked')
    expect(text.length).toBeLessThan(230)
    // The words to open the scene at: the first match (both words are as rare), whole.
    expect(s.words).toBe('gate')
    expect(para.slice(s.at, s.at + 4)).toBe('gate')
  })

  it('takes the spot where the words are close together over an earlier lone match', () => {
    const text = `Mara slept. ${'Nothing happened for a long while after that. '.repeat(8)}At dawn Mara found the gate open.`
    const s = snippet(text, terms('mara gate'))
    expect(show(s.parts)).toContain('[Mara] found the [gate] open.')
    // The scene opens at the rarer of the two words there.
    expect(s.words).toBe('gate')
  })

  it('finds a rarer word in a long scene full of a common one', () => {
    // 600 of "the" before the one "gate": the common word doesn't crowd it out.
    const long = `${'The man and the dog walked on. '.repeat(300)}Then the iron gate creaked open.`
    const s = snippet(long, terms('the gate'))
    expect(show(s.parts)).toContain('Then [the] iron [gate] creaked open.')
    expect(s.words).toBe('gate')
    expect(wordsToReveal(long, s.at, s.words!)).toBe('gate')
    // Where no spot has both, the rarer word is the one shown.
    const apart = `${'The cat sat on the mat. '.repeat(20)}\n\nA gate.`
    expect(show(snippet(apart, terms('the gate')).parts)).toBe('…A [gate].')
    // Words of the query side by side are opened at together.
    expect(snippet(long, terms('iron gate')).words).toBe('iron gate')
  })

  it('selects the whole word for a word still being typed', () => {
    const s = snippet('The dragons waited.', terms('drag'))
    expect(show(s.parts)).toBe('The [drag]ons waited.')
    expect(s.words).toBe('dragons')
  })

  it('keeps to the paragraph and shows the start of the text when nothing matches', () => {
    const s = snippet('First paragraph about the sea.\n\nSecond one, where Mara waits.', terms('mara'))
    expect(show(s.parts)).toBe('…Second one, where [Mara] waits.')
    // A paragraph that ends before the snippet would gets no "…" after its last word.
    expect(show(snippet('Mara came into view.\nThe next paragraph.', terms('mara')).parts)).toBe('[Mara] came into view.')
    const none = snippet('A quiet opening line that goes on.', [])
    expect(show(none.parts)).toBe('A quiet opening line that goes on.')
    expect(none.words).toBeNull()
  })

  it('adds words around a match until the editor would find this spot first', () => {
    const text = 'The gatehouse stood empty.\n\nLater the gate opened.'
    const at = text.indexOf('gate opened')
    // "gate" alone, and "the gate", are found first in "The gatehouse", so words around it are added.
    expect(wordsToReveal(text, at, 'gate')).toBe('the gate opened.')
    expect(wordsToReveal('Only one gate here.', 9, 'gate')).toBe('gate')
    // Case and curly quotes don't make an earlier spot different.
    const t2 = 'Gate. Then Mara’s gate.'
    expect(wordsToReveal(t2, t2.lastIndexOf('gate'), 'gate')).toBe('Mara’s gate')
  })
})
