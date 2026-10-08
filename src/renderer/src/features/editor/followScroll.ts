/**
 * Keeps the page scrolled to the bottom while a draft streams in, but only if
 * Adam was already at the bottom. Eases toward the target each frame, so the
 * text glides rather than jumps. Scrolling up (wheel, keys or scrollbar) stops it.
 * The glide goes by time, not by frames, so it feels the same on a 60 Hz screen
 * and a faster one.
 */
const reducedMotion = (): boolean => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/** One frame at 60 Hz, in ms: the glide closes SHARE of the gap in that time. */
const FRAME = 1000 / 60
const SHARE = 0.18
/** A longer pause between frames (a busy or hidden window) counts as this much at most, so it never leaps. */
const LONGEST_STEP = 100

/**
 * How far to move toward the bottom after `ms` since the last frame: the same glide at any frame rate (18% of the
 * gap each 60 Hz frame, and so less in each of a faster screen's frames), at least a pixel's worth per 60 Hz frame
 * so it always arrives, and never past the bottom.
 */
export function glideStep(gap: number, ms: number): number {
  if (gap <= 0) return 0
  const frames = Math.min(LONGEST_STEP, Math.max(0, ms)) / FRAME
  const share = 1 - Math.pow(1 - SHARE, frames)
  return Math.min(gap, Math.max(frames, gap * share))
}

export class FollowScroll {
  private raf = 0
  private following = false
  private settling = false
  private lastTop = 0
  /** When the glide last moved the page, or was asked to start (null: it isn't gliding). */
  private lastFrame: number | null = null

  /** Within this many pixels of the bottom counts as "at the bottom". */
  static readonly SLACK = 96

  constructor(
    private readonly el: () => HTMLElement | null,
    /** The clock frames are timed by (requestAnimationFrame's own). */
    private readonly now: () => number = () => performance.now()
  ) {}

  isNearBottom(): boolean {
    const el = this.el()
    if (!el) return false
    return el.scrollHeight - el.scrollTop - el.clientHeight <= FollowScroll.SLACK
  }

  /** Call before inserting streamed text: starts following if Adam is at the bottom. */
  check(): void {
    this.settling = false
    if (!this.following) this.following = this.isNearBottom()
    const el = this.el()
    if (el) this.lastTop = el.scrollTop
  }

  /** Call after inserting streamed text. */
  nudge(): void {
    if (!this.following || this.raf) return
    // The glide's time starts when the words land.
    if (this.lastFrame === null) this.lastFrame = this.now()
    this.raf = requestAnimationFrame(this.tick)
  }

  /** The stream ended: finish gliding to the bottom, then stop following. */
  settle(): void {
    this.settling = true
    if (!this.raf) this.following = false
  }

  /** Wire to the scroller's scroll event: any upward scroll by Adam stops following. */
  onScroll(): void {
    const el = this.el()
    if (!el) return
    if (el.scrollTop < this.lastTop - 2) this.stop()
    this.lastTop = el.scrollTop
  }

  stop(): void {
    this.following = false
    this.settling = false
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
    this.lastFrame = null
  }

  private tick = (now: number): void => {
    this.raf = 0
    const el = this.el()
    if (!el || !this.following) {
      this.lastFrame = null
      return
    }
    const target = el.scrollHeight - el.clientHeight
    const gap = target - el.scrollTop
    if (gap <= 0.5) {
      // At the bottom: the next words start a fresh glide.
      this.lastFrame = null
      if (this.settling) this.stop()
      return
    }
    const ms = this.lastFrame === null ? FRAME : now - this.lastFrame
    this.lastFrame = now
    // Glide, unless the system asks for less motion: then keep up in one step.
    el.scrollTop += reducedMotion() ? gap : glideStep(gap, ms)
    this.lastTop = el.scrollTop
    this.raf = requestAnimationFrame(this.tick)
  }
}
