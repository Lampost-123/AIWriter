import { afterEach, describe, expect, it, vi } from 'vitest'
import { FollowScroll } from './followScroll'

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

  // The glide's own step (the same pace at any frame rate, never past the bottom) is tested in scrollGlide.test.ts.

  it('reaches the bottom and stops once the draft has ended', () => {
    const at = run(60, 3000)
    expect(at).toBeCloseTo(1900, 0)
  })
})
