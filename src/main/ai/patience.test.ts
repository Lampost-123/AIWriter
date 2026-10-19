import { describe, expect, it } from 'vitest'
import { BACKGROUND_FIRST_REPLY_MS, BACKGROUND_TIMEOUT_RETRIES, backgroundPatience } from './patience'
import { MAX_RETRIES } from './retry'

describe('backgroundPatience', () => {
  it('gives up on a silent provider after half a minute, asked again once: about a minute where it was over ten', () => {
    expect(backgroundPatience({ baseUrl: 'https://api.deepseek.com/v1' })).toEqual({ headersTimeoutMs: 30_000, timeoutRetries: 1 })
    expect(backgroundPatience({ baseUrl: 'https://openrouter.ai/api/v1' })).toEqual({ headersTimeoutMs: 30_000, timeoutRetries: 1 })
    // streamChat's own: two minutes for a first answer, asked again four times.
    const before = 120_000 * (1 + MAX_RETRIES)
    const now = BACKGROUND_FIRST_REPLY_MS * (1 + BACKGROUND_TIMEOUT_RETRIES)
    expect(before).toBeGreaterThan(9 * 60_000)
    expect(now).toBeLessThanOrEqual(60_000)
  })

  it('lets a program on this computer load its model for as long as ever, but still asks it again only once', () => {
    expect(backgroundPatience({ baseUrl: 'http://127.0.0.1:1234/v1' })).toEqual({ timeoutRetries: 1 })
    expect(backgroundPatience({ baseUrl: 'http://localhost:11434/v1' })).toEqual({ timeoutRetries: 1 })
  })
})
