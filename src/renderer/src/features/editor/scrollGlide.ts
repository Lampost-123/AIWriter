// Gliding the page toward a place that may keep moving, as it does while the AI writes: Add below's draft
// (followScroll.ts) and Continue's change (features/edits/SuggestionLayer.tsx). Each frame closes the same share of
// the gap for the time that has passed (1 − e^(−dt/90 ms)), so the glide feels the same on a 60 Hz and a 120 Hz
// screen; a share per frame would be twice as quick at 120 Hz. It never goes faster than GLIDE_TOP_SPEED, so a page far
// behind catches up over a few frames rather than in a jump. With less motion the page goes there in one step.
import { reducedMotion } from '@/features/look/motion'

/** The glide's pace: the gap shrinks by e (about 63%) every this many ms. */
export const GLIDE_MS = 90

/** The time since the last frame: the first frame of a glide counts as one at 60 Hz, a long pause (the window hidden) as 100 ms. */
export const frameGap = (last: number | null, now: number): number => (last === null ? 1000 / 60 : Math.min(100, Math.max(0, now - last)))

/**
 * The glide's top speed, in px a ms (1,200 px a second, 20 px a frame at 60 Hz). When the page has fallen well behind (a
 * slower computer drawing fewer frames while the words arrive in bunches) it catches up at this speed over a few frames
 * instead of in ever bigger jumps; the words of a draft come far slower than this, so it never falls further behind.
 */
export const GLIDE_TOP_SPEED = 1.2

/**
 * How far to move this frame (`dt` ms after the last) to close `gap` at the glide's pace, never faster than its top
 * speed; at least a pixel, so it arrives.
 */
export function glideStep(gap: number, dt: number): number {
  if (Math.abs(gap) <= 1) return gap
  const time = Math.max(0, dt)
  const step = Math.min(Math.abs(gap) * (1 - Math.exp(-time / GLIDE_MS)), GLIDE_TOP_SPEED * time)
  return Math.sign(gap) * Math.min(Math.abs(gap), Math.max(1, step))
}

/**
 * Glides a scroller to a target that can move on while it goes (each `to` sets a new one). `stop` ends it where it
 * is: Adam scrolling, clicking or using the keys takes the page back from it.
 */
export class ScrollGlide {
  private raf = 0
  private last: number | null = null
  private goal = 0

  constructor(private readonly el: () => HTMLElement | null) {}

  /** True while it is on its way. */
  get gliding(): boolean {
    return this.raf !== 0
  }

  /** Where it is going (only meaningful while gliding). */
  get target(): number {
    return this.goal
  }

  /** Glides toward `top` (in one step with less motion). */
  to(top: number): void {
    const el = this.el()
    if (!el) return
    if (reducedMotion()) {
      this.stop()
      el.scrollTop = top
      return
    }
    this.goal = top
    if (!this.raf) {
      this.last = null
      this.raf = requestAnimationFrame(this.tick)
    }
  }

  stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
    this.last = null
  }

  private tick = (now: number): void => {
    this.raf = 0
    const el = this.el()
    if (!el) return
    // Never past the end (the page may have grown shorter since).
    const goal = Math.max(0, Math.min(this.goal, el.scrollHeight - el.clientHeight))
    const gap = goal - el.scrollTop
    if (Math.abs(gap) <= 0.5) {
      this.last = null
      return
    }
    const before = el.scrollTop
    el.scrollTop = before + glideStep(gap, frameGap(this.last, now))
    this.last = now
    // A scroller that won't move any further (rounding at its very end) has arrived.
    if (el.scrollTop === before) return
    this.raf = requestAnimationFrame(this.tick)
  }
}
