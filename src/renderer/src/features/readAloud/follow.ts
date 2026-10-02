// Follow along: keeps the sentence being read a third of the way down the page, gliding there rather than
// jumping. While Adam scrolls or types himself, the page is left alone for a few seconds.

const reducedMotion = (): boolean => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/** How long a glide takes. */
const GLIDE_MS = 180
/** After Adam scrolls or types, how long the page is left where he put it. */
const HOLD_MS = 4000

export class FollowAlong {
  private raf = 0
  private heldUntil = 0

  constructor(private readonly scroller: () => HTMLElement | null) {}

  /** Adam moved the page or typed: leave it alone for a while. */
  hold(ms = HOLD_MS): void {
    this.heldUntil = Date.now() + ms
    this.cancel()
  }

  /** Brings a place on the page (its top, in window coordinates) a third of the way down, unless it is held. */
  bring(top: number): void {
    const el = this.scroller()
    if (!el || Date.now() < this.heldUntil) return
    const box = el.getBoundingClientRect()
    const target = Math.max(0, Math.min(el.scrollHeight - el.clientHeight, el.scrollTop + (top - box.top) - el.clientHeight / 3))
    if (Math.abs(target - el.scrollTop) < 4) return
    this.cancel()
    if (reducedMotion()) {
      el.scrollTop = target
      return
    }
    const from = el.scrollTop
    const start = performance.now()
    const tick = (now: number): void => {
      const t = Math.min(1, (now - start) / GLIDE_MS)
      // Ease out: quick to start, gentle to settle.
      el.scrollTop = from + (target - from) * (1 - (1 - t) ** 3)
      this.raf = t < 1 ? requestAnimationFrame(tick) : 0
    }
    this.raf = requestAnimationFrame(tick)
  }

  cancel(): void {
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
  }
}
