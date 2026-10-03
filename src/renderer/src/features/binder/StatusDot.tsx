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
  return (
    <span
      aria-hidden
      data-status={status}
      className={cn(
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
