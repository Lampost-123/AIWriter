import { useEffect, useRef } from 'react'
import { cn } from '@/lib/cn'

/**
 * An in-place title editor that takes the exact spot of the text it replaces,
 * so nothing moves. Enter or leaving the field saves; Esc cancels.
 */
export function InlineTitle({
  value,
  onCommit,
  onDone,
  className,
  label
}: {
  value: string
  onCommit: (title: string) => void
  /** Called after saving or cancelling. */
  onDone: () => void
  className?: string
  label: string
}): React.JSX.Element {
  const ref = useRef<HTMLInputElement>(null)
  const finished = useRef(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    el.select()
  }, [])

  const finish = (save: boolean): void => {
    if (finished.current) return
    finished.current = true
    const next = ref.current?.value.trim() ?? ''
    if (save && next && next !== value) onCommit(next)
    onDone()
  }

  return (
    <input
      ref={ref}
      aria-label={label}
      defaultValue={value}
      spellCheck={false}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') {
          e.preventDefault()
          finish(true)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          finish(false)
        }
      }}
      onBlur={() => finish(true)}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      className={cn(
        'min-w-0 flex-1 rounded-[4px] bg-page px-1 -mx-1 text-fg outline-none ring-1 ring-accent/60 selection:bg-accent/25',
        className
      )}
    />
  )
}
