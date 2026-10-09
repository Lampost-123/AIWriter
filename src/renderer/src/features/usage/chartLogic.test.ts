import { describe, expect, it } from 'vitest'
import type { UsageBar } from '@shared/contracts/usage'
import { MODEL_INKS, OTHER_INK, modelColours, modelName, niceTicks, percentWords, shares, stackOf } from './chartLogic'

describe('the usage charts', () => {
  it('gives each model a colour by spending, and the seventh and later share Other', () => {
    const models = Array.from({ length: 8 }, (_, i) => ({ modelId: `maker/m${i}`, provider: 'OpenRouter' }))
    const c = modelColours(models)
    expect(c.get('maker/m0\tOpenRouter')).toBe(MODEL_INKS[0])
    expect(c.get('maker/m5\tOpenRouter')).toBe(MODEL_INKS[5])
    expect(c.get('maker/m6\tOpenRouter')).toBe(OTHER_INK)
  })

  it('names a model by the part after its maker', () => {
    expect(modelName('anthropic/claude-sonnet-4.5')).toEqual({ name: 'claude-sonnet-4.5', maker: 'anthropic' })
    expect(modelName('fake-writer')).toEqual({ name: 'fake-writer', maker: null })
    expect(modelName('')).toEqual({ name: 'Unknown model', maker: null })
  })

  it('puts round numbers on the scale, reaching the tallest bar', () => {
    expect(niceTicks(0)).toEqual([0])
    expect(niceTicks(0.36)).toEqual([0, 0.1, 0.2, 0.3, 0.4])
    expect(niceTicks(7)).toEqual([0, 2, 4, 6, 8])
    expect(niceTicks(1_234_000)).toEqual([0, 500_000, 1_000_000, 1_500_000])
    for (const max of [0.0042, 3.3, 19, 250, 9999]) {
      const t = niceTicks(max)
      expect(t[t.length - 1]).toBeGreaterThanOrEqual(max)
      expect(t.length).toBeLessThanOrEqual(6)
    }
  })

  it('stacks a bar by model, the rest as Other, and an older bar as one piece', () => {
    const c = modelColours([{ modelId: 'a', provider: 'P' }])
    const bar: UsageBar = {
      key: '2026-10-01',
      label: '1 Oct',
      ahead: false,
      cost: 3,
      calls: 2,
      tokens: 30,
      models: [
        { modelId: 'a', provider: 'P', cost: 2, tokens: 10 },
        { modelId: 'b', provider: 'P', cost: 1, tokens: 20 }
      ]
    }
    expect(stackOf(bar, c, 'cost')).toEqual([
      { key: 'a\tP', ink: MODEL_INKS[0], value: 2 },
      { key: 'other', ink: OTHER_INK, value: 1 }
    ])
    expect(stackOf({ ...bar, models: undefined }, c, 'tokens')).toEqual([{ key: 'all', ink: MODEL_INKS[0], value: 30 }])
    expect(stackOf({ ...bar, cost: 0, models: [] }, c, 'cost')).toEqual([])
  })

  it('splits a donut in shares that add up to one, a sliver still showing', () => {
    const s = shares([100, 0.01, 0])
    expect(s[1]).toBeGreaterThan(0.005)
    expect(s[2]).toBe(0)
    expect(s.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10)
    expect(shares([0, 0])).toEqual([0, 0])
    expect(percentWords(0.004)).toBe('<1%')
    expect(percentWords(0.256)).toBe('26%')
    expect(percentWords(0)).toBe('0%')
  })
})
