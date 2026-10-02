// Small pieces the builder's screens share.
import { Check, CircleDashed, Sparkles } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import type { Entry } from '@shared/types'
import { Button, Notice } from '@/components/ui'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import type { StepStatus } from './builderLogic'

/** Every entry in the world, reloaded when entries change; null until first loaded. */
export function useWorldEntries(): Entry[] | null {
  const rev = useApp((s) => s.entriesRev)
  const [list, setList] = useState<Entry[] | null>(null)
  useEffect(() => {
    let live = true
    api
      .listEntries()
      .then((all) => live && setList(all))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [rev])
  return list
}

/** The button a message about the model needs: to Settings › Models when that's where the fix is. */
export function settingsAction(message: string, code?: string): { label: string; run: () => void } | undefined {
  if (code === 'no-writer-model' || code === 'no-key' || /\bSettings\b/.test(message)) {
    return { label: 'Open Settings', run: () => useApp.getState().navigate({ kind: 'settings', tab: 'models' }) }
  }
  return undefined
}

/** A plain-words problem with its next step: Try again, and Settings when the fix is there. */
export function ProblemNotice({ message, code, onRetry }: { message: string; code?: string; onRetry?: () => void }): React.JSX.Element {
  const settings = settingsAction(message, code)
  return (
    <div role="alert">
      <Notice
        tone="danger"
        action={
          <div className="flex shrink-0 gap-1.5">
            {settings ? (
              <Button size="sm" onClick={settings.run}>
                {settings.label}
              </Button>
            ) : null}
            {onRetry ? (
              <Button size="sm" onClick={onRetry}>
                Try again
              </Button>
            ) : null}
          </div>
        }
      >
        {message}
      </Notice>
    </div>
  )
}

/** A step's progress on the rail: an empty ring, a half-filled one, or a tick. */
export function StatusIcon({ status, className }: { status: StepStatus; className?: string }): React.JSX.Element {
  if (status === 'complete') {
    return (
      <span aria-hidden className={cn('flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-success text-page', className)}>
        <Check size={10} strokeWidth={3} />
      </span>
    )
  }
  if (status === 'partly') {
    return (
      <span aria-hidden className={cn('relative h-4 w-4 shrink-0 overflow-hidden rounded-full border-[1.5px] border-accent', className)}>
        <span className="absolute inset-y-0 left-0 w-1/2 bg-accent" />
      </span>
    )
  }
  return <CircleDashed aria-hidden size={16} className={cn('shrink-0 text-faint', className)} />
}

/** The quiet line under a field saying its words are the AI's, or were until Adam changed them. */
export function MarkLine({ mark, children }: { mark: 'ai' | 'edited' | 'notes' | null; children?: ReactNode }): React.JSX.Element {
  const base = 'flex min-h-[18px] min-w-0 items-center gap-1.5 text-[12px] text-faint'
  if (mark === 'ai') {
    return (
      <span className={base}>
        <Sparkles size={11} className="shrink-0 text-ai" aria-hidden />
        Drafted by AI
      </span>
    )
  }
  if (mark === 'edited') {
    return (
      <span className={base}>
        <Check size={11} className="shrink-0" aria-hidden />
        Changed by you
      </span>
    )
  }
  if (mark === 'notes') {
    return (
      <span className={base}>
        <Check size={11} className="shrink-0" aria-hidden />
        Your words
      </span>
    )
  }
  return <span className={base}>{children}</span>
}

/** "Writing…" with the amber light, as drafting shows it. */
export function WritingStatus({ text, title }: { text: string; title?: string }): React.JSX.Element {
  return (
    <span role="status" title={title} className="flex min-w-0 items-center gap-2 text-[12.5px] font-medium text-ai animate-fade-in">
      <span className="h-2 w-2 shrink-0 rounded-full bg-ai animate-pulse" aria-hidden />
      <span className="truncate">{text}</span>
    </span>
  )
}

/** A small button inside an amber suggestion (Keep, Discard, Use this), sized so the box matches a text box. */
export function SuggestionButton({
  primary,
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean }): React.JSX.Element {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex h-6 shrink-0 items-center justify-center rounded px-2 text-[12.5px] font-medium transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50',
        primary ? 'border border-line bg-surface text-fg shadow-sm hover:border-line-strong hover:bg-surface-2' : 'text-muted hover:bg-surface hover:text-fg',
        className
      )}
      {...rest}
    />
  )
}
