import { describe, expect, it } from 'vitest'
import { beatsOnPage, beatStand, cardBeatsOf } from './beats'

describe('beats already on the page', () => {
  const beats = ['Wren and Ash stop for the night at an inn on the coast road', 'They talk about what comes next', 'Ash goes out to the stable']
  it('counts the beats whose own words are on the page, in order', () => {
    expect(beatsOnPage(beats, '')).toBe(0)
    expect(beatsOnPage(beats, null)).toBe(0)
    expect(beatsOnPage(beats, 'Wren and Ash stopped for the night at the inn on the coast road.')).toBe(1)
    // A later beat on the page means the ones before it are done too.
    expect(beatsOnPage(beats, 'Wren sat by the fire. Ash went out to the stable to see to the horses.')).toBe(3)
    expect(beatsOnPage(beats, 'They talked a while about what would come next.')).toBe(2)
  })

  it('reads curly and straight quotes alike, and skips beats of one word', () => {
    expect(beatsOnPage(['Wren’s lamp goes dark'], "Wren's lamp went dark at last.")).toBe(1)
    expect(beatsOnPage(['Storm', 'The ferry comes in early'], 'The ferry came in early, against the wind.')).toBe(2)
  })
})

describe('where the scene stands against its beats (the next-beat chip)', () => {
  const beats = ['Wren climbs the 112 steps', '  ', 'She trims the wick herself', 'The night ferry comes in early']
  it('names the next beat, then offers Mark done once all are written, then says the scene is done', () => {
    expect(cardBeatsOf(beats)).toHaveLength(3)
    expect(beatStand(beats, 0, false)).toEqual({ kind: 'next', index: 0, beat: 'Wren climbs the 112 steps', of: 3 })
    expect(beatStand(beats, 2, false)).toEqual({ kind: 'next', index: 2, beat: 'The night ferry comes in early', of: 3 })
    expect(beatStand(beats, 3, false)).toEqual({ kind: 'all', of: 3 })
    expect(beatStand(beats, 1, true)).toEqual({ kind: 'done' })
  })
  it('shows nothing for a card with no beats', () => {
    expect(beatStand([], 0, false)).toEqual({ kind: 'none' })
    expect(beatStand([' '], 0, false)).toEqual({ kind: 'none' })
    expect(beatStand([], 0, true)).toEqual({ kind: 'none' })
  })
})
