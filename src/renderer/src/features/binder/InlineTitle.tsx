import { useEffect, useRef } from 'react'
import { cn } from '@/lib/cn'
import { registerFlusher } from '@/lib/flush'

/**
 * An in-place title editor that takes the exact spot of the text it replaces,
 * so nothing moves. Enter or leaving the field saves; Esc cancels. A title still
 * being typed is saved too when the window closes or the world changes.
 */
export function InlineTitle({
  value,
  onCommit,
  onDone,
  className,
  label
}: {
  value: string
  /** Saves the title. Return the save, so closing the window waits for it. */
  onCommit: (title: string) => void | Promise<unknown>
  /** Called after saving or cancelling. */
  onDone: () => void
  className?: string
  label: string
}): React.JSX.Element {
  const ref = useRef<HTMLInputElement>(null)
  const finished = useRef(false)
  // The flusher is registered once, so it reads the latest props through here.
  const props = useRef({ value, onCommit, onDone })
  props.current = { value, onCommit, onDone }

  const finish = (save: boolean): Promise<unknown> | void => {
    if (finished.current) return
    finished.current = true
    const { value: before, onCommit: commit, onDone: done } = props.current
    const next = ref.current?.value.trim() ?? ''
    const saving = save && next && next !== before ? commit(next) : undefined
    done()
    return saving
  }
  const finishRef = useRef(finish)
  finishRef.current = finish

  useEffect(() => {
    const el = ref.current
    if (el) {
      el.focus()
      el.select()
    }
    return registerFlusher(async () => {
      await finishRef.current(true)
    })
  }, [])

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
          void finish(true)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          void finish(false)
        }
      }}
      onBlur={() => void finish(true)}
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
