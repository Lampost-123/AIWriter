import { forwardRef, useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { Textarea, type TextareaProps } from '@/components/ui'

function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY
    if (o === 'auto' || o === 'scroll') return p
  }
  return null
}

/**
 * Sizes a textarea to its text, between minRows and maxRows. Re-measures when the
 * text changes and when the box gets wider or narrower (a side panel resized), and
 * keeps the surrounding scroll position steady while it measures.
 */
export function useFitHeight(ref: RefObject<HTMLTextAreaElement | null>, value: unknown, minRows: number, maxRows: number): void {
  const fit = useCallback(() => {
    const el = ref.current
    if (!el) return
    const cs = getComputedStyle(el)
    const lh = parseFloat(cs.lineHeight) || 20
    const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)
    const border = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth)
    const scroller = scrollParent(el)
    const top = scroller?.scrollTop ?? 0
    el.style.height = 'auto'
    const content = el.scrollHeight + border
    const max = lh * maxRows + pad + border
    const h = Math.min(Math.max(content, lh * minRows + pad + border), max)
    el.style.height = `${Math.ceil(h)}px`
    el.style.overflowY = content > max + 1 ? 'auto' : 'hidden'
    if (scroller && scroller.scrollTop !== top) scroller.scrollTop = top
  }, [ref, minRows, maxRows])

  useLayoutEffect(fit, [fit, value])

  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let width = el.offsetWidth
    const ro = new ResizeObserver(() => {
      if (el.offsetWidth === width) return
      width = el.offsetWidth
      fit()
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref, fit])
}

/** The design system's Textarea, growing with its text and staying right when its panel is resized. */
export const AutoTextarea = forwardRef<HTMLTextAreaElement, Omit<TextareaProps, 'autoGrow'>>(function AutoTextarea(
  { minRows = 2, maxRows = 16, value, ...rest },
  outerRef
) {
  const inner = useRef<HTMLTextAreaElement | null>(null)
  useFitHeight(inner, value, minRows, maxRows)
  return (
    <Textarea
      ref={(el) => {
        inner.current = el
        if (typeof outerRef === 'function') outerRef(el)
        else if (outerRef) outerRef.current = el
      }}
      autoGrow={false}
      minRows={minRows}
      maxRows={maxRows}
      value={value}
      {...rest}
    />
  )
})
