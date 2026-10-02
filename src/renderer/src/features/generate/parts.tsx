// Small building blocks shared by the drafting and model screens.
import * as P from '@radix-ui/react-popover'
import { useEffect, useState, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

/** A row of choices where exactly one is picked (creativity presets). */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
  label: string
  className?: string
}): React.JSX.Element {
  return (
    <div role="radiogroup" aria-label={label} className={cn('inline-flex rounded-lg border border-line bg-surface-2 p-0.5', className)}>
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cn(
              'h-7 flex-1 rounded-md px-3 text-[13px] font-medium transition-[background-color,color,box-shadow] duration-150',
              // Accent tint rather than a raised white tab, so the choice reads clearly in every theme.
              on ? 'bg-accent-soft text-accent shadow-sm' : 'text-muted hover:text-fg'
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/** The floating panel used for draft options and short prompts. */
export function PopoverPanel({
  children,
  className,
  align = 'end',
  onOpenAutoFocus
}: {
  children: ReactNode
  className?: string
  align?: 'start' | 'center' | 'end'
  onOpenAutoFocus?: (e: Event) => void
}): React.JSX.Element {
  return (
    <P.Portal>
      <P.Content
        align={align}
        sideOffset={6}
        collisionPadding={12}
        onOpenAutoFocus={onOpenAutoFocus}
        className={cn('z-50 rounded-xl border border-line bg-surface p-4 shadow-pop focus:outline-none data-[state=open]:animate-pop-in', className)}
      >
        {children}
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
