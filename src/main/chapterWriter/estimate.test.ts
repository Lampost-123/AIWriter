import { describe, expect, it } from 'vitest'
import { chapterEstimate, type Price } from './estimate'

const cheap: Price = { prompt: 0.3 / 1e6, completion: 1.2 / 1e6 }
const free: Price = { prompt: 0, completion: 0 }
const unknown: Price = { prompt: null, completion: null }

describe('how long writing a chapter takes, and what it costs', () => {
  it('counts each scene’s draft, read, plan, check and fix, and the critic once', () => {
    const four = chapterEstimate({ scenes: [{ words: 1500 }, { words: 1500 }, { words: 1500 }, { words: 1500 }], writer: cheap, memory: cheap, check: cheap, planFirst: true, critic: true })
    expect(four.minutes).toBeGreaterThanOrEqual(5)
    expect(four.minutes).toBeLessThanOrEqual(12)
    expect(four.cost).toBeGreaterThan(0.02)
    expect(four.cost).toBeLessThan(0.2)
    expect(four.free).toBe(false)
    // Without the plan before writing or the critic: quicker and cheaper.
    const lean = chapterEstimate({ scenes: [{ words: 1500 }, { words: 1500 }, { words: 1500 }, { words: 1500 }], writer: cheap, memory: cheap, check: cheap, planFirst: false, critic: false })
    expect(lean.minutes).toBeLessThan(four.minutes)
    expect(lean.cost!).toBeLessThan(four.cost!)
    // Longer scenes take longer.
    expect(chapterEstimate({ scenes: [{ words: 4000 }], writer: cheap, memory: cheap, check: cheap, planFirst: true, critic: true }).minutes).toBeGreaterThan(
      chapterEstimate({ scenes: [{ words: 800 }], writer: cheap, memory: cheap, check: cheap, planFirst: true, critic: true }).minutes
    )
  })

  it('says the cost isn’t known when a model has no price, and free when every model is free; never under a minute', () => {
    expect(chapterEstimate({ scenes: [{ words: 1000 }], writer: cheap, memory: unknown, check: cheap, planFirst: true, critic: true }).cost).toBeNull()
    expect(chapterEstimate({ scenes: [{ words: 1000 }], writer: free, memory: free, check: free, planFirst: true, critic: true })).toMatchObject({ cost: 0, free: true })
    expect(chapterEstimate({ scenes: [{ words: 100 }], writer: cheap, memory: cheap, check: cheap, planFirst: false, critic: false }).minutes).toBe(1)
  })
})
