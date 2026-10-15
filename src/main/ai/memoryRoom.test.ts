import { describe, expect, it } from 'vitest'
import { MOST_SCALE, memoryScale, passagesFound, passagesShown } from './memoryRoom'

describe('how much memory the writer is given', () => {
  it('is the smallest for a 16,000-token model or one whose reading limit isn’t known, and grows to MOST_SCALE', () => {
    expect(memoryScale(null)).toBe(1)
    expect(memoryScale(undefined)).toBe(1)
    expect(memoryScale(0)).toBe(1)
    expect(memoryScale(8_000)).toBe(1)
    expect(memoryScale(16_000)).toBe(1)
    expect(memoryScale(32_000)).toBeCloseTo(1.92)
    expect(memoryScale(48_000)).toBeCloseTo(2.88)
    expect(memoryScale(64_000)).toBe(MOST_SCALE)
    expect(memoryScale(1_000_000)).toBe(MOST_SCALE)
  })

  it('offers and shows more earlier passages for a model that reads more, never fewer than before', () => {
    expect([passagesFound(1), passagesShown(1)]).toEqual([6, 5])
    expect([passagesFound(MOST_SCALE), passagesShown(MOST_SCALE)]).toEqual([12, 10])
    expect(passagesShown(0.5)).toBe(5)
  })
})
