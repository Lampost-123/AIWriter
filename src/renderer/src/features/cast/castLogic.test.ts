import { describe, expect, it } from 'vitest'
import type { EntryKind } from '@shared/types'
import type { NamedEntry } from '@shared/contracts/manuscript'
import { cardHasNoCast, castGroups } from './castLogic'

const entry = (id: string, kind: EntryKind = 'character'): NamedEntry => ({
  id,
  kind,
  name: id,
  aliases: [],
  summary: '',
  image: null,
  absent: null,
  state: [],
  voice: null
})

const entries = [entry('mara'), entry('tobin'), entry('kell'), entry('mill', 'place'), entry('lamp', 'item'), entry('fire', 'thread')]

describe('the Cast tab', () => {
  it('lists the point of view first, then the others present, then where, then anyone else the text names', () => {
    const cast = { povId: 'mara', presentIds: ['tobin'], locationId: 'mill' }
    const groups = castGroups({ entries, cast }, ['kell', 'mara', 'lamp', 'fire'])
    expect(groups.map((g) => [g.title, g.entries.map((e) => e.id)])).toEqual([
      ['Point of view', ['mara']],
      ['Also in the scene', ['tobin']],
      ['Where', ['mill']],
      ['Named in the text', ['kell', 'lamp']]
    ])
  })

  it('shows each one once, and leaves out empty groups, plot threads and entries deleted since', () => {
    const cast = { povId: null, presentIds: ['tobin', 'gone', 'tobin', 'fire'], locationId: null }
    const groups = castGroups({ entries, cast }, ['tobin'])
    expect(groups.map((g) => [g.key, g.entries.map((e) => e.id)])).toEqual([['present', ['tobin']]])
  })

  it('is empty for a scene with no cast that names no one', () => {
    const cast = { povId: null, presentIds: [], locationId: null }
    expect(castGroups({ entries, cast }, [])).toEqual([])
    expect(cardHasNoCast(cast)).toBe(true)
    expect(cardHasNoCast({ ...cast, locationId: 'mill' })).toBe(false)
  })
})
