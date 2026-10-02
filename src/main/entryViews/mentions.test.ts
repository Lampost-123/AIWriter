import { describe, expect, it } from 'vitest'
import { mentionAt } from '../keeper/text'
import { buildNameIndex, findMentions, mentionEnd, patternKeys, quoteAround, type Named } from './mentions'

const entry = (id: string, name: string, aliases: string[] = []): Named => ({ id, name, aliases })

/** The entries a text names, by the one-pass finder. */
function named(entries: Named[], text: string): string[] {
  const ix = buildNameIndex(entries)
  const ids = new Set<string>()
  for (const k of findMentions(ix, text).keys()) for (const id of ix.patterns.get(k)!.entryIds) ids.add(id)
  return [...ids].sort()
}

/** The same, one entry and name at a time with the memory keeper's own rule. */
const byKeeper = (entries: Named[], text: string): string[] =>
  entries
    .filter((e) => [e.name, ...e.aliases].some((n) => !/^(unnamed|new character)$/i.test(n.trim()) && mentionAt(text, n) !== null))
    .map((e) => e.id)
    .sort()

describe('finding names in a scene', () => {
  const people = [
    entry('mara', 'Mara', ['the ferrywoman']),
    entry('will', 'Will'),
    entry('rose', 'Rose'),
    entry('tobin', 'Tobin Ash'),
    entry('kel', "Kel'oran"),
    entry('venn', 'Dr. Venn'),
    entry('eel', 'Eelmouth'),
    entry('legion', '3rd Legion'),
    entry('emil', 'Émile'),
    entry('bones', "'Bones'"),
    entry('new', 'New character')
  ]

  it('follows the memory keeper’s rule: one capitalised word must be capitalised; phrases and lower-case aliases ignore case', () => {
    const cases = [
      'Mara crossed the river.',
      'mara crossed the river.',
      'She will go, said the rose.',
      'Will went with Rose.',
      'THE FERRYWOMAN waited. tobin   ash did not.',
      'Tobin Ashford was not Tobin.',
      "Mara's hand. Maraud is no name.",
      "The Kel'oran rose; Kel alone does not count.",
      'Dr. Venn came. Dr Venn did not.',
      'At Eelmouth2 nothing; at Eelmouth, everything.',
      'The 3rd legion marched.',
      'Émile et émile.',
      "They called him 'Bones' at sea.",
      'A New character appears.',
      ''
    ]
    for (const text of cases) expect(named(people, text), text).toEqual(byKeeper(people, text))
    expect(named(people, 'Will went with Rose.')).toEqual(['rose', 'will'])
    expect(named(people, 'She will go, said the rose.')).toEqual([])
    expect(named(people, 'The ferrywoman waited by Tobin Ash.')).toEqual(['mara', 'tobin'])
  })

  it('needs whole words, with letters and numbers on either side breaking a match', () => {
    expect(named(people, 'Maraud, Tobin Ashes, Eelmouth2, xMara')).toEqual([])
    expect(named(people, '(Mara) “Eelmouth”—Will.')).toEqual(['eel', 'mara', 'will'])
  })

  it('handles letters outside the basic plane as letters', () => {
    const astral = [entry('x', '𝐀mara')]
    expect(named(astral, 'He met 𝐀mara today.')).toEqual(byKeeper(astral, 'He met 𝐀mara today.'))
    expect(named([entry('mara', 'Mara')], '𝐀Mara')).toEqual([])
  })

  it('never looks for the names new entries are given', () => {
    expect(named([entry('n', 'Unnamed'), entry('m', 'New place')], 'An unnamed New place.')).toEqual([])
  })

  it('says where the first mention starts and ends', () => {
    const ix = buildNameIndex([entry('tobin', 'Tobin Ash')])
    const text = 'First line.\n\nThen tobin  ash came, and Tobin Ash left.'
    const [key] = patternKeys(entry('tobin', 'Tobin Ash'))
    const at = findMentions(ix, text).get(key)!
    expect(text.slice(at, mentionEnd(ix, key, text, at))).toBe('tobin  ash')
  })
})

describe('the words around a mention', () => {
  it('is the sentence it is in, within its paragraph, exactly as written', () => {
    const text = 'The rain had not let up.\n\nMara kept her hood low. Tobin watched her go! Then the bell rang.'
    const at = text.indexOf('Tobin')
    expect(quoteAround(text, at, at + 5)).toBe('Tobin watched her go!')
    expect(quoteAround(text, text.indexOf('Mara'), text.indexOf('Mara') + 4)).toBe('Mara kept her hood low.')
  })

  it('keeps a name with a full stop in it whole', () => {
    const text = 'They waited. At last Dr. Venn came in.'
    const at = text.indexOf('Dr.')
    expect(quoteAround(text, at, at + 8)).toBe('At last Dr. Venn came in.')
  })

  it('cuts a long sentence to a few words either side', () => {
    const words = Array.from({ length: 40 }, (_, i) => `w${i}`)
    words[20] = 'Mara'
    const text = `${words.join(' ')}.`
    const at = text.indexOf('Mara')
    const q = quoteAround(text, at, at + 4)
    expect(q.split(' ')).toHaveLength(25)
    expect(q.startsWith('w10 ')).toBe(true)
    expect(text.includes(q)).toBe(true)
  })
})
