// A section's contents that open and close smoothly: the height grows from nothing as they fade in (220 ms), and
// shrinks back as they fade out (140 ms) before they go. From the keyboard, with less motion, or when the section
// is already open as the screen arrives, it happens at once (styles.css, .fold).
import { useEffect, useRef, useState } from 'react'
import { keyboardDriven, reducedMotion } from '@/features/look/motion'
import { cn } from '@/lib/cn'

export function Fold({
  open,
  as: Outer = 'div',
  id,
  className,
  data,
  children
}: {
  open: boolean
  /** `li` when the contents are an item of a list (the item comes and goes with them). */
  as?: 'div' | 'li'
  id?: string
  className?: string
  /** A `data-*` attribute for the contents, as tests and styles find them. */
  data?: `data-${string}`
  children: React.ReactNode
}): React.JSX.Element | null {
  const [shown, setShown] = useState(open)
  // Open as the screen arrives: no motion (a screen's pieces don't play again on coming back).
  const [instant, setInstant] = useState(open)
  // Settled open: nothing is clipped any more (a menu or a shadow inside can reach past the edge).
  const [settled, setSettled] = useState(open)
  const [was, setWas] = useState(open)
  const ref = useRef<HTMLElement>(null)
  if (open !== was) {
    const now = keyboardDriven() || reducedMotion()
    setWas(open)
    setInstant(now)
    setSettled(open && now)
    if (open) setShown(true)
  }

  useEffect(() => {
    if (open || !shown) return
    const el = ref.current
    const exit = el && !instant ? parseFloat(getComputedStyle(el).getPropertyValue('--dur-exit')) || 0 : 0
    if (!exit) {
      setShown(false)
      return
    }
    const t = window.setTimeout(() => setShown(false), exit)
    return () => window.clearTimeout(t)
  }, [open, shown, instant])

  if (!shown) return null
  return (
    <Outer
      ref={ref as React.Ref<HTMLDivElement & HTMLLIElement>}
      className="fold"
      data-open={open}
      data-instant={instant || undefined}
      data-settled={settled || undefined}
      inert={!open || undefined}
      onTransitionEnd={(e) => {
        if (open && e.target === e.currentTarget && e.propertyName === 'grid-template-rows') setSettled(true)
      }}
    >
      <div id={id} className={cn('fold-in', className)} {...(data ? { [data]: '' } : {})}>
        {children}
      </div>
    </Outer>
  )
}
