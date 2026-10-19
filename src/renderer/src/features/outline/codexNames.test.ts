// A suggestion's names in the Edit form's pickers (2026-10-19): a name the codex has is its page, any other stands for
// itself; picking gives names back, a room as "Kitchen, Venn House" when another place shares its name.

import { describe, expect, it } from 'vitest'
import type { Entry, EntryKind } from '@shared/types'
import { codexOf, namesFor, pageFor, picksFor } from './codexNames'

const entry = (id: string, kind: EntryKind, name: string, more: Partial<Entry> = {}): Entry =>
  ({ id, kind, name, aliases: [], summary: '', parentId: null, ...more }) as Entry

const all: Entry[] = [
  entry('mara', 'character', 'Mara Venn', { aliases: ['Mara'] }),
  entry('holt', 'character', 'Jon Holt'),
  entry('house', 'place', 'Venn House'),
  entry('inn', 'place', 'The Gull Inn'),
  entry('k1', 'place', 'Kitchen', { parentId: 'house' }),
  entry('k2', 'place', 'Kitchen', { parentId: 'inn' }),
  entry('ledger', 'thread', 'The missing ledger')
]

describe('names in the pickers', () => {
  const people = codexOf('character', all)
  const places = codexOf('place', all)

  it('finds a page by its name or another name, and a room by the place it is in', () => {
    expect(pageFor('mara', people)?.id).toBe('mara')
    expect(pageFor('Kitchen, The Gull Inn', places, all)?.id).toBe('k2')
    expect(pageFor('Captain Nobody', people)).toBeNull()
  })

  it('shows codex pages as themselves and other names as stand-ins', () => {
    const { ids, options } = picksFor('character', ['Mara', 'Old Bren', ' ', 'mara venn'], people, all)
    expect(ids).toEqual(['mara', 'new:Old Bren'])
    expect(options.map((o) => o.name)).toEqual(['Mara Venn', 'Jon Holt', 'Old Bren'])
    expect(options[2]).toMatchObject({ kind: 'character', aliases: [] })
  })

  it('gives names back as the suggestion holds them', () => {
    expect(namesFor(['mara', 'new:Old Bren', 'gone'], people, all)).toEqual(['Mara Venn', 'Old Bren'])
    // Two kitchens: the one picked keeps the place it is in, so the keep finds it again.
    expect(namesFor(['k1'], places, all)).toEqual(['Kitchen, Venn House'])
    expect(namesFor(['inn'], places, all)).toEqual(['The Gull Inn'])
    expect(namesFor(['ledger'], codexOf('thread', all), all)).toEqual(['The missing ledger'])
  })

  it('says where a room is in the list', () => {
    expect(places.find((p) => p.id === 'k1')?.summary).toBe('In Venn House')
  })
})
