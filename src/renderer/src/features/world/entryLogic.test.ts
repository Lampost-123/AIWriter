import { describe, expect, it } from 'vitest'
import type { EntryKind } from '@shared/types'
import {
  filledCount,
  filterEntries,
  findNearDuplicates,
  isPlaceholderName,
  normalizeName,
  parentPlaceOptions,
  parseList,
  placeAndDescendants,
  placePath,
  withinOneEdit
} from './entryLogic'

const named = (id: string, name: string, aliases: string[] = [], kind: EntryKind = 'character') => ({ id, kind, name, aliases })

describe('withinOneEdit', () => {
  it('accepts names one letter apart', () => {
    expect(withinOneEdit('mara', 'marra')).toBe(true)
    expect(withinOneEdit('marra', 'mara')).toBe(true)
    expect(withinOneEdit('mara', 'mira')).toBe(true)
    expect(withinOneEdit('mara', 'mar')).toBe(true)
    expect(withinOneEdit('mara', 'xmara')).toBe(true)
    expect(withinOneEdit('mara', 'mara')).toBe(true)
  })
  it('rejects names two or more letters apart', () => {
    expect(withinOneEdit('mara', 'marion')).toBe(false)
    expect(withinOneEdit('mara', 'amra')).toBe(false)
    expect(withinOneEdit('tobin', 'robyn')).toBe(false)
    expect(withinOneEdit('ma', 'mara')).toBe(false)
  })
})

describe('normalizeName', () => {
  it('ignores case, accents and extra spaces', () => {
    expect(normalizeName('  Márra   the  Bold ')).toBe('marra the bold')
  })
})

describe('findNearDuplicates', () => {
  const others = [named('1', 'Mara'), named('2', 'Tobin', ['the ferryman']), named('3', 'Duke Aldric'), named('4', 'Varn', [], 'place')]

  it('warns about one-letter differences, ignoring case', () => {
    const d = findNearDuplicates(named('x', 'marra'), others)
    expect(d.map((x) => [x.entry.id, x.reason])).toEqual([['1', 'similar']])
  })

  it('warns about identical names', () => {
    expect(findNearDuplicates(named('x', 'MARA'), others)[0].reason).toBe('same')
  })

  it('warns when an alias is shared, either way round', () => {
    expect(findNearDuplicates(named('x', 'Old Tobin', ['The Ferryman']), others).map((d) => [d.entry.id, d.reason])).toEqual([['2', 'alias']])
    expect(findNearDuplicates(named('x', 'Ferrier', ['tobin']), others).map((d) => d.entry.id)).toEqual(['2'])
  })

  it('looks across kinds in the world', () => {
    expect(findNearDuplicates(named('x', 'Varn'), others).map((d) => d.entry.id)).toEqual(['4'])
  })

  it('never matches the entry itself', () => {
    expect(findNearDuplicates(named('1', 'Mara'), others)).toEqual([])
  })

  it('ignores empty names, placeholder names and very short names', () => {
    expect(findNearDuplicates(named('x', ''), others)).toEqual([])
    expect(findNearDuplicates(named('x', 'New character'), [named('y', 'New character')])).toEqual([])
    expect(findNearDuplicates(named('x', 'Al'), [named('y', 'Ed'), named('z', 'Am')])).toEqual([])
    expect(findNearDuplicates(named('x', 'Al'), [named('y', 'al')]).map((d) => d.reason)).toEqual(['same'])
  })

  it('does not warn about clearly different names', () => {
    expect(findNearDuplicates(named('x', 'Marion'), others)).toEqual([])
  })

  it('does not treat names that differ only by a number as near duplicates', () => {
    expect(findNearDuplicates(named('x', 'Guard 2'), [named('y', 'Guard 1'), named('z', 'Guard 12')])).toEqual([])
    expect(findNearDuplicates(named('x', 'Guard 2'), [named('y', 'Guard 2')]).map((d) => d.reason)).toEqual(['same'])
    expect(findNearDuplicates(named('x', 'Gard 2'), [named('y', 'Guard 2')]).map((d) => d.reason)).toEqual(['similar'])
  })

  it('stops at the limit', () => {
    const many = Array.from({ length: 10 }, (_, i) => named(String(i), 'Mara'))
    expect(findNearDuplicates(named('x', 'Mara'), many, 3)).toHaveLength(3)
  })
})

