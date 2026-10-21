// Small building blocks shared by the drafting and model screens.
import * as P from '@radix-ui/react-popover'
import { useEffect, useState, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { ToastsAboveElement } from '@/features/desk/dock/ToastsAbove'

/** The floating panel used for draft options and short prompts. */
export function PopoverPanel({
  children,
  className,
  align = 'end',
  side,
  onOpenAutoFocus,
  onCloseAutoFocus,
  onEscapeKeyDown,
  onKeyDown
}: {
  children: ReactNode
  className?: string
  align?: 'start' | 'center' | 'end'
  /** Where it opens (below its anchor unless there is no room; the desk's dock opens it above). */
  side?: 'top' | 'bottom'
  onOpenAutoFocus?: (e: Event) => void
  onCloseAutoFocus?: (e: Event) => void
  /** Esc in the panel; preventing it keeps the panel open. */
  onEscapeKeyDown?: (e: KeyboardEvent) => void
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void
}): React.JSX.Element {
  // Opened over the desk's dock (side top), messages show above it, never over its buttons (ToastsAbove.tsx).
  const [el, setEl] = useState<HTMLDivElement | null>(null)
  return (
    <P.Portal>
      <P.Content
        ref={side === 'top' ? setEl : undefined}
        align={align}
        side={side}
        sideOffset={side === 'top' ? 10 : 6}
        collisionPadding={12}
        onOpenAutoFocus={onOpenAutoFocus}
        onCloseAutoFocus={onCloseAutoFocus}
        onEscapeKeyDown={onEscapeKeyDown}
        onKeyDown={onKeyDown}
        className={cn('z-50 rounded-xl border border-line bg-surface p-4 shadow-pop focus:outline-none data-[state=open]:animate-pop-in', className)}
      >
        {children}
        {side === 'top' ? <ToastsAboveElement el={el} /> : null}
      </P.Content>
    </P.Portal>
  )
}

/** True once `ms` have passed, so quick loads never flash a loading state. */
export function useDelayed(active: boolean, ms = 180): boolean {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (!active) {
      setShown(false)
      return
    }
    const t = setTimeout(() => setShown(true), ms)
    return () => clearTimeout(t)
  }, [active, ms])
  return active && shown
}

/** A soft placeholder bar for loading states. */
export function Skeleton({ className }: { className?: string }): React.JSX.Element {
  return <div className={cn('animate-pulse rounded-md bg-surface-2', className)} />
}

/** Re-renders every `ms` so relative times ("5 minutes ago") stay fresh. */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}
