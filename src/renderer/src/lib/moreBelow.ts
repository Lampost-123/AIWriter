// A list that scrolls says so: while some of it is below what shows, it carries `data-more-below`,
// and the `fade-more-below` class (styles.css) fades its bottom edge. Scrollbars only show on hover,
// so without it a short window would hide the end of a list with no sign there is more.

/**
 * Use as the scrolling element's ref, with the `fade-more-below` class. Follows scrolling and any
 * change of size (the window's, or the list's); React runs the returned cleanup when the element goes.
 */
export function watchMoreBelow(el: HTMLElement | null): (() => void) | undefined {
  if (!el) return
  const check = (): void => void el.toggleAttribute('data-more-below', el.scrollHeight - el.scrollTop - el.clientHeight > 1)
  check()
  const ro = new ResizeObserver(check)
  ro.observe(el)
  for (const child of el.children) ro.observe(child)
  el.addEventListener('scroll', check, { passive: true })
  return () => {
    ro.disconnect()
    el.removeEventListener('scroll', check)
  }
}
