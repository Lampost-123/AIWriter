import type { SceneStatus } from '@shared/types'
import { cn } from '@/lib/cn'

export const STATUS_LABELS: Record<SceneStatus, string> = {
  planned: 'Planned',
  drafted: 'Drafted',
  revised: 'Revised',
  done: 'Done'
}

export const STATUSES: SceneStatus[] = ['planned', 'drafted', 'revised', 'done']

/** Planned = hollow ring, drafted = faint dot, revised = accent, done = green. */
export function StatusDot({ status, className }: { status: SceneStatus; className?: string }): React.JSX.Element {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block h-[7px] w-[7px] shrink-0 rounded-full',
        status === 'planned' && 'border-[1.5px] border-faint',
        status === 'drafted' && 'bg-faint/70',
        status === 'revised' && 'bg-accent',
        status === 'done' && 'bg-success',
        className
      )}
    />
  )
}
