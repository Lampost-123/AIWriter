import { describe, expect, it } from 'vitest'
import { MOST_FASTER, MOST_SLOWER, PaceKeeper, spokenWords } from './evenPace'

describe('the narrator at one even pace', () => {
  it('counts the spoken words, not sound tags', () => {
    expect(spokenWords('(sigh) She had *never* been so sure. [pause] — Yes.')).toBe(7)
  })

  it('plays a hurried clip slower and a dragging one faster, toward the usual pace', () => {
    const k = new PaceKeeper()
    // Its usual pace: about 3 words a second.
    expect(k.factor(30, 10)).toBe(1)
    expect(k.factor(30, 10)).toBe(1)
    expect(k.factor(30, 10)).toBe(1)
    // Rushed (3.6 a second): played slower. Dragged (2.5 a second): played faster.
    expect(k.factor(36, 10)).toBeCloseTo(3 / 3.6)
    expect(k.factor(25, 10)).toBeCloseTo(3 / 2.5)
  })

  it('changes a clip only so far, and leaves a short one alone', () => {
    const k = new PaceKeeper()
    for (let i = 0; i < 5; i++) k.factor(30, 10)
    expect(k.factor(60, 10)).toBe(MOST_SLOWER)
    expect(k.factor(10, 10)).toBe(MOST_FASTER)
    expect(k.factor(4, 10)).toBe(1)
    expect(k.factor(30, NaN)).toBe(1)
  })
})