describe('isPlaceholderName', () => {
  it('spots the names given to new entries', () => {
    expect(isPlaceholderName('New character')).toBe(true)
    expect(isPlaceholderName('new place')).toBe(true)
    expect(isPlaceholderName('Unnamed')).toBe(true)
    expect(isPlaceholderName('New Tobin')).toBe(false)
  })
})

describe('places', () => {
  const places = [
    { id: 'city', name: 'Varn', parentId: null },
    { id: 'castle', name: 'Castle Varn', parentId: 'city' },
    { id: 'hall', name: 'Great Hall', parentId: 'castle' },
    { id: 'cellar', name: 'Cellar', parentId: 'hall' },
    { id: 'port', name: 'Saltmouth', parentId: null },
    { id: 'inn', name: 'The Gull', parentId: 'port' }
  ]

  it('finds a place and everything inside it', () => {
    expect([...placeAndDescendants(places, 'castle')].sort()).toEqual(['castle', 'cellar', 'hall'])
    expect([...placeAndDescendants(places, 'inn')]).toEqual(['inn'])
  })

  it('builds the path from the outermost place', () => {
    expect(placePath(places, 'cellar')).toEqual(['Varn', 'Castle Varn', 'Great Hall', 'Cellar'])
    expect(placePath(places, 'missing')).toEqual([])
  })

  it('never offers a place, or anything inside it, as its own parent', () => {
    const opts = parentPlaceOptions(places, 'castle').map((o) => o.value)
    expect(opts).not.toContain('castle')
    expect(opts).not.toContain('hall')
    expect(opts).not.toContain('cellar')
    expect(opts).toContain('city')
    expect(opts).toContain('inn')
  })

  it('labels options by path and sorts them', () => {
    expect(parentPlaceOptions(places, null).map((o) => o.label)).toEqual([
      'Saltmouth',
      'Saltmouth › The Gull',
      'Varn',
      'Varn › Castle Varn',
      'Varn › Castle Varn › Great Hall',
      'Varn › Castle Varn › Great Hall › Cellar'
    ])
  })

  it('survives a loop in stored data', () => {
    const loop = [
      { id: 'a', name: 'A', parentId: 'b' },
      { id: 'b', name: 'B', parentId: 'a' },
      { id: 'c', name: 'C', parentId: null }
    ]
    expect(placePath(loop, 'a')).toEqual(['B', 'A'])
    expect([...placeAndDescendants(loop, 'a')].sort()).toEqual(['a', 'b'])
    expect(parentPlaceOptions(loop, 'a').map((o) => o.value)).toEqual(['c'])
  })
})

describe('parseList', () => {
  it('splits on commas, trims and drops blanks and repeats', () => {
    expect(parseList(' Mara, the old woman ,, Captain, mara ')).toEqual(['Mara', 'the old woman', 'Captain'])
    expect(parseList('')).toEqual([])
  })
})

describe('filterEntries', () => {
  const entries = [
    { name: 'Tobin Hale', aliases: ['the ferryman'], summary: 'Grumpy ex-soldier who owes the Duke money' },
    { name: 'Mara', aliases: ['the heir'], summary: 'A thief with a dry wit' },
    { name: 'Duke Aldric', aliases: [], summary: 'Rules Varn' },
    { name: 'Aldo', aliases: [], summary: 'Cook' }
  ]

  it('returns everything for an empty search', () => {
    expect(filterEntries(entries, '  ')).toBe(entries)
  })

  it('matches names, aliases and summaries, ignoring case and accents', () => {
    expect(filterEntries(entries, 'FERRY').map((e) => e.name)).toEqual(['Tobin Hale'])
    expect(filterEntries(entries, 'thíef').map((e) => e.name)).toEqual(['Mara'])
  })

  it('needs every word to match', () => {
    expect(filterEntries(entries, 'duke money').map((e) => e.name)).toEqual(['Tobin Hale'])
  })

  it('puts names that start with the search first', () => {
    expect(filterEntries(entries, 'ald').map((e) => e.name)).toEqual(['Aldo', 'Duke Aldric'])
    expect(filterEntries(entries, 'duke').map((e) => e.name)).toEqual(['Duke Aldric', 'Tobin Hale'])
  })
})

describe('filledCount', () => {
  it('counts only fields with text', () => {
    expect(filledCount({ a: 'x', b: ' ', c: '' }, ['a', 'b', 'c', 'd'])).toBe(1)
  })
})
