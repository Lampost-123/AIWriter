import { reducedMotion } from '@/features/look/motion'
import { frameGap, glideStep } from './scrollGlide'

/**
 * Keeps the page scrolled to the bottom while a draft streams in, but only if
 * Adam was already at the bottom. Eases toward the target each frame, so the
 * text glides rather than jumps, at the same pace whatever the screen's rate
 * (scrollGlide.ts). Scrolling up (wheel, keys or scrollbar) stops it.
 */
export class FollowScroll {
  private raf = 0
  private following = false
  private settling = false
  private lastTop = 0
  /** When the last frame of the glide ran (null before its first). */
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
      this.lastFrame = null
      if (this.settling) this.stop()
      return
    }
    // Glide (the same share of the gap for the time passed), unless the system asks for less motion: then keep up in one step.
    el.scrollTop += reducedMotion() ? gap : glideStep(gap, frameGap(this.lastFrame, now))
    this.lastFrame = now
    this.lastTop = el.scrollTop
    this.raf = requestAnimationFrame(this.tick)
  }
}
