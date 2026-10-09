// Small pieces the builder's screens share.
import { AlertTriangle, Check, Sparkles } from '@/components/ui/icons'
import { useEffect, useLayoutEffect, useMemo, useState, type ReactNode, type RefObject } from 'react'
import type { BuilderKind } from '@shared/contracts/builder'
import type { Entry, ID } from '@shared/types'
import { Button, Notice } from '@/components/ui'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { findNearDuplicates, kindNoun, withArticle } from '@/features/world/entryLogic'
import { splitAliases } from './builderLogic'

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

/** The width of an element, kept up to date as the window or a panel beside it changes; 0 until measured. */
export function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.offsetWidth)
    const ro = new ResizeObserver(() => setWidth(el.offsetWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return width
}

/**
 * "Very close to Mara, another character. Same one?", with a button to open the other one, when the
 * name (or an alias) is the same as or very like another entry's, as the entry page warns. Nothing
 * when it isn't. It has lines of its own under the name and wraps, so all of it can be read in the
 * narrowest window.
 */
export function DuplicateHint({
  kind,
  entryId,
  name,
  aliases,
  entries,
  className
}: {
  kind: BuilderKind
  /** The entry being built, once it exists, so it isn't counted as a duplicate of itself. */
  entryId: ID | null
  name: string
  aliases: string
  /** Every entry in the world, or null while loading. */
  entries: Entry[] | null
  className?: string
}): React.JSX.Element | null {
  const dups = useMemo(
    () => (entries && name.trim() ? findNearDuplicates({ id: entryId ?? '', kind, name, aliases: splitAliases(aliases) }, entries) : []),
    [entries, entryId, kind, name, aliases]
  )
  const d = dups[0]
  if (!d) return null
  const other = d.entry
  const otherName = other.name.trim()
  const what = other.kind === kind ? `another ${kindNoun(kind)}` : withArticle(kindNoun(other.kind))
  const more = dups.length > 1 ? `, and ${dups.length - 1} more` : ''
  const text =
    d.reason === 'same'
      ? `There’s already ${what} called ${otherName}${more}.`
      : d.reason === 'similar'
        ? `Very close to ${otherName}, ${what}${more}.`
        : `Shares a name with ${otherName}, ${what}${more}.`
  return (
    <div
      role="status"
      title="If they’re the same, keep one, so the AI doesn’t mix them up."
      className={cn('flex min-w-0 animate-fade-in items-start gap-1.5 leading-[18px] text-ai', className)}
    >
      <AlertTriangle size={13} className="mt-[2.5px] shrink-0" aria-hidden />
      <span className="min-w-0">
        {text} Same one?{' '}
        <button
          type="button"
          onClick={() => useApp.getState().navigate({ kind: 'entries', entryKind: other.kind, entryId: other.id })}
          className="whitespace-nowrap rounded-sm font-medium underline-offset-2 hover:underline"
        >
          Open {otherName}
        </button>
      </span>
    </div>
  )
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
        primary
          ? 'border border-line bg-surface text-fg shadow-sm hover:border-line-strong hover:bg-surface-2'
          : 'text-muted hover:bg-surface hover:text-fg',
        className
      )}
      {...rest}
    />
  )
}
