import { describe, expect, it } from 'vitest'
import type { EntryKind } from '@shared/types'
import { buildNameIndex, entriesNamedIn, findNames, namesToMatch, updateNameIndex, withCalled, type NameSource } from './nameMatch'

const entry = (id: string, name: string, aliases: string[] = [], kind: EntryKind = 'character'): NameSource => ({ id, kind, name, aliases })
const found = (text: string, entries: NameSource[]): string[] =>
  findNames(text, buildNameIndex(entries)).map((m) => text.slice(m.start, m.end))

describe('the memory keeper’s rule for a mention', () => {
  it('a single capitalised word matches only capitalised, as a whole word', () => {
    const will = [entry('w', 'Will')]
    expect(found('Will said he will come.', will)).toEqual(['Will'])
    // "Will’s" names him; "Will-o’-the-wisp" is another word, joined by a hyphen (long story memory fix 12).
    expect(found('WILL. Willow. Will’s boat. Will-o’-the-wisp.', will)).toEqual(['Will'])
    expect(found('Will2 and 2Will', will)).toEqual([])
  })

  it('phrases ignore case and the spaces between their words', () => {
    const tom = [entry('t', 'Old Tom')]
    expect(found('old tom came by, then OLD   TOM\nleft.', tom)).toEqual(['old tom', 'OLD   TOM'])
    expect(found('Old Tomas', tom)).toEqual([])
  })

  it('names shorter than two characters never match, nor names the app gave a new entry', () => {
    expect(found('A walked past X and a New character.', [entry('a', 'A'), entry('x', ' X '), entry('n', 'New character')])).toEqual([])
  })

  it('punctuation in a name must be there, word for word', () => {
    expect(found('They rode to St. Ives, not St Ives.', [entry('s', 'St. Ives', [], 'place')])).toEqual(['St. Ives'])
    expect(found("Kel'oran and Kel oran", [entry('k', "Kel'oran", [], 'glossary')])).toEqual(["Kel'oran"])
  })
})

describe('what is underlined', () => {
  it('names and aliases of every kind but plot threads', () => {
    const list = [
      entry('m', 'Mara Venn', ['Mara', 'the smith’s girl']),
      entry('e', 'The Gilded Eel', [], 'place'),
      entry('t', 'Who burned the mill?', [], 'thread')
    ]
    expect(found('Mara walked into The Gilded Eel. Who burned the mill? The smith’s girl knew.', list)).toEqual([
      'Mara',
      'The Gilded Eel',
      'The smith’s girl'
    ])
  })

  it('a lower-case alias only when it has two words or more', () => {
    expect(namesToMatch(entry('m', 'Mara', ['boss', 'the boss', 'Red', 'x']))).toEqual(['Mara', 'the boss', 'Red'])
    expect(found('The boss saw the boss. Boss.', [entry('m', 'Mara', ['boss', 'the boss'])])).toEqual(['The boss', 'the boss'])
  })

  it('the longest name wins where two start at the same word, and matches never overlap', () => {
    const list = [entry('m', 'Mara', ['Mara Venn']), entry('v', 'Venn'), entry('h', 'Mara Venn of Harrow')]
    const ms = findNames('Mara Venn of Harrow met Mara Venn and Mara.', buildNameIndex(list))
    expect(ms.map((m) => m.entryId)).toEqual(['h', 'm', 'm'])
    expect(ms.map((m) => [m.start, m.end])).toEqual([
      [0, 19],
      [24, 33],
      [38, 42]
    ])
  })

  it('italics splitting a name change nothing: the paragraph’s text is read as one', () => {
    // In the editor "Mara *Venn*" is two text pieces, but the paragraph's text is "Mara Venn".
    expect(found('Mara Venn', [entry('m', 'Mara Venn')])).toEqual(['Mara Venn'])
  })

  it('lists the entries named, in the order first named', () => {
    const index = buildNameIndex([entry('m', 'Mara'), entry('t', 'Tobin'), entry('k', 'Kell')])
    expect(entriesNamedIn('Tobin waved. Mara waved back. Tobin left.', index)).toEqual(['t', 'm'])
  })

  it('the index key changes only when a name, an alias or a kind does', () => {
    const a = buildNameIndex([entry('m', 'Mara'), entry('t', 'Tobin')])
    expect(buildNameIndex([entry('t', 'Tobin'), entry('m', 'Mara')]).key).toBe(a.key)
    expect(buildNameIndex([entry('m', 'Mara', ['Red']), entry('t', 'Tobin')]).key).not.toBe(a.key)
    expect(buildNameIndex([entry('m', 'Mara'), entry('t', 'Tobin', [], 'thread')]).key).not.toBe(a.key)
    // A new one-liner or state changes no name: the page keeps its underlines as they are.
    expect(updateNameIndex(a, [entry('t', 'Tobin'), entry('m', 'Mara')])).toBe(a)
    expect(updateNameIndex(a, [entry('t', 'Tobin'), entry('m', 'Mara'), entry('k', 'Kell')]).size).toBe(3)
  })
})

