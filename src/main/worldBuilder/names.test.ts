import { describe, expect, it } from 'vitest'
import { bareName, differsByDigit, findMatch, isPlaceholderName, normalizeName, withinOneEdit, type Named } from './names'

const e = (id: string, kind: Named['kind'], name: string, aliases: string[] = []): Named => ({ id, kind, name, aliases })

describe('names', () => {
  it('compares names without case, accents, curly apostrophes, extra spaces or a leading "the"', () => {
    expect(normalizeName('  Márra   Venn ')).toBe('marra venn')
    expect(normalizeName('Tam’s Rest')).toBe("tam's rest")
    expect(bareName('The Salt Guild')).toBe('salt guild')
    expect(bareName('Salt Guild')).toBe('salt guild')
  })

  it('knows names one letter apart, unless the letter is a digit', () => {
    expect(withinOneEdit('marra', 'mara')).toBe(true)
    expect(withinOneEdit('mara', 'maro')).toBe(true)
    expect(withinOneEdit('mara', 'mira venn')).toBe(false)
    expect(differsByDigit('guard 1', 'guard 2')).toBe(true)
    expect(differsByDigit('marra', 'mara')).toBe(false)
  })

  it('never counts the names new entries get before they are named', () => {
    expect(isPlaceholderName('Unnamed')).toBe(true)
    expect(isPlaceholderName('New plot thread')).toBe(true)
    expect(findMatch({ kind: 'character', name: 'Unnamed', aliases: [] }, [e('1', 'character', 'Unnamed')])).toBeNull()
  })
})

describe('finding what a name stands for', () => {
  const world = [
    e('mara', 'character', 'Mara Venn', ['Captain Venn']),
    e('tobin', 'character', 'Tobin'),
    e('guild', 'group', 'The Salt Guild'),
    e('guard1', 'character', 'Guard 1'),
    e('port', 'place', 'Saltmarsh')
  ]
  const find = (kind: Named['kind'], name: string, aliases: string[] = []) => findMatch({ kind, name, aliases }, world)?.id ?? null

  it('matches a name or other name exactly, of the same kind first, then of any kind', () => {
    expect(find('character', 'mara venn')).toBe('mara')
    expect(find('character', 'Captain Venn')).toBe('mara')
    expect(find('character', 'Someone', ['Captain Venn'])).toBe('mara')
    expect(find('group', 'Salt Guild')).toBe('guild')
    // The same name of another kind is the same thing: never a second entry for it.
    expect(find('place', 'Tobin')).toBe('tobin')
  })

  it('treats a name one letter away, of the same kind, as a near-duplicate', () => {
    expect(find('character', 'Tobyn')).toBe('tobin')
    expect(find('place', 'Saltmars')).toBe('port')
    expect(find('group', 'Tobyn')).toBeNull()
    expect(find('character', 'Guard 2')).toBeNull()
    expect(find('character', 'Al')).toBeNull()
  })

  it('takes a first name alone as the one character whose full name starts with it, and the other way round', () => {
    expect(find('character', 'Mara')).toBe('mara')
    expect(find('character', 'Tobin Venn')).toBe('tobin')
    const two = [...world, e('mara2', 'character', 'Mara Quill')]
    expect(findMatch({ kind: 'character', name: 'Mara', aliases: [] }, two)).toBeNull()
    expect(find('place', 'Mara')).toBeNull()
  })
})
