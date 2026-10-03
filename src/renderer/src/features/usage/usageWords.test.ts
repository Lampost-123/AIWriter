import { describe, expect, it } from 'vitest'
import { callsAndTokens, costNotes, labelledBars, shareOf, tokenWords } from './usageWords'

describe('the usage page’s words', () => {
  it('says tokens briefly', () => {
    expect(tokenWords(1)).toBe('1 token')
    expect(tokenWords(950)).toBe('950 tokens')
    expect(tokenWords(12_340)).toBe('12.3k tokens')
    expect(tokenWords(250_000)).toBe('250k tokens')
    expect(tokenWords(2_400_000)).toBe('2.4M tokens')
    expect(callsAndTokens({ calls: 1, promptTokens: 600, completionTokens: 400 })).toBe('1 call · 1k tokens')
  })

  it('says honestly which calls had no price, and which are estimates', () => {
    expect(costNotes({ unpriced: 0, estimated: 0 })).toEqual([])
    expect(costNotes({ unpriced: 3, estimated: 0 })).toEqual(['3 calls had no price from the provider, so they aren’t in the totals.'])
    expect(costNotes({ unpriced: 1, estimated: 2 })).toHaveLength(2)
  })

  it('fills the limit bar up to the limit and no further', () => {
    expect(shareOf(5, 20)).toBe(0.25)
    expect(shareOf(30, 20)).toBe(1)
    expect(shareOf(5, null)).toBe(0)
  })

  it('labels the chart sparingly: the first day, about every week, and the last', () => {
    expect([...labelledBars(31)]).toEqual([0, 7, 14, 21, 30])
    expect([...labelledBars(30)]).toEqual([0, 7, 14, 21, 29])
    expect([...labelledBars(28)]).toEqual([0, 7, 14, 21, 27])
    expect([...labelledBars(4)]).toEqual([0, 1, 2, 3])
    expect(labelledBars(0).size).toBe(0)
  })
})
