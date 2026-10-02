import { describe, expect, it } from 'vitest'
import { DICTATION_SAMPLE_RATE } from '@shared/contracts/dictation'
import { hear, KEEP_SECONDS, PRE_ROLL_SECONDS, startBack, trimHeard, type Heard } from './heard'
import { takeSamples } from './wav'

const RATE = DICTATION_SAMPLE_RATE
/** The worklet's batches: 1024 samples, 64 ms. */
const BATCH = 1024

/** A batch whose samples are numbered by when they were heard, so a test can tell which moment it has. */
const batch = (first: number): Float32Array => Float32Array.from({ length: BATCH }, (_, i) => first + i)

/** The microphone hearing for `seconds` more, letting go as it does of what nobody needs. */
function listen(h: Heard, seconds: number, starts: number[] = []): void {
  const until = h.total + seconds * RATE
  while (h.total < until) {
    hear(h, batch(h.total))
    trimHeard(h, RATE * KEEP_SECONDS, starts)
  }
}

describe('what the microphone holds while dictation is on', () => {
  it('holds the last second, and lets go of the rest', () => {
    const h: Heard = { chunks: [], origin: 0, total: 0 }
    listen(h, 3)
    expect(h.total - h.origin).toBeGreaterThanOrEqual(RATE * KEEP_SECONDS)
    expect(h.total - h.origin).toBeLessThan(RATE * KEEP_SECONDS + BATCH)
    expect(h.chunks[0][0]).toBe(h.origin)
  })

  it('starts a recording from the key going down 0.45 s back, so the words said as it goes down are kept', () => {
    expect(PRE_ROLL_SECONDS).toBe(0.45)
    expect(PRE_ROLL_SECONDS).toBeLessThanOrEqual(KEEP_SECONDS)
    const h: Heard = { chunks: [], origin: 0, total: 0 }
    listen(h, 2)
    const keyDown = h.total
    const from = startBack(h, RATE * PRE_ROLL_SECONDS)
    expect(from).toBe(keyDown - 0.45 * RATE)
    // Held for three seconds: more than is held otherwise, and none of it is let go.
    listen(h, 3, [from])
    const got = takeSamples(h.chunks, h.origin, from, h.total)
    expect(got.length).toBe(h.total - from)
    // Its first sound is the one heard 0.45 s before the key went down, and nothing is missing after it.
    expect(got[0]).toBe(keyDown - 0.45 * RATE)
    expect(got[0.45 * RATE]).toBe(keyDown)
    expect(got[got.length - 1]).toBe(h.total - 1)
  })

  it('goes back only as far as is held', () => {
    const h: Heard = { chunks: [], origin: 0, total: 0 }
    listen(h, 0.2)
    // Just opened: there is less than 0.45 s to go back to.
    expect(startBack(h, RATE * PRE_ROLL_SECONDS)).toBe(0)
    listen(h, 3)
    expect(startBack(h, RATE * 5)).toBe(h.origin)
    expect(startBack(h, 0)).toBe(h.total)
  })
})
