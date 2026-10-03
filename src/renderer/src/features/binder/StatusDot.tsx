import { useEffect, useRef, useState } from 'react'
import type { SceneStatus } from '@shared/types'
import { cn } from '@/lib/cn'

export const STATUS_LABELS: Record<SceneStatus, string> = {
  planned: 'Planned',
  drafted: 'Drafted',
  revised: 'Revised',
  done: 'Done'
}

export const STATUSES: SceneStatus[] = ['planned', 'drafted', 'revised', 'done']

/**
 * Planned = hollow ring, drafted = faint dot, revised = accent, done = green. The New look draws them as rings that
 * fill as the scene goes on: empty, half, three quarters (in the accent), then full and green.
 */
export function StatusDot({ status, className }: { status: SceneStatus; className?: string }): React.JSX.Element {
  // The New look: a ring pulses out from the dot once, as the scene is marked done (not when it shows done already).
  const before = useRef(status)
  const [pulse, setPulse] = useState(false)
  useEffect(() => {
    const was = before.current
    before.current = status
    if (status !== 'done' || was === 'done') return
    setPulse(true)
    const t = setTimeout(() => setPulse(false), 700)
    return () => clearTimeout(t)
  }, [status])
  return (
    <span
      aria-hidden
      data-status={status}
      className={cn(
        pulse && 'status-pulse look-new:relative',
        'inline-block h-[7px] w-[7px] shrink-0 rounded-full',
        status === 'planned' && 'border-[1.5px] border-faint',
        status === 'drafted' && 'bg-faint/70',
        status === 'revised' && 'bg-accent',
        status === 'done' && 'bg-success',
        'look-new:h-[11px] look-new:w-[11px] look-new:border-0',
        status === 'planned' && 'look-new:bg-transparent look-new:shadow-[inset_0_0_0_1.75px_var(--faint)]',
        status === 'drafted' &&
          'look-new:bg-[conic-gradient(var(--faint)_0_50%,transparent_0)] look-new:shadow-[inset_0_0_0_1.75px_var(--faint)]',
        status === 'revised' &&
          'look-new:bg-[conic-gradient(var(--accent)_0_75%,transparent_0)] look-new:shadow-[inset_0_0_0_1.75px_var(--accent)]',
        status === 'done' && 'look-new:shadow-[inset_0_0_0_1.75px_var(--success)]',
        className
      )}
    />
  )
}
