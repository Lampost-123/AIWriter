import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

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
  return (
    <div className={cn('mx-auto flex max-w-sm flex-col items-center px-6 py-12 text-center animate-fade-in', className)}>
      {icon ? <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-surface-2 text-muted">{icon}</div> : null}
      <h3 className="text-[15px] font-semibold text-fg">{title}</h3>
      {children ? <div className="mt-1.5 text-[13px] leading-relaxed text-muted">{children}</div> : null}
      {actions ? <div className="mt-4 flex flex-wrap justify-center gap-2">{actions}</div> : null}
    </div>
  )
}

export function Card({ className, children }: { className?: string; children: ReactNode }): React.JSX.Element {
  return <div className={cn('rounded-xl border border-line bg-surface shadow-soft', className)}>{children}</div>
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
    <section className={className}>
      <div className="mb-3 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="min-w-0 truncate text-[15px] font-semibold text-fg">{title}</h2>
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
