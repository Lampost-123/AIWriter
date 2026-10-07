import { describe, expect, it } from 'vitest'
import { stickyEntries } from './sticky'

const e = (id: string, kind: 'character' | 'place' | 'item' | 'thread', name: string, aliases: string[] = []) => ({ id, kind, name, aliases })
const entries = [
  e('mara', 'character', 'Mara'),
  e('kell', 'character', 'Kell'),
  e('ring', 'item', 'copper ring', ['the ring']),
  e('mill', 'place', 'Old Mill'),
  e('debt', 'thread', 'The debt'),
  e('will', 'character', 'Will')
]
const card = (o: Partial<{ povId: string | null; presentIds: string[]; locationId: string | null; setsUpIds: string[] }> = {}) => ({
  povId: null,
  presentIds: [],
  locationId: null,
  ...o
})

describe('sticky entries: anything in either of the last two scenes', () => {
  it('keeps who and what was on the cards and named in the words, nearest scene first', () => {
    const ids = stickyEntries(entries, [
      { card: card({ povId: 'kell', locationId: 'mill' }), text: 'Kell turned the ring over in his fingers.' },
      { card: card({ povId: 'mara', setsUpIds: ['debt'] }), text: 'The Old Mill was dark.' }
    ])
    expect(ids).toEqual(['kell', 'mill', 'mara', 'debt', 'ring'])
  })

  it('takes only entries that exist here, and a plain word is not a name', () => {
    const ids = stickyEntries(entries.slice(0, 3), [{ card: card({ presentIds: ['gone'] }), text: 'You will see Mara soon.' }])
    expect(ids).toEqual(['mara'])
  })

  it('names plot threads only from a card', () => {
    expect(stickyEntries(entries, [{ card: card(), text: 'They spoke of the debt.' }])).toEqual([])
  })

  it('is empty with no scenes before', () => {
    expect(stickyEntries(entries, [])).toEqual([])
  })
})
