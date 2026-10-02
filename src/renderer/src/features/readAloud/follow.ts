// Follow along: keeps the sentence being read a third of the way down the page (the part of it the reading bar
// leaves clear), gliding there rather than jumping. While Adam scrolls or types himself, the page is left alone for
// a few seconds.

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

  /** `inset`: the room at the top of the page that something lies over (the reading bar). */
  constructor(
    private readonly scroller: () => HTMLElement | null,
    private readonly inset: () => number = () => 0
  ) {}

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
    const inset = Math.min(Math.max(0, this.inset()), el.clientHeight / 2)
    const at = inset + (el.clientHeight - inset) / 3
    const target = Math.max(0, Math.min(el.scrollHeight - el.clientHeight, el.scrollTop + (top - box.top) - at))
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
