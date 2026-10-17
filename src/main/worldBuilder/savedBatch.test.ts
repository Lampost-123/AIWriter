import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { savedBatch } from './savedBatch'

describe('what a build saved, told in batches (2026-10-17)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('tells the window at most once every half second while the build saves, and the rest when it ends', () => {
    const told: string[][] = []
    const batch = savedBatch((ids) => told.push(ids))
    // Fifty saves over two seconds: Mara, Tobin and the rest of an invented cast.
    for (let i = 0; i < 50; i++) {
      batch.add([`entry-${i}`, 'mara'])
      vi.advanceTimersByTime(40)
    }
    expect(told.length).toBeGreaterThanOrEqual(3)
    expect(told.length).toBeLessThanOrEqual(5)
    const rest = batch.flush()
    const all = new Set([...told.flat(), ...rest])
    expect(all.size).toBe(51)
    // Nothing more once the build has ended.
    vi.advanceTimersByTime(2000)
    expect(told.flat().length + rest.length).toBeLessThan(60)
  })

  it('tells nothing after the world closes', () => {
    const told: string[][] = []
    const batch = savedBatch((ids) => told.push(ids))
    batch.add(['mara'])
    batch.drop()
    vi.advanceTimersByTime(1000)
    expect(told).toEqual([])
    expect(batch.flush()).toEqual([])
  })
})