describe('however a character is named (long story memory fix 12)', () => {
  it('by what this scene calls them, marked as such; never a lower-case word alone, nor one of their own names again', () => {
    const tobin: NameSource = { ...entry('t', 'Tobin', ['Toby']), called: ['her brother', 'boss', 'Toby', 'the Ferryman'] }
    expect(namesToMatch(tobin)).toEqual(['Tobin', 'Toby', 'her brother', 'the Ferryman'])
    const ms = findNames('Her brother waved to Tobin and the ferryman.', buildNameIndex([tobin]))
    expect(ms.map((m) => [m.entryId, m.called ?? false])).toEqual([
      ['t', true],
      ['t', false],
      ['t', true]
    ])
  })

  it('a scene’s names give each entry what the scene calls it', () => {
    const entries = [entry('m', 'Mara'), entry('t', 'Tobin')]
    expect(withCalled({ entries })).toBe(entries)
    const called = withCalled({ entries, called: [{ entryId: 't', words: 'her brother' }, { entryId: 't', words: 'the Ferryman' }] })
    expect(called.map((e) => e.called)).toEqual([undefined, ['her brother', 'the Ferryman']])
  })

  it('any apostrophe for any, a hyphen joins words, and a dot must be there', () => {
    expect(found("Ask O’Brien, then O‘Brien, then O'Brien.", [entry('o', "O'Brien")])).toEqual(['O’Brien', 'O‘Brien', "O'Brien"])
    expect(found("Ask O'Brien.", [entry('o', 'O’Brien')])).toEqual(["O'Brien"])
    expect(found('Jean-Luc met Jean. Mara-Jane waved.', [entry('j', 'Jean'), entry('m', 'Mara')])).toEqual(['Jean'])
    expect(found('Jean-Luc came.', [entry('j', 'Jean-Luc')])).toEqual(['Jean-Luc'])
    expect(found('Dr. Hale and Dr Hale.', [entry('h', 'Dr. Hale')])).toEqual(['Dr. Hale'])
  })

  it('"Will you come?" asks; "Will said" names him', () => {
    const will = [entry('w', 'Will')]
    expect(found('“Will you come?” she asked.', will)).toEqual([])
    expect(found('She paused. Will the boat hold?', will)).toEqual([])
    expect(found('Will said nothing. “Go,” said Will.', will)).toEqual(['Will', 'Will'])
    expect(found('Will be there. Will never forget it. Will could see the shore. Will still had the knife.', will)).toEqual(['Will', 'Will'])
  })

  it('the key changes when what a scene calls someone does, or when it becomes one of their names', () => {
    const plain = buildNameIndex([entry('m', 'Mara')])
    const called = buildNameIndex([{ ...entry('m', 'Mara'), called: ['the Captain'] }])
    const alias = buildNameIndex([{ ...entry('m', 'Mara', ['the Captain']), called: ['the Captain'] }])
    expect(new Set([plain.key, called.key, alias.key]).size).toBe(3)
    expect(findNames('The Captain nodded.', alias)[0].called).toBeUndefined()
  })
})

describe('speed: a keystroke has 16 ms, and the underlines must take a small part of it', () => {
  // 500 entries, each with a two-word name and two aliases, and prose that names some of them.
  const first = ['Mara', 'Tobin', 'Kell', 'Wren', 'Ilse', 'Hal', 'Jory', 'Bran', 'Edda', 'Oswin']
  const entries: NameSource[] = []
  for (let i = 0; i < 500; i++) {
    const given = `${first[i % first.length]}${i}`
    entries.push(entry(`e${i}`, `${given} Venn`, [given, `the ${given.toLowerCase()} girl`], i % 5 === 0 ? 'place' : 'character'))
  }
  const words = (
    'the rain had not let up and she kept her hood low as the ferry came in over grey water while someone called out from the bank'
  ).split(' ')
  const prose = (n: number): string => {
    const out: string[] = []
    for (let i = 0; i < n; i++) out.push(i % 23 === 0 ? `${first[i % first.length]}${i % 500}` : words[i % words.length])
    return out.join(' ')
  }
  const time = (fn: () => unknown): number => {
    const times: number[] = []
    for (let i = 0; i < 7; i++) {
      const t = performance.now()
      fn()
      times.push(performance.now() - t)
    }
    return times.sort((a, b) => a - b)[3]
  }

  it('builds the index for 500 entries quickly (once per change to the list, never per keystroke)', () => {
    const t = time(() => buildNameIndex(entries))
    console.log(`name index for 500 entries: ${t.toFixed(2)} ms`)
    expect(t).toBeLessThan(50)
  })

  it('scans a 300-word paragraph (what a keystroke rescans) in well under a millisecond or two', () => {
    const index = buildNameIndex(entries)
    const paragraph = prose(300)
    expect(findNames(paragraph, index).length).toBeGreaterThan(5)
    const t = time(() => findNames(paragraph, index))
    console.log(`a 300-word paragraph: ${t.toFixed(3)} ms`)
    expect(t).toBeLessThan(4)
  })

  it('scans a whole 6,000-word scene (opening it, or the names list changing) well within a frame', () => {
    const index = buildNameIndex(entries)
    const scene = prose(6000)
    const t = time(() => findNames(scene, index))
    console.log(`a 6,000-word scene: ${t.toFixed(2)} ms`)
    expect(t).toBeLessThan(16)
  })
})
