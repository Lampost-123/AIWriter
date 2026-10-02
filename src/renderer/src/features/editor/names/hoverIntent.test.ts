import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CLOSE_GRACE, HoverIntent, OPEN_DELAY, SWITCH_DELAY, type HoverTarget } from './hoverIntent'

describe('when a hover card shows', () => {
  let shown: (HoverTarget<string> | null)[]
  let h: HoverIntent<string>
  const now = (): string | null => shown[shown.length - 1]?.id ?? null
  beforeEach(() => {
    vi.useFakeTimers()
    shown = []
    h = new HoverIntent<string>((t) => shown.push(t))
  })
  afterEach(() => {
    h.destroy()
    vi.useRealTimers()
  })

  it('opens only once the pointer has rested on a name', () => {
    h.enterName('mara', 'word-1')
    vi.advanceTimersByTime(OPEN_DELAY - 1)
    expect(shown).toEqual([])
    vi.advanceTimersByTime(1)
    expect(shown).toEqual([{ id: 'mara', anchor: 'word-1' }])
  })

  it('never flashes while the pointer sweeps across names', () => {
    for (const id of ['mara', 'tobin', 'kell', 'mara']) {
      h.enterName(id, id)
      vi.advanceTimersByTime(120)
      h.leaveName()
      vi.advanceTimersByTime(40)
    }
    vi.advanceTimersByTime(2000)
    expect(shown).toEqual([])
  })

  it('stays while the pointer crosses to the card, and goes a moment after it leaves both', () => {
    h.enterName('mara', 'w')
    vi.advanceTimersByTime(OPEN_DELAY)
    h.leaveName()
    vi.advanceTimersByTime(CLOSE_GRACE - 50)
    h.enterCard()
    vi.advanceTimersByTime(5000)
    expect(now()).toBe('mara')
    h.leaveCard()
    vi.advanceTimersByTime(CLOSE_GRACE)
    expect(now()).toBeNull()
  })

  it('moves to another name a little sooner once a card is showing', () => {
    h.enterName('mara', 'a')
    vi.advanceTimersByTime(OPEN_DELAY)
    h.leaveName()
    h.enterName('tobin', 'b')
    vi.advanceTimersByTime(SWITCH_DELAY)
    expect(shown.map((t) => t?.id ?? null)).toEqual(['mara', 'tobin'])
  })

  it('a key, a scroll or a click closes it at once, and it stays closed until the pointer leaves that name', () => {
    h.enterName('mara', 'a')
    vi.advanceTimersByTime(OPEN_DELAY)
    h.dismiss()
    expect(now()).toBeNull()
    h.enterName('mara', 'a')
    vi.advanceTimersByTime(OPEN_DELAY * 2)
    expect(now()).toBeNull()
    h.leaveName()
    h.enterName('mara', 'a')
    vi.advanceTimersByTime(OPEN_DELAY)
    expect(now()).toBe('mara')
  })
})
