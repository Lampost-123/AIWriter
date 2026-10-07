// A hard token budget for a trap run or for writing the story (Adam pays for every call). Every model call the app or
// the harness makes goes through fetch, so the budget wraps fetch: before each chat request it adds up what has been
// used so far (every call is a generation record in the world, plus the harness's own judge calls) and what this
// request will send, and refuses it once the budget would be passed. A refused call fails like any provider error,
// and the run stops cleanly at its next step (`hit`), writing what it has.

export interface TokenCount {
  in: number
  out: number
}

export class Budget {
  /** Why it refused a call (null until it does). */
  hit: string | null = null
  constructor(
    readonly maxIn: number,
    readonly maxOut: number,
    /** Tokens used so far. */
    private readonly used: () => TokenCount
  ) {}

  usedNow(): TokenCount {
    try {
      return this.used()
    } catch {
      return { in: 0, out: 0 }
    }
  }

  /** Whether a request sending about `promptTokens` may go. */
  allows(promptTokens: number): boolean {
    if (this.hit) return false
    const u = this.usedNow()
    if (u.in + promptTokens > this.maxIn) {
      this.hit = `the token budget for input (${this.maxIn.toLocaleString('en-GB')}) was reached: ${u.in.toLocaleString('en-GB')} used, and the next call would send about ${promptTokens.toLocaleString('en-GB')} more.`
      return false
    }
    if (u.out >= this.maxOut) {
      this.hit = `the token budget for output (${this.maxOut.toLocaleString('en-GB')}) was reached: ${u.out.toLocaleString('en-GB')} used.`
      return false
    }
    return true
  }

  /** fetch, with every chat request checked against the budget first. */
  wrap(next: typeof fetch): typeof fetch {
    return (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const body = typeof init?.body === 'string' ? init.body : ''
      if ((init?.method ?? 'GET').toUpperCase() === 'POST' && /chat\/completions\b/.test(url) && !this.allows(estimateTokens(body))) {
        return new Response(JSON.stringify({ error: { code: 402, message: `The trap run stopped: ${this.hit}` } }), {
          status: 402,
          headers: { 'Content-Type': 'application/json' }
        })
      }
      return next(input, init)
    }) as typeof fetch
  }
}

/** About how many tokens a request sends: its text at about 4 characters a token. */
export const estimateTokens = (body: string): number => Math.ceil(body.length / 4)

/** The defaults: well under $1 a command at DeepSeek Flash's prices (about $0.28 in, $0.42 out per million). */
export const DEFAULT_BUDGET = { in: 2_000_000, out: 500_000 }
