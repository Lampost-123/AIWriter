// A page's loading and failed states, the same everywhere (review idea 11): nothing at all for the first moment (most
// pages are there by then, so a quick one never flashes a message), then a quiet line that fades in, and if loading
// fails one plain sentence and Try again. LoadState takes the page's whole height, so nothing jumps when the page
// arrives. Used by Build with AI (planHub/PlanHub.tsx) and the World room's views (timeline/viewParts.tsx); any page
// with its own failed load can show LoadFailed the same way.
import { useEffect, useState, type HTMLAttributes, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { RotateCcw } from './icons'
import { Button } from './Button'
import { EmptyState } from './misc'

/** How long a page may take before it says it is opening (a wait, not a motion speed). */
export const SLOW_LOAD_MS = 300

/** Nothing for the first moment, then a quiet "Opening the plan…". Words only: loops are for the AI at work. */
export function LoadSlow({ text, className }: { text: string; className?: string }): React.JSX.Element | null {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), SLOW_LOAD_MS)
    return () => clearTimeout(t)
  }, [])
  if (!slow) return null
  return (
    <p role="status" className={cn('animate-fade-in text-[13.5px] text-muted', className)}>
      {text}
    </p>
  )
}

/** A load that failed: the page's icon, what couldn't load, why in plain words, and Try again. */
export function LoadFailed({
  title,
  reason,
  icon,
  onRetry,
  className
}: {
  /** "Couldn’t load the plan". */
  title: string
  /** Why, in plain words (lib/reason.ts plainReason). */
  reason: string
  icon?: ReactNode
  onRetry: () => void
  className?: string
}): React.JSX.Element {
  return (
    <EmptyState
      icon={icon}
      title={title}
      className={cn('mt-[12vh]', className)}
      actions={
        <Button icon={<RotateCcw size={14} />} onClick={onRetry}>
          Try again
        </Button>
      }
    >
      {reason} Nothing you wrote is lost; try again in a moment.
    </EmptyState>
  )
}

export interface LoadStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** What is opening, in Adam's words: "Opening the plan…". */
  loading: string
  /** Why it failed, in plain words, or null while it is still loading. */
  failed: string | null
  /** The failed state's heading: "Couldn’t load the plan". */
  failedTitle: string
  /** The page's own icon for the failed state. */
  icon?: ReactNode
  /** Try again: asks for everything the page needs once more. */
  onRetry: () => void
}

/** A whole page that hasn't arrived yet: quiet while it loads, LoadFailed if it can't. */
export function LoadState({ loading, failed, failedTitle, icon, onRetry, className, ...rest }: LoadStateProps): React.JSX.Element {
  return (
    <div {...rest} className={cn('flex h-full min-h-0 items-start justify-center', className)} aria-busy={!failed || undefined}>
      {failed ? (
        <LoadFailed title={failedTitle} reason={failed} icon={icon} onRetry={onRetry} />
      ) : (
        <LoadSlow text={loading} className="mt-[18vh]" />
      )}
    </div>
  )
}
