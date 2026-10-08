import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { frameGap, GLIDE_MS, GLIDE_TOP_SPEED, glideStep, ScrollGlide } from './scrollGlide'
import { FollowScroll } from './followScroll'

/** A scroller with a height, and frames run by hand at a chosen rate. */
function fakeScroller(scrollHeight: number, clientHeight = 500) {
  const el = { scrollTop: 0, scrollHeight, clientHeight } as unknown as HTMLElement
  return el
}

let frames: ((t: number) => void)[] = []
let now = 0

beforeEach(() => {
  frames = []
  now = 0
  vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => {
    frames.push(cb)
    return frames.length
  })
  vi.stubGlobal('cancelAnimationFrame', () => {
    frames = []
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Runs frames `ms` apart for `total` ms. */
function run(ms: number, total: number): void {
  for (let t = 0; t < total; t += ms) {
    now += ms
    const due = frames
    frames = []
    for (const f of due) f(now)
  }
}

describe('the glide’s pace', () => {
  it('closes the same share of the gap for the same time, whatever the frame rate', () => {
    // One 60 Hz frame against two 120 Hz frames (a gap the glide closes below its top speed).
    const at60 = glideStep(100, 1000 / 60)
    const half = glideStep(100, 1000 / 120)
    const at120 = half + glideStep(100 - half, 1000 / 120)
    expect(Math.abs(at60 - at120)).toBeLessThan(0.5)
    // About what the old 18% a frame was at 60 Hz.
    expect(at60 / 100).toBeCloseTo(1 - Math.exp(-1000 / 60 / GLIDE_MS), 5)
  })

  it('never goes faster than its top speed: far behind, it catches up over several frames', () => {
    // 1,000 px behind: 20 px a 60 Hz frame, not 169.
    expect(glideStep(1000, 1000 / 60)).toBeCloseTo(GLIDE_TOP_SPEED * (1000 / 60), 5)
    expect(glideStep(-1000, 1000 / 60)).toBeCloseTo(-GLIDE_TOP_SPEED * (1000 / 60), 5)
    // A slow machine's long frame moves further, but no faster.
    expect(glideStep(1000, 50) / 50).toBeCloseTo(GLIDE_TOP_SPEED, 5)
    let gap = 1000
    let frames = 0
    while (gap > 0.5 && frames < 1000) {
      gap -= glideStep(gap, 1000 / 60)
      frames++
    }
    // About 50 frames at full speed, then the ease into place: under a second and a half.
    expect(frames).toBeGreaterThan(45)
    expect(frames * (1000 / 60)).toBeLessThan(1500)
  })

  it('moves at least a pixel, never past the target', () => {
    expect(glideStep(3, 1)).toBe(1)
    expect(glideStep(0.6, 16)).toBe(0.6)
    expect(glideStep(-200, 16)).toBeLessThan(-1)
    expect(glideStep(50, 10_000)).toBe(50)
  })

  it('counts the first frame as one at 60 Hz and a long pause as 100 ms', () => {
    expect(frameGap(null, 500)).toBeCloseTo(16.67, 1)
    expect(frameGap(100, 108)).toBe(8)
    expect(frameGap(100, 5000)).toBe(100)
  })
})

describe('gliding the page', () => {
  it('reaches a target that moves on while it goes, as quickly at 120 Hz as at 60 Hz', () => {
    const at = (hz: number): number => {
      const el = fakeScroller(10_000)
      const g = new ScrollGlide(() => el)
      g.to(400)
      run(1000 / hz, 100)
      g.to(800)
      run(1000 / hz, 100)
      return el.scrollTop
    }
    // Within a few pixels (only a glide's first frame is taken as a 60 Hz one); 18% a frame was about 85 px apart here.
    expect(Math.abs(at(60) - at(120))).toBeLessThan(30)
    const el = fakeScroller(10_000)
    const g = new ScrollGlide(() => el)
    g.to(800)
    run(1000 / 60, 2000)
    expect(el.scrollTop).toBeCloseTo(800, 0)
    expect(g.gliding).toBe(false)
  })

  it('stops where it is when Adam takes the page back', () => {
    const el = fakeScroller(10_000)
    const g = new ScrollGlide(() => el)
    g.to(1000)
    run(1000 / 60, 50)
    const where = el.scrollTop
    g.stop()
    run(1000 / 60, 500)
    expect(el.scrollTop).toBe(where)
    expect(where).toBeGreaterThan(0)
    expect(where).toBeLessThan(1000)
  })

  it('never goes past the end of the page', () => {
    const el = fakeScroller(800, 500)
    const g = new ScrollGlide(() => el)
    g.to(5000)
    run(1000 / 60, 2000)
    expect(el.scrollTop).toBeCloseTo(300, 0)
  })
})

describe('following a draft as it streams in', () => {
  it('glides to the bottom at the same pace at 60 Hz and 120 Hz', () => {
    const at = (hz: number): number => {
      const el = fakeScroller(2000, 500)
      el.scrollTop = 1500 - 50
      const f = new FollowScroll(() => el)
      f.check()
      ;(el as { scrollHeight: number }).scrollHeight = 3000
      f.nudge()
      run(1000 / hz, 150)
      return el.scrollTop
    }
    const a = at(60)
    const b = at(120)
    expect(a).toBeGreaterThan(1450)
    expect(a).toBeLessThan(2500)
    expect(Math.abs(a - b)).toBeLessThan(25)
  })
})
