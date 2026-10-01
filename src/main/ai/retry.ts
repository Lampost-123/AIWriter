// When to retry an AI request, and how long to wait. Pure.
// Rate limits, server errors and network failures are retried automatically
// (up to 4 times, waiting longer each time) but only before any text has
// arrived: once text is in the scene, a failure keeps it and stops.

export const MAX_RETRIES = 4
/** Waits before retry 1, 2, 3 and 4. */
export const RETRY_DELAYS_MS = [1500, 3000, 6000, 12000]
/** Never wait longer than this, whatever the server asks. */
export const MAX_RETRY_WAIT_MS = 60_000

export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599 && status !== 501 && status !== 505)
}

/** Reads a Retry-After header (seconds, or an HTTP date) as milliseconds, or null. */
export function parseRetryAfter(value: string | null | undefined, nowMs = Date.now()): number | null {
  if (!value) return null
  const v = value.trim()
  if (/^\d+(\.\d+)?$/.test(v)) return Math.min(MAX_RETRY_WAIT_MS, Math.round(parseFloat(v) * 1000))
  const at = Date.parse(v)
  if (Number.isNaN(at)) return null
  return Math.min(MAX_RETRY_WAIT_MS, Math.max(0, at - nowMs))
}

/** How long to wait before retry number `attempt` (1-based). */
export function retryDelay(attempt: number, retryAfterMs: number | null, delays: number[] = RETRY_DELAYS_MS): number {
  const base = delays[Math.min(Math.max(attempt, 1), delays.length) - 1] ?? 0
  if (retryAfterMs == null) return base
  // The server said when to come back: do that, but never hammer it.
  return Math.min(MAX_RETRY_WAIT_MS, Math.max(retryAfterMs, Math.min(base, 500)))
}

export type RetryCause = { kind: 'status'; status: number } | { kind: 'network' } | { kind: 'timeout' }

export function shouldRetry(cause: RetryCause, opts: { textReceived: boolean; retriesDone: number; maxRetries?: number }): boolean {
  if (opts.textReceived) return false
  if (opts.retriesDone >= (opts.maxRetries ?? MAX_RETRIES)) return false
  if (cause.kind === 'status') return isRetryableStatus(cause.status)
  return true
}
