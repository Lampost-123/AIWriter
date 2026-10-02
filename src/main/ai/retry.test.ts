import { describe, expect, it } from 'vitest'
import { isRetryableStatus, MAX_RETRIES, MAX_RETRY_WAIT_MS, parseRetryAfter, RETRY_DELAYS_MS, retryDelay, shouldRetry } from './retry'

describe('retry policy', () => {
  it('retries rate limits and server errors, not request or key problems', () => {
    for (const s of [408, 429, 500, 502, 503, 504, 529]) expect(isRetryableStatus(s)).toBe(true)
    for (const s of [400, 401, 402, 403, 404, 413, 422, 501]) expect(isRetryableStatus(s)).toBe(false)
  })

  it('waits longer each time', () => {
    const waits = [1, 2, 3, 4].map((a) => retryDelay(a, null))
    expect(waits).toEqual(RETRY_DELAYS_MS)
    for (let i = 1; i < waits.length; i++) expect(waits[i]).toBeGreaterThan(waits[i - 1])
    expect(retryDelay(9, null)).toBe(RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1])
  })

  it('respects Retry-After in seconds or as a date, within limits', () => {
    expect(parseRetryAfter('3')).toBe(3000)
    expect(parseRetryAfter('0.5')).toBe(500)
    expect(parseRetryAfter('9999')).toBe(MAX_RETRY_WAIT_MS)
    const now = Date.parse('2026-10-01T12:00:00Z')
    expect(parseRetryAfter('Thu, 01 Oct 2026 12:00:10 GMT', now)).toBe(10_000)
    expect(parseRetryAfter('Thu, 01 Oct 2026 11:00:00 GMT', now)).toBe(0)
    expect(parseRetryAfter('soon')).toBeNull()
    expect(parseRetryAfter(null)).toBeNull()
    expect(retryDelay(1, 7000)).toBe(7000)
    // A "come back now" still waits a little.
    expect(retryDelay(1, 0)).toBe(500)
  })

  it('only retries before any text has arrived, and at most four times', () => {
    expect(shouldRetry({ kind: 'status', status: 429 }, { textReceived: false, retriesDone: 0 })).toBe(true)
    expect(shouldRetry({ kind: 'network' }, { textReceived: false, retriesDone: 3 })).toBe(true)
    expect(shouldRetry({ kind: 'network' }, { textReceived: false, retriesDone: MAX_RETRIES })).toBe(false)
    expect(shouldRetry({ kind: 'status', status: 503 }, { textReceived: true, retriesDone: 0 })).toBe(false)
    expect(shouldRetry({ kind: 'status', status: 402 }, { textReceived: false, retriesDone: 0 })).toBe(false)
    expect(shouldRetry({ kind: 'timeout' }, { textReceived: false, retriesDone: 0 })).toBe(true)
  })
})
