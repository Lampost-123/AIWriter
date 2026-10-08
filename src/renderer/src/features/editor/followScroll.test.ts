import { afterEach, describe, expect, it, vi } from 'vitest'
import { FollowScroll, glideStep } from './followScroll'

/** A page that scrolls: 2000 px of text in a 500 px window, at its bottom. */
function page(): { scrollTop: number; scrollHeight: number; clientHeight: number } {
  return { scrollTop: 1500, scrollHeight: 2000, clientHeight: 500 }
}

/** Runs the follower for `ms` on a screen of `hz`, the text growing by 400 px first; returns where the page is. */
function run(hz: number, ms: number): number {
  const frames: ((t: number) => void)[] = []
  vi.stubGlobal('requestAnimationFrame', (f: (t: number) => void) => frames.push(f))
  vi.stubGlobal('cancelAnimationFrame', () => undefined)
  const el = page()
  // The words land at 0 ms; the screen's frames follow.
  const follow = new FollowScroll(() => el as unknown as HTMLElement, () => 0)
  follow.check()
  el.scrollHeight += 400
  follow.nudge()
  for (let t = 1000 / hz; t <= ms + 0.001; t += 1000 / hz) frames.shift()?.(t)
  return el.scrollTop
}

describe('following a draft down the page', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('glides by time, so a 120 Hz screen follows at the same speed as a 60 Hz one', () => {
    for (const ms of [50, 100, 250]) {
      const at60 = run(60, ms)
      const at120 = run(120, ms)
      expect(at60).toBeGreaterThan(1500)
      expect(Math.abs(at120 - at60)).toBeLessThan(8)
    }
  })

  it('moves as it always did on a 60 Hz screen: 18% of the gap a frame, a pixel at least', () => {
    expect(glideStep(100, 1000 / 60)).toBeCloseTo(18, 5)
    expect(glideStep(3, 1000 / 60)).toBe(1)
    // Half the time, half the frames' worth: two such steps close the same share as one 60 Hz frame.
    const first = glideStep(100, 1000 / 120)
    expect(first + glideStep(100 - first, 1000 / 120)).toBeCloseTo(18, 5)
  })

  it('never goes past the bottom, and a long pause counts as a short one', () => {
    expect(glideStep(2, 1000)).toBe(2)
    expect(glideStep(0, 16)).toBe(0)
    expect(glideStep(1000, 5000)).toBeCloseTo(glideStep(1000, 100), 5)
  })

  it('reaches the bottom and stops once the draft has ended', () => {
    const at = run(60, 3000)
    expect(at).toBeCloseTo(1900, 0)
  })
})
