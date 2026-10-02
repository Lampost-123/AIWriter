import { useCallback, useRef, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

/** The panel's 1px edge line, which sits inside its width. */
const BORDER = 1

/**
 * A side panel with a drag handle. Width changes are applied directly to the
 * element while dragging (no React re-render per pixel) and saved on release.
 * The contents keep their full width while the panel slides open or shut (the
 * panel clips them), so the text never re-wraps frame by frame.
 */
export function ResizablePane({
  side,
  width,
  min = 220,
  max = 520,
  open,
  onResize,
  children,
  className,
  label
}: {
  side: 'left' | 'right'
  width: number
  min?: number
  max?: number
  open: boolean
  onResize: (w: number) => void
  children: ReactNode
  className?: string
  label: string
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const el = ref.current
      if (!el) return
      e.preventDefault()
      const startX = e.clientX
      const startW = el.getBoundingClientRect().width
      let w = startW
      el.style.transition = 'none'
      const move = (ev: PointerEvent): void => {
        const dx = ev.clientX - startX
        w = Math.round(Math.min(max, Math.max(min, side === 'left' ? startW + dx : startW - dx)))
        el.style.width = `${w}px`
        if (innerRef.current) innerRef.current.style.width = `${w - BORDER}px`
      }
      const up = (): void => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        document.body.style.cursor = ''
        el.style.transition = ''
        onResize(w)
      }
      document.body.style.cursor = 'col-resize'
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    },
    [max, min, onResize, side]
  )

  return (
    <aside
      ref={ref}
      aria-label={label}
      style={{ width: open ? width : 0 }}
      className={cn(
        'relative flex shrink-0 flex-col overflow-hidden bg-surface transition-[width] duration-200 ease-out',
        side === 'left' ? 'border-r border-line' : 'border-l border-line',
        !open && 'border-transparent',
        className
      )}
    >
      <div ref={innerRef} className={cn('flex h-full flex-col', side === 'right' && 'self-end')} style={{ width: width - BORDER }}>
        {children}
      </div>
      {open ? (
        <div
          role="separator"
          aria-orientation="vertical"
          onPointerDown={onPointerDown}
          className={cn(
            'absolute top-0 z-10 h-full w-1.5 cursor-col-resize transition-colors hover:bg-accent/25',
            side === 'left' ? '-right-0.5' : '-left-0.5'
          )}
        />
      ) : null}
    </aside>
  )
}
