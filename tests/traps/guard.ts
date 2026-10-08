// The provider guard (2026-10-08): a paid run that can't go on stops at once, with a plain message, instead of
// every later step failing.
//
// - HTTP 402 (DeepSeek's "Insufficient Balance"; another provider's out-of-credit), or any error naming an
//   insufficient balance, credit or funds: the run stops (the budget's `hit`, so it stops cleanly at its next step and
//   writes what it has), and the harness logs "PROVIDER STOP: ...".
// - HTTP 401 (the key refused): the same.
// - HTTP 429 (rate_limit_exceeded): retried here with a backoff a few times (Retry-After when given), before the app's
//   own retries (ai/retry.ts) see it; once it has lasted through that RATE_LIMIT_ROUNDS times running, the run stops
//   the same way.
//
// Only real providers' calls go through it (never the fake provider's). The key is never read here, and
// nothing of the request is logged: only the status and the provider's own error message.

/** Waits before each retry of a 429 here (the app retries after that with its own, shorter waits). */
export const RATE_LIMIT_WAITS_MS = [5_000, 15_000, 30_000]
/** 429s that outlast the waits above, running, before the run stops. */
export const RATE_LIMIT_ROUNDS = 3
/** Never wait longer than this for one retry, whatever Retry-After says. */
const MAX_WAIT_MS = 60_000

/** The provider's own error message from an error body (its JSON error's message, else the start of the text). */
export function errorMessage(body: string): string {
  try {
    const j = JSON.parse(body) as { error?: { message?: unknown } | string; message?: unknown }
    const m = typeof j.error === 'string' ? j.error : typeof j.error?.message === 'string' ? j.error.message : typeof j.message === 'string' ? j.message : ''
    if (m) return m.slice(0, 200)
  } catch {
    /* not JSON */
  }
  return body.replace(/\s+/g, ' ').trim().slice(0, 200)
}

const BALANCE = /insufficient[ _-]?(?:balance|credits?|funds|quota)|out of credits?|balance is (?:too low|insufficient)/i

/**
 * Why a run must stop at this reply, or null: a 402 or a message naming an insufficient balance (out of money), or a
 * 401 (the key refused). The words start "PROVIDER STOP", easy to look for in a log.
 */
export function stopReason(status: number, body: string, provider: string): string | null {
  const msg = errorMessage(body)
  const said = msg ? `: "${msg}"` : ''
  if (status === 402 || (status >= 400 && status < 500 && BALANCE.test(msg)))
    return `PROVIDER STOP: ${provider} said HTTP ${status}${said} (out of balance). Top up the account, or run on another provider (--provider deepseek|openrouter).`
  if (status === 401) return `PROVIDER STOP: ${provider} said HTTP 401${said} (the API key was refused). Check the key's variable, or run on another provider.`
  return null
}

/** How long to wait before retry `n` (1-based) of a 429: Retry-After when given (capped), else RATE_LIMIT_WAITS_MS. */
export function rateLimitWait(n: number, retryAfter: string | null, waits = RATE_LIMIT_WAITS_MS): number {
  const base = waits[Math.min(n, waits.length) - 1] ?? 0
  const v = retryAfter?.trim()
  if (v && /^\d+(\.\d+)?$/.test(v)) return Math.min(MAX_WAIT_MS, Math.max(base, Math.round(parseFloat(v) * 1000)))
  return base
}

export interface GuardOptions {
  /** The provider's name, for the message ("DeepSeek", "OpenRouter"). */
  provider: string
  /** Called once, with why, when the run must stop. */
  stop: (why: string) => void
  log: (line: string) => void
  /** Waits before each retry of a 429 (tests make these short). */
  waits?: number[]
  rounds?: number
  sleep?: (ms: number) => Promise<void>
}

/** fetch, with the guard on every chat request. Other requests (the model list) pass as they are. */
export function guardFetch(next: typeof fetch, o: GuardOptions): typeof fetch {
  const waits = o.waits ?? RATE_LIMIT_WAITS_MS
  const rounds = o.rounds ?? RATE_LIMIT_ROUNDS
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  let stopped = false
  let limited = 0
  const halt = (why: string): void => {
    if (stopped) return
    stopped = true
    o.log(why)
    o.stop(why)
  }
  return (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if ((init?.method ?? 'GET').toUpperCase() !== 'POST' || !/chat\/completions\b/.test(url)) return next(input, init)
    let res = await next(input, init)
    for (let n = 1; res.status === 429 && n <= waits.length && !init?.signal?.aborted; n++) {
      const wait = rateLimitWait(n, res.headers.get('retry-after'), waits)
      o.log(`  ${o.provider}: HTTP 429 (rate limited); retry ${n} of ${waits.length} in ${Math.round(wait / 1000)}s`)
      // Let the refused reply go (not waited for: a teed body's cancel waits on its other branch).
      void res.body?.cancel().catch(() => {})
      await sleep(wait)
      if (init?.signal?.aborted) break
      res = await next(input, init)
    }
    if (res.status === 429) {
      limited++
      if (limited >= rounds) {
        const body = await res.clone().text().catch(() => '')
        const msg = errorMessage(body)
        halt(`PROVIDER STOP: ${o.provider} kept saying HTTP 429${msg ? `: "${msg}"` : ''} (rate limited) through ${rounds} rounds of retries. Wait, ask for a higher limit, or run on another provider.`)
      }
      return res
    }
    if (res.ok) {
      limited = 0
      return res
    }
    if (res.status >= 400 && res.status < 500) {
      const why = stopReason(res.status, await res.clone().text().catch(() => ''), o.provider)
      if (why) halt(why)
    }
    return res
  }) as typeof fetch
}
