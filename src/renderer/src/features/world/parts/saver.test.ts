import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Saver, type SaveStatus } from './saver'

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('Saver', () => {
  it('waits for a quiet pause and writes only the latest value', async () => {
    const save = vi.fn(async (_v: string) => {})
    const s = new Saver<string>(save, { delay: 500 })
    s.schedule('a')
    await vi.advanceTimersByTimeAsync(300)
    s.schedule('ab')
    await vi.advanceTimersByTimeAsync(300)
    expect(save).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(250)
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith('ab')
  })

  it('writes straight away on flush, and flushing twice writes once', async () => {
    const save = vi.fn(async (_v: number) => {})
    const s = new Saver<number>(save)
    s.schedule(1)
    await s.flush()
    await s.flush()
    expect(save).toHaveBeenCalledTimes(1)
    expect(s.dirty).toBe(false)
    await vi.advanceTimersByTimeAsync(1000)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('never overlaps writes and keeps their order', async () => {
    const order: string[] = []
    let release: () => void = () => {}
    const save = (v: string): Promise<void> =>
      new Promise<void>((res) => {
        order.push(`start ${v}`)
        release = () => {
          order.push(`end ${v}`)
          res()
        }
      })
    const s = new Saver<string>(save)
    s.schedule('one')
    const first = s.flush()
    s.schedule('two')
    const second = s.flush()
    await vi.advanceTimersByTimeAsync(0)
    expect(order).toEqual(['start one'])
    release()
    await first
    await vi.advanceTimersByTimeAsync(0)
    expect(order).toEqual(['start one', 'end one', 'start two'])
    release()
    await second
    expect(order).toEqual(['start one', 'end one', 'start two', 'end two'])
  })

  it('reports saving, then saved', async () => {
    const statuses: SaveStatus[] = []
    const s = new Saver<number>(async () => {}, { onStatus: (st) => statuses.push(st) })
    s.schedule(1)
    await s.flush()
    expect(statuses).toEqual(['saving', 'saved'])
  })

  it('retries a failed write, then gives up once', async () => {
    const save = vi.fn(async (_v: number) => {
      throw new Error('Disk is full.')
    })
    const giveUp = vi.fn()
    const s = new Saver<number>(save, { retryDelays: [100, 200], onGiveUp: giveUp })
    s.schedule(1)
    await s.flush()
    expect(s.status).toBe('error')
    expect(s.dirty).toBe(true)
    await vi.advanceTimersByTimeAsync(100)
    await vi.advanceTimersByTimeAsync(200)
    expect(save).toHaveBeenCalledTimes(3)
    expect(giveUp).toHaveBeenCalledTimes(1)
    expect(giveUp).toHaveBeenCalledWith('Disk is full.')
    await s.flush()
    expect(giveUp).toHaveBeenCalledTimes(1)
  })

  it('recovers when a retry succeeds', async () => {
    let fail = true
    const save = vi.fn(async (_v: number) => {
      if (fail) throw new Error('busy')
    })
    const s = new Saver<number>(save, { retryDelays: [100] })
    s.schedule(7)
    await s.flush()
    fail = false
    await vi.advanceTimersByTimeAsync(100)
    expect(save).toHaveBeenLastCalledWith(7)
    expect(s.status).toBe('saved')
    expect(s.dirty).toBe(false)
  })

  it('a newer change replaces a failed one instead of being overwritten by it', async () => {
    const seen: number[] = []
    let fail = true
    const s = new Saver<number>(
      async (v) => {
        seen.push(v)
        if (fail) throw new Error('busy')
      },
      { retryDelays: [100] }
    )
    s.schedule(1)
    const p = s.flush()
    s.schedule(2)
    await p
    fail = false
    await s.flush()
    expect(seen).toEqual([1, 2])
    expect(s.dirty).toBe(false)
  })

  it('cancel drops the pending change', async () => {
    const save = vi.fn(async (_v: number) => {})
    const s = new Saver<number>(save)
    s.schedule(1)
    s.cancel()
    await vi.advanceTimersByTimeAsync(1000)
    await s.flush()
    expect(save).not.toHaveBeenCalled()
  })
})
