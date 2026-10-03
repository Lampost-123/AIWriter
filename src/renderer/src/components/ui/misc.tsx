import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { useNewLook } from '@/features/look/look'

export function EmptyState({
  icon,
  title,
  children,
  actions,
  className
}: {
  icon?: ReactNode
  title: string
  children?: ReactNode
  actions?: ReactNode
  className?: string
}): React.JSX.Element {
  const isNew = useNewLook()
  return (
    <div className={cn('mx-auto flex max-w-sm flex-col items-center px-6 py-12 text-center animate-fade-in', className)}>
      {icon && isNew ? (
        <SpotArt>{icon}</SpotArt>
      ) : icon ? (
        <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-surface-2 text-muted">{icon}</div>
      ) : null}
      <h3 className="text-[15px] font-semibold text-fg look-new:font-heading look-new:text-[19px] look-new:tracking-[-0.01em]">{title}</h3>
      {children ? <div className="mt-1.5 text-[13px] leading-relaxed text-muted">{children}</div> : null}
      {actions ? <div className="mt-4 flex flex-wrap justify-center gap-2">{actions}</div> : null}
    </div>
  )
}

/**
 * The New look's spot picture for an empty page: the page's own icon on a raised tile, with two sheets of paper
 * fanned behind it and a little of the accent's light, all in the theme's colours.
 */
function SpotArt({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <div aria-hidden data-spot className="relative mb-5 h-[92px] w-[132px]">
      <span className="absolute inset-x-2 bottom-1 h-10 rounded-full bg-accent-soft opacity-70 blur-xl" />
      <span className="absolute left-[22px] top-[10px] h-[72px] w-[58px] -rotate-[9deg] rounded-[10px] bg-surface-2 shadow-[var(--elev-1),inset_0_0_0_1px_var(--line)]" />
      <span className="absolute right-[22px] top-[8px] h-[72px] w-[58px] rotate-[8deg] rounded-[10px] bg-page shadow-[var(--elev-1),inset_0_0_0_1px_var(--line)]">
        <i className="absolute left-2.5 right-3 top-4 h-[3px] rounded-full bg-line-strong" />
        <i className="absolute left-2.5 right-5 top-[26px] h-[3px] rounded-full bg-line" />
        <i className="absolute left-2.5 right-4 top-9 h-[3px] rounded-full bg-line" />
      </span>
      <span className="absolute left-1/2 top-[22px] grid h-[52px] w-[52px] -translate-x-1/2 place-items-center rounded-2xl bg-raise text-accent shadow-e2 [&_svg]:h-6 [&_svg]:w-6">
        {children}
      </span>
      <span className="absolute right-3 top-0 h-1.5 w-1.5 rounded-full bg-ai opacity-70" />
      <span className="absolute left-4 top-3 h-1 w-1 rounded-full bg-accent opacity-60" />
    </div>
  )
}

export function Card({ className, children }: { className?: string; children: ReactNode }): React.JSX.Element {
  return (
    <div
      className={cn(
        'rounded-xl border border-line bg-surface shadow-soft',
        // The New look: a raised card with a hairline ring.
        'look-new:rounded-card look-new:border-transparent look-new:bg-raise look-new:shadow-[var(--elev-1),inset_0_0_0_1px_var(--line)]',
        className
      )}
    >
      {children}
    </div>
  )
}

export function Badge({ tone = 'neutral', children, className }: { tone?: 'neutral' | 'accent' | 'ai' | 'danger' | 'success'; children: ReactNode; className?: string }): React.JSX.Element {
  const tones = {
    neutral: 'bg-surface-2 text-muted',
    accent: 'bg-accent-soft text-accent',
    ai: 'bg-ai-soft text-ai',
    danger: 'bg-danger-soft text-danger',
    success: 'bg-success-soft text-success'
  }
  return <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11.5px] font-medium', tones[tone], className)}>{children}</span>
}

/**
 * One section of a Settings page (Models, Backups, About...). Every page uses it, so headings
 * have one size, weight and spacing throughout Settings. `actions` sit to the right of the heading.
 */
export function SettingsSection({
  title,
  description,
  badge,
  actions,
  children,
  className
}: {
  title: ReactNode
  description?: ReactNode
  badge?: ReactNode
  actions?: ReactNode
  children?: ReactNode
  className?: string
}): React.JSX.Element {
  return (
    // The New look: each section is a card of its own.
    <section
      className={cn('look-new:rounded-card look-new:bg-raise look-new:p-5 look-new:shadow-[var(--elev-1),inset_0_0_0_1px_var(--line)]', className)}
    >
      <div className="mb-3 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="min-w-0 truncate text-[15px] font-semibold text-fg look-new:font-heading look-new:text-[17px]">{title}</h2>
            {badge}
          </div>
          {description ? <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  )
}

/** A small label inside a card or panel (not a page section: use SettingsSection for those). */
export function SectionTitle({ children, actions }: { children: ReactNode; actions?: ReactNode }): React.JSX.Element {
  return (
    <div className="mb-2 flex items-center justify-between">
      <h4 className="text-[11.5px] font-semibold uppercase tracking-wide text-faint">{children}</h4>
      {actions}
    </div>
  )
}

/** A notice in plain words with an optional next step. */
export function Notice({ tone = 'neutral', children, action }: { tone?: 'neutral' | 'danger' | 'ai' | 'success'; children: ReactNode; action?: ReactNode }): React.JSX.Element {
  const tones = {
    neutral: 'border-line bg-surface-2 text-fg',
    danger: 'border-danger/30 bg-danger-soft text-fg',
    ai: 'border-ai/30 bg-ai-soft text-fg',
    success: 'border-success/30 bg-success-soft text-fg'
  }
  return (
    <div className={cn('flex items-start gap-3 rounded-lg border px-3 py-2.5 text-[13px] leading-relaxed animate-fade-in', tones[tone])}>
      <div className="flex-1">{children}</div>
      {action}
    </div>
  )
}

export function Kbd({ children }: { children: ReactNode }): React.JSX.Element {
  return <kbd className="rounded border border-line bg-surface-2 px-1 py-px font-sans text-[11px] text-muted">{children}</kbd>
}
