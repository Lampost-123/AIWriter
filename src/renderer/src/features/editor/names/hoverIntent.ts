// When the hover card over a name shows and goes. It opens only once the pointer has rested on a
// name for a moment, so sweeping across the text never flashes cards; it stays while the pointer
// crosses the small gap to the card, and goes a moment after the pointer leaves both. Anything Adam
// does instead (a key, a scroll, a click, another scene) closes it at once, and it doesn't come back
// for that name until the pointer has left it. No DOM here, so it is unit-tested with fake timers.

export const OPEN_DELAY = 350
/** Moving from one name to another while a card shows. */
export const SWITCH_DELAY = 150
export const CLOSE_GRACE = 200

export interface HoverTarget<A> {
  id: string
  anchor: A
}

export class HoverIntent<A> {
  private shown: HoverTarget<A> | null = null
  private over: HoverTarget<A> | null = null
  private onCard = false
  private timer: ReturnType<typeof setTimeout> | null = null
  /** The name a dismissal happened on: not shown again until the pointer leaves it. */
  private quiet: string | null = null

  constructor(private readonly show: (target: HoverTarget<A> | null) => void) {}

  /** The pointer is over a name (called again as it moves; only a change of name counts). */
  enterName(id: string, anchor: A): void {
    if (this.over?.id === id) return
    this.over = { id, anchor }
    if (this.quiet === id) return
    this.quiet = null
    // Back on the name the card is for (or another place it is named): the card stays, by this word.
    if (this.shown?.id === id) return this.set(this.over)
    this.later(this.shown ? SWITCH_DELAY : OPEN_DELAY, () => this.set(this.over))
  }

  /** The pointer left the name it was over (for plain text, or out of the page). */
  leaveName(): void {
    if (!this.over) return
    this.over = null
    this.quiet = null
    if (!this.shown) return this.clear()
    if (!this.onCard) this.later(CLOSE_GRACE, () => this.set(null))
  }

  enterCard(): void {
    this.onCard = true
    if (this.shown) this.clear()
  }

  leaveCard(): void {
    this.onCard = false
    if (this.shown && !this.over) this.later(CLOSE_GRACE, () => this.set(null))
  }

  /** Adam did something else (a key, a scroll, a click): close now. */
  dismiss(): void {
    this.clear()
    this.quiet = this.over?.id ?? null
    this.onCard = false
    this.set(null)
  }

  get current(): HoverTarget<A> | null {
    return this.shown
  }

  destroy(): void {
    this.clear()
  }

  private set(target: HoverTarget<A> | null): void {
    this.clear()
    if (this.shown === target || (this.shown && target && this.shown.id === target.id && this.shown.anchor === target.anchor)) return
    this.shown = target
    this.show(target)
  }

  private later(ms: number, fn: () => void): void {
    this.clear()
    this.timer = setTimeout(fn, ms)
  }

  private clear(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }
}
