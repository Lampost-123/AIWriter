// Messages (the toasts in the corner) show above what lies at the foot of the page while it shows: the dock and what is
// over it, the director's line, the change box, and a small panel opened over the dock (Beat by beat's question, the
// draft's "where should it go?"). Never over a button there. (components/ui/Toast.tsx `useToastsAbove` does the lifting.)
import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useToastsAbove } from '@/components/ui'

/** Keeps messages above `target` (a ref set before this renders: put it after the element). */
export function ToastsAbove({ target }: { target: React.RefObject<HTMLElement | null> }): null {
  useToastsAbove(target)
  return null
}

/** Below this share of the window's height from the top, a panel lifts the messages over it; a taller one doesn't. */
const LOW_PANEL = 0.45

/**
 * Keeps messages above a panel opened over the dock (in a portal, given by a callback ref) once it has been placed: a
 * stand-in of the room it takes at the window's foot is what is measured. A panel reaching into the top half of the
 * window (the draft options) leaves them where they are, rather than lifting them out of sight.
 */
export function ToastsAboveElement({ el }: { el: HTMLElement | null }): React.JSX.Element | null {
  const proxy = useRef<HTMLDivElement>(null)
  const [room, setRoom] = useState(0)
  useLayoutEffect(() => {
    if (!el) return
    const update = (): void => {
      const top = el.getBoundingClientRect().top
      const h = window.innerHeight
      setRoom(top > h * LOW_PANEL && top < h ? Math.round(h - top) : 0)
    }
    // The panel is placed a frame after it mounts.
    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(update)
    })
    const ro = new ResizeObserver(update)
    ro.observe(el)
    window.addEventListener('resize', update)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [el])
  if (!el) return null
  return (
    <>
      {createPortal(
        <div ref={proxy} aria-hidden style={{ position: 'fixed', left: 0, bottom: 0, width: 0, height: room, pointerEvents: 'none' }} />,
        document.body
      )}
      <ToastsAbove target={proxy} />
    </>
  )
}
