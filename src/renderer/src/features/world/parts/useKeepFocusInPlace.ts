import { useLayoutEffect, type RefObject } from 'react'

/**
 * Keeps the field Adam is typing in where it is on screen when something above it changes size,
 * such as the memory adding a change and its quote while he types in the private notes further down.
 * The scroll position moves by the same amount before the next paint, so the page never jumps under
 * him. The browser's own scroll anchoring does nothing while the page is scrolled to the top and
 * often anchors on something else, so it is switched off while a field in the page has the focus.
 * `scroller` scrolls; `content` is the one element inside it whose size changes; `active` is true
 * while both are on screen.
 */
export function useKeepFocusInPlace(scroller: RefObject<HTMLElement | null>, content: RefObject<HTMLElement | null>, active = true): void {
  useLayoutEffect(() => {
    const box = scroller.current
    const inner = content.current
    if (!active || !box || !inner || typeof ResizeObserver === 'undefined') return
    // Where the focused field sits within the page. Scrolling doesn't change it, nor does the field
    // growing as Adam types (or the browser scrolling to keep his cursor in view): only what is above it.
    let last: { node: Element; top: number } | null = null
    const focused = (): Element | null => {
      const f = document.activeElement
      return f && f !== box && box.contains(f) ? f : null
    }
    const within = (f: Element): number => f.getBoundingClientRect().top - inner.getBoundingClientRect().top
    const measure = (): void => {
      const f = focused()
      last = f ? { node: f, top: within(f) } : null
      box.style.overflowAnchor = f ? 'none' : ''
    }
    const ro = new ResizeObserver(() => {
      const f = focused()
      if (f && last?.node === f) {
        const moved = within(f) - last.top
        if (Math.abs(moved) >= 1) box.scrollTop += moved
      }
      measure()
    })
    ro.observe(inner)
    box.addEventListener('focusin', measure)
    box.addEventListener('focusout', measure)
    measure()
    return () => {
      ro.disconnect()
      box.removeEventListener('focusin', measure)
      box.removeEventListener('focusout', measure)
      box.style.overflowAnchor = ''
    }
  }, [scroller, content, active])
}
