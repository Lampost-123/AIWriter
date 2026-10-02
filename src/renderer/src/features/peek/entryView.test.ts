import { describe, expect, it } from 'vitest'
import type { StateLine } from '@shared/contracts/manuscript'
import { cardLines, noStateWords, relationRows, voiceRows, whereWords } from './entryView'

const happened = (text: string, where = 'Book 1, Ch 1, Sc 1', here = false): StateLine => ({ kind: 'happened', text, where, here })
const field = (text: string): StateLine => ({ kind: 'field', text, where: '', here: false })

describe('the state a small card shows', () => {
  it('shows everything when it fits', () => {
    const s = [happened('Lost her hand'), field('Hair: short')]
    expect(cardLines(s)).toBe(s)
  })

  it('keeps what is true now, and the newest thing that happened', () => {
    const s = [happened('One'), happened('Two'), happened('Three'), field('Hair: short'), field('Marks: scar'), field('Age: 19')]
    expect(cardLines(s).map((l) => l.text)).toEqual(['Three', 'Hair: short', 'Marks: scar'])
    const four = [happened('One'), happened('Two'), happened('Three'), happened('Four')]
    expect(cardLines(four).map((l) => l.text)).toEqual(['Two', 'Three', 'Four'])
    expect(cardLines([field('A: 1'), field('B: 2'), field('C: 3'), field('D: 4')]).map((l) => l.text)).toEqual(['A: 1', 'B: 2', 'C: 3'])
  })

  it('says where each happened, and when it is this scene', () => {
    expect(whereWords(happened('x', 'Book 1, Ch 2, Sc 1'))).toBe('Book 1, Ch 2, Sc 1')
    expect(whereWords(happened('x', 'Book 1, Ch 2, Sc 1', true))).toBe('in this scene')
  })

  it('says why there is nothing to show', () => {
    expect(noStateWords({ absent: 'Not in the story yet at this point', kind: 'character' })).toBe('Not in the story yet at this point')
    expect(noStateWords({ absent: null, kind: 'character' })).toBe('Nothing has happened to them yet.')
    expect(noStateWords({ absent: null, kind: 'place' })).toBe('Nothing has changed yet.')
  })
})

describe('voice notes', () => {
  it('lists what is written, with a couple of sample lines', () => {
    expect(voiceRows(null)).toEqual({ rows: [], samples: [] })
    expect(voiceRows({ speech: 'Short and plain', tics: '', neverSays: 'Sorry', sampleLines: ['One.', 'Two.', 'Three.'] })).toEqual({
      rows: [
        { label: 'How they speak', text: 'Short and plain' },
        { label: 'Never says', text: 'Sorry' }
      ],
      samples: ['One.', 'Two.']
    })
  })
})

describe('relationships beside the page', () => {
  const names: Record<string, string> = { m: 'Mara', t: 'Tobin' }
  const nameOf = (id: string): string | null => names[id] ?? null

  it('reads each from this entry’s side', () => {
    const rows = relationRows(
      [
        { aId: 'm', bId: 't', type: 'friend', aFeels: 'trusts him', bFeels: 'would die for her', where: '' },
        { aId: 't', bId: 'm', type: 'enemy', aFeels: 'betrayed', bFeels: '', where: 'Book 2, Ch 2, Sc 2' },
        { aId: 'm', bId: 'gone', type: 'rival', aFeels: '', bFeels: '', where: '' },
        { aId: 't', bId: 'x', type: 'rival', aFeels: '', bFeels: '', where: '' }
      ],
      { id: 'm', name: 'Mara' },
      nameOf
    )
    expect(rows).toEqual([
      { otherId: 't', text: 'Friend of Tobin', detail: 'Mara feels: trusts him · Tobin feels: would die for her', where: '' },
      { otherId: 't', text: 'Tobin: enemy of Mara', detail: 'Tobin feels: betrayed', where: 'Book 2, Ch 2, Sc 2' }
    ])
  })
})
