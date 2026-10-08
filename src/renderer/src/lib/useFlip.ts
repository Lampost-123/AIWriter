// Things in a list glide to their new places when the list changes (a card folds away and the ones below close the gap;
// a filter takes some out): each element marked data-flip="<key>" inside `root` is measured after every change, and
// one that moved is drawn where it was and eased to where it is now (transform only: nothing is laid out again).
// Positions are taken against `root`, so scrolling in between doesn't count as moving. With less motion, nothing glides.
import { useLayoutEffect, useRef, type RefObject } from 'react'
import { reducedMotion } from '@/features/look/motion'

const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'

export function useFlip(root: RefObject<HTMLElement | null>, changed: unknown, ms = 220): void {
  const last = useRef(new Map<string, number>())
  useLayoutEffect(() => {
    const box = root.current
    if (!box) return
    const top = box.getBoundingClientRect().top
    const now = new Map<string, number>()
    const els = [...box.querySelectorAll<HTMLElement>('[data-flip]')]
    for (const el of els) now.set(el.dataset.flip!, el.getBoundingClientRect().top - top)
    if (!reducedMotion() && last.current.size) {
      for (const el of els) {
        const was = last.current.get(el.dataset.flip!)
        const is = now.get(el.dataset.flip!)!
        if (was === undefined || Math.abs(was - is) < 1) continue
        el.animate([{ transform: `translateY(${was - is}px)` }, { transform: 'translateY(0)' }], { duration: ms, easing: EASE })
      }
    }
    last.current = now
    // Measured after each change the caller names (not every render: the list's own hover states don't move it).
  }, [changed])
}
