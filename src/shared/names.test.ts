import { describe, expect, it } from 'vitest'
import { askingAt, calledFor, ignoresCase, namedInProse, startsSentence } from './names'

const at = (text: string, word: string): [number, number] => {
  const i = text.indexOf(word)
  return [i, i + word.length]
}

describe('names in prose', () => {
  it('a whole word or phrase, and a possessive', () => {
    expect(namedInProse('Mara’s knife was gone.', 'Mara')).toBe(true)
    expect(namedInProse("It was Mara's.", 'Mara')).toBe(true)
    expect(namedInProse('Marabel laughed.', 'Mara')).toBe(false)
    expect(namedInProse('The Captain’s boots were wet.', 'the Captain')).toBe(true)
    expect(namedInProse('the\ncaptain came in', 'the Captain')).toBe(true)
    expect(namedInProse('Her brother came in late.', 'her brother')).toBe(true)
    expect(namedInProse('Her brothers came in late.', 'her brother')).toBe(false)
  })

  it('a single capitalised name only capitalised: "will" and "hope" are words', () => {
    expect(namedInProse('She will go, and there is hope yet.', 'Will')).toBe(false)
    expect(namedInProse('She will go, and there is hope yet.', 'Hope')).toBe(false)
    expect(namedInProse('She looked at Hope.', 'Hope')).toBe(true)
    expect(ignoresCase('Will')).toBe(false)
    expect(ignoresCase('the Captain')).toBe(true)
    expect(ignoresCase('boss')).toBe(true)
  })

  it('"Will you…?" and "May I…?" at the start of a sentence are the words, not the names', () => {
    expect(namedInProse('“Will you come?” she asked.', 'Will')).toBe(false)
    expect(namedInProse('Will the boat hold? Nobody knew.', 'Will')).toBe(false)
    expect(namedInProse('She sighed. May I sit?', 'May')).toBe(false)
    expect(namedInProse('Will not one of you help?', 'Will')).toBe(false)
    // The name, as prose names people.
    expect(namedInProse('Will drew his knife.', 'Will')).toBe(true)
    expect(namedInProse('“Go,” said Will.', 'Will')).toBe(true)
    expect(namedInProse('Tell Will you love him.', 'Will')).toBe(true)
    expect(namedInProse('“Will you come?” she asked. Will shook his head.', 'Will')).toBe(true)
  })

  it('where a sentence starts', () => {
    expect(startsSentence('Will you?', 0)).toBe(true)
    const text = 'She waited. “Will you?” Then Will went.'
    expect(startsSentence(text, text.indexOf('Will'))).toBe(true)
    expect(startsSentence(text, text.lastIndexOf('Will'))).toBe(false)
    expect(askingAt(text, ...at(text, 'Will'))).toBe(true)
    expect(askingAt('Will went home.', 0, 4)).toBe(false)
  })

  it('nothing for names too short or texts empty', () => {
    expect(namedInProse('A b c', 'A')).toBe(false)
    expect(namedInProse('', 'Mara')).toBe(false)
  })

  it('what one scene calls a character', () => {
    const list = [
      { entryId: 'a', words: 'her brother' },
      { entryId: 'b', words: 'the Captain' },
      { entryId: 'a', words: 'the boy' }
    ]
    expect(calledFor(list, 'a')).toEqual(['her brother', 'the boy'])
    expect(calledFor(undefined, 'a')).toEqual([])
  })
})
