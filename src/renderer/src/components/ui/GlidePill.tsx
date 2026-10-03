// The New look's selection pill: one raised pill behind a list that glides to the selected row (the row marked
// aria-selected="true" or aria-current="page" inside `host`) instead of jumping. The rows keep their own words and
// colours; the pill only sits behind them. Placed by transform alone, so it never moves anything else, and with the
// spring timing (styles.css: --motion-spring), which less motion makes instant. Put it first inside the list it
// belongs to (its parent, which must be positioned): it scrolls with the rows there.
import { useLayoutEffect, useRef } from 'react'
import { cn } from '@/lib/cn'

const SELECTED = '[aria-selected="true"], [aria-current="page"]'

export function GlidePill({ className }: { className?: string }): React.JSX.Element {
  const pill = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const p = pill.current
    const box = p?.parentElement
    if (!box || !p) return
    let shown = false
    let frame = 0
    const place = (): void => {
      frame = 0
      const row = [...box.querySelectorAll<HTMLElement>(SELECTED)].find((el) => el.offsetParent !== null && !el.closest('[data-no-pill]'))
      if (!row) {
        p.style.opacity = '0'
        shown = false
        return
      }
      const b = box.getBoundingClientRect()
      const r = row.getBoundingClientRect()
      const x = r.left - b.left + box.scrollLeft
      const y = r.top - b.top + box.scrollTop
      // The first time (or after it was hidden) it appears in place; after that it glides.
      if (!shown) p.style.transition = 'none'
      p.style.width = `${r.width}px`
      p.style.height = `${r.height}px`
      p.style.transform = `translate(${x}px, ${y}px)`
      p.style.opacity = '1'
      if (!shown) {
        void p.offsetWidth
        p.style.transition = ''
        shown = true
      }
    }
    const later = (): void => {
      if (!frame) frame = requestAnimationFrame(place)
    }
    place()
    const mo = new MutationObserver(later)
    mo.observe(box, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-selected', 'aria-current', 'aria-expanded', 'hidden'] })
    const ro = new ResizeObserver(later)
    ro.observe(box)
    return () => {
      mo.disconnect()
      ro.disconnect()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])

  return (
    <div
      ref={pill}
      aria-hidden
      className={cn(
        'pointer-events-none absolute left-0 top-0 rounded-[9px] bg-raise opacity-0 shadow-e2',
        'transition-[transform,opacity] duration-(--dur-base) ease-spring',
        className
      )}
    />
  )
}
