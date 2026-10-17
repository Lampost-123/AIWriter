import { describe, expect, it } from 'vitest'
import { bareName, differsByDigit, findMatch, isPlaceholderName, isProperName, withinOneEdit, type Named } from './names'

const e = (id: string, kind: Named['kind'], name: string, aliases: string[] = []): Named => ({ id, kind, name, aliases })

describe('names', () => {
  it('compares names without case, accents, curly apostrophes, a possessive, punctuation, extra spaces or a leading "the"', () => {
    expect(bareName('  Márra   Venn ')).toBe('marra venn')
    expect(bareName('Tam’s Rest')).toBe('tam rest')
    expect(bareName('The Salt Guild')).toBe('salt guild')
    expect(bareName('Salt Guild')).toBe('salt guild')
    // One rule with the outline's (2026-10-17): "The Café's" is "cafe", and other alphabets are kept.
    expect(bareName('The Café’s')).toBe('cafe')
    expect(bareName('O’Brien-Holt')).toBe('o brien holt')
    expect(bareName('Красная Башня')).toBe('красная башня')
  })

  it('finds a name written with other punctuation or a possessive as the same', () => {
    const world = [e('rest', 'place', "Tam's Rest"), e('bren', 'character', 'Old Bren')]
    expect(findMatch({ kind: 'place', name: 'Tams Rest', aliases: [] }, world)).toBeNull()
    expect(findMatch({ kind: 'place', name: 'Tam’s Rest.', aliases: [] }, world)?.id).toBe('rest')
    expect(findMatch({ kind: 'character', name: 'Old Bren’s', aliases: [] }, world)?.id).toBe('bren')
  })

  it('knows names one letter apart, unless the letter is a digit', () => {
    expect(withinOneEdit('marra', 'mara')).toBe(true)
    expect(withinOneEdit('mara', 'maro')).toBe(true)
    expect(withinOneEdit('mara', 'mira venn')).toBe(false)
    expect(withinOneEdit('grimsby', 'grimbsy')).toBe(true)
    expect(withinOneEdit('grimsby', 'girmsyb')).toBe(false)
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
    // The same name of another kind already in the world is that thing: never a second entry for it...
    expect(find('place', 'Tobin')).toBe('tobin')
    // ...unless the same summary names that thing too (the place "Ironhold" and the group "Ironhold" are both made).
    expect(findMatch({ kind: 'group', name: 'Tobin', aliases: [] }, world, new Set(['tobin']))).toBeNull()
    expect(findMatch({ kind: 'character', name: 'Tobin', aliases: [] }, world, new Set(['tobin']))?.id).toBe('tobin')
  })

  it('treats a clear typo of a long name (two letters swapped), of the same kind, as a near-duplicate', () => {
    expect(find('character', 'Tobni')).toBe('tobin')
    // A changed, dropped or doubled letter could be someone else, so it is (Adam: when unsure, different).
    expect(find('character', 'Tobyn')).toBeNull()
    expect(find('place', 'Saltmars')).toBeNull()
    expect(find('group', 'Tobni')).toBeNull()
    expect(find('character', 'Guard 2')).toBeNull()
    expect(find('character', 'Al')).toBeNull()
    const towns = [e('grimsby', 'place', 'Grimsby')]
    expect(findMatch({ kind: 'place', name: 'Grimbsy', aliases: [] }, towns)?.id).toBe('grimsby')
  })

  it('never takes a short name, another first letter, or a name near two others, as a typo', () => {
    const people = [e('tom', 'character', 'Tom'), e('mara', 'character', 'Mara Venn'), e('tobin', 'character', 'Tobin')]
    const in_ = (name: string, list = people) => findMatch({ kind: 'character', name, aliases: [] }, list)?.id ?? null
    expect(in_('Tim')).toBeNull()
    expect(in_('Robin')).toBeNull()
    expect(in_('Tobni')).toBe('tobin')
    expect(in_('Tobni', [...people, e('tobni', 'character', 'Tobnin')])).toBeNull()
    // One changed letter is a different person, whether or not the same summary names both.
    expect(in_('Tobim')).toBeNull()
    expect(in_('Mira Venn')).toBeNull()
    expect(in_('Marra Venn')).toBeNull()
    expect(findMatch({ kind: 'character', name: 'Mara Vnen', aliases: [] }, people)?.id).toBe('mara')
    expect(findMatch({ kind: 'character', name: 'Mara Vnen', aliases: [] }, people, new Set(['mara']))).toBeNull()
  })

  it('knows a name from a description', () => {
    expect(isProperName('The Ferryman')).toBe(true)
    expect(isProperName('Bram Holt')).toBe(true)
    expect(isProperName('Tam of the Hill')).toBe(true)
    expect(isProperName('The old ferryman')).toBe(false)
    expect(isProperName('two guards')).toBe(false)
    expect(isProperName('Unnamed')).toBe(false)
  })

  it('takes a first name alone as the one character whose full name starts with it, and the other way round', () => {
    expect(find('character', 'Mara')).toBe('mara')
    expect(find('character', 'Tobin Venn')).toBe('tobin')
    const two = [...world, e('mara2', 'character', 'Mara Quill')]
    expect(findMatch({ kind: 'character', name: 'Mara', aliases: [] }, two)).toBeNull()
    expect(find('place', 'Mara')).toBeNull()
  })
})
