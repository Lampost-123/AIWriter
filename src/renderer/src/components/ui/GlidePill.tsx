// The New look's selection pill: one raised pill behind a list that glides to the selected row (the row marked
// aria-selected="true" or aria-current="page" inside `host`) instead of jumping. The rows keep their own words and
// colours; the pill only sits behind them. Placed by transform alone, so it never moves anything else, gliding
// (position and size together) on the look's ease-out with no overshoot; a move from the keyboard, or across a long
// list, jumps instead, and less motion makes it instant. Put it first inside the list it belongs to (its parent, which
// must be positioned): it scrolls with the rows there.
import { useLayoutEffect, useRef } from 'react'
import { cn } from '@/lib/cn'
import { keyboardDriven } from '@/features/look/motion'

const SELECTED = '[aria-selected="true"], [aria-current="page"]'

/** Farther than this, the pill jumps rather than flying across the list. */
const LONGEST_GLIDE = 240

/**
 * Where `row` sits inside `box` by layout alone (a row being dragged, or moved by an animation, is measured where it
 * really belongs), or null when its offsets don't lead to `box`.
 */
function placeIn(box: HTMLElement, row: HTMLElement): { x: number; y: number } | null {
  let x = 0
  let y = 0
  let el: HTMLElement | null = row
  while (el && el !== box) {
    x += el.offsetLeft
    y += el.offsetTop
    const parent = el.offsetParent as HTMLElement | null
    if (parent && parent !== box) {
      x -= parent.scrollLeft
      y -= parent.scrollTop
    }
    el = parent
  }
  return el === box ? { x, y } : null
}

export function GlidePill({ className }: { className?: string }): React.JSX.Element {
  const pill = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const p = pill.current
    const box = p?.parentElement
    if (!box || !p) return
    let shown = false
    let frame = 0
    let lastX = 0
    let lastY = 0
    let lastRow: HTMLElement | null = null
    const place = (): void => {
      frame = 0
      const row = [...box.querySelectorAll<HTMLElement>(SELECTED)].find((el) => el.offsetParent !== null && !el.closest('[data-no-pill]'))
      if (!row) {
        p.style.opacity = '0'
        shown = false
        return
      }
      const r = row.getBoundingClientRect()
      const at =
        placeIn(box, row) ??
        (() => {
          const b = box.getBoundingClientRect()
          return { x: r.left - b.left + box.scrollLeft, y: r.top - b.top + box.scrollTop }
        })()
      // The first time (or after it was hidden) it appears in place; going to another row from the keyboard, or to one
      // far away, jumps too. The same row moving (a chapter folding above it, the list resizing) always glides with it.
      const far = row !== lastRow && (Math.abs(at.y - lastY) > LONGEST_GLIDE || Math.abs(at.x - lastX) > LONGEST_GLIDE)
      const jump = !shown || far || (row !== lastRow && keyboardDriven())
      if (jump) p.style.transition = 'none'
      p.style.width = `${r.width}px`
      p.style.height = `${r.height}px`
      p.style.transform = `translate(${at.x}px, ${at.y}px)`
      p.style.opacity = '1'
      lastX = at.x
      lastY = at.y
      lastRow = row
      if (jump) {
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
        // (Width and height glide too: the pill is an empty box on its own, so only it is laid out again.)
        'transition-[transform,width,height,opacity] duration-(--dur-base) ease-glide',
        className
      )}
    />
  )
}
