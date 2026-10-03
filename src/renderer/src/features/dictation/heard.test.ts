import { describe, expect, it } from 'vitest'
import { DICTATION_SAMPLE_RATE } from '@shared/contracts/dictation'
import { endAfter, hear, KEEP_SECONDS, PRE_ROLL_SECONDS, startBack, trimHeard, type Heard } from './heard'
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
    const h: Heard = { chunks: [], origin: 0, total: 0, takenUntil: 0 }
    listen(h, 3)
    expect(h.total - h.origin).toBeGreaterThanOrEqual(RATE * KEEP_SECONDS)
    expect(h.total - h.origin).toBeLessThan(RATE * KEEP_SECONDS + BATCH)
    expect(h.chunks[0][0]).toBe(h.origin)
  })

  it('starts a recording from the key going down 0.45 s back, so the words said as it goes down are kept', () => {
    expect(PRE_ROLL_SECONDS).toBe(0.45)
    expect(PRE_ROLL_SECONDS).toBeLessThanOrEqual(KEEP_SECONDS)
    const h: Heard = { chunks: [], origin: 0, total: 0, takenUntil: 0 }
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
    const h: Heard = { chunks: [], origin: 0, total: 0, takenUntil: 0 }
    listen(h, 0.2)
    // Just opened: there is less than 0.45 s to go back to.
    expect(startBack(h, RATE * PRE_ROLL_SECONDS)).toBe(0)
    listen(h, 3)
    expect(startBack(h, RATE * 5)).toBe(h.origin)
    expect(startBack(h, 0)).toBe(h.total)
  })

  it('starts a recording where the one before it ended, when the key goes down again straight away', () => {
    const h: Heard = { chunks: [], origin: 0, total: 0, takenUntil: 0 }
    listen(h, 2)
    const first = startBack(h, RATE * PRE_ROLL_SECONDS)
    listen(h, 1.2, [first])
    // Let go: the first recording ends once the last 0.25 s has come in from the microphone.
    const firstEnds = endAfter(h, 0.25 * RATE)
    expect(firstEnds).toBe(h.total + 0.25 * RATE)
    // Down again 0.15 s later: going back the usual 0.45 s would take in the first one's last words again.
    listen(h, 0.15, [first])
    expect(h.total - PRE_ROLL_SECONDS * RATE).toBeLessThan(firstEnds)
    const second = startBack(h, RATE * PRE_ROLL_SECONDS)
    expect(second).toBe(firstEnds)
    listen(h, 1, [first, second])
    const one = takeSamples(h.chunks, h.origin, first, firstEnds)
    const two = takeSamples(h.chunks, h.origin, second, h.total)
    // The second starts with the moment straight after the first one's last: nothing twice, nothing missed.
    expect(two[0]).toBe(one[one.length - 1] + 1)
    // Once the first is well over, a recording goes back the full 0.45 s again.
    listen(h, 2)
    expect(startBack(h, RATE * PRE_ROLL_SECONDS)).toBe(h.total - PRE_ROLL_SECONDS * RATE)
  })
})
