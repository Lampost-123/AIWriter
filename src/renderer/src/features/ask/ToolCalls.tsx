// The tool activity over an answer (chat Phase 2b, Adam: "a way to see when the chat called a tool"; it replaces the
// steps row). One row of a fixed height from the moment the question is asked, so nothing under it moves: the AI's
// mark, then while the answer is written what it is doing now ("Reading Ch 2, Sc 1…", with a shimmer) over a list of
// its calls as they start (a spinner each while it runs, then ✓ or ✗ and how long it took); once the answer has
// ended, one line ("[icons] 3 tool calls · 4s") that opens the list again, or the list kept open (the ⋯ menu's
// "Tool calls"). A call's row opens to what it was asked with and what came back (monospace, scrolling in place, with
// Copy). The calls are one block above the answer, in the order they were made: what the model wrote between calls
// is in the answer below, not threaded between the rows.
import { useEffect, useId, useState } from 'react'
import type { ToolActivity, ToolKind } from '@shared/toolActivity'
import {
  BookOpen,
  BookOpenText,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  CircleSlash,
  CircleX,
  Copy,
  Feather,
  ListTree,
  MessageSquareWarning,
  Palette,
  PenLine,
  Search,
  UserRound,
  Wrench,
  type IconType
} from '@/components/ui/icons'
import { Spinner } from '@/components/ui/Spinner'
import { cn } from '@/lib/cn'
import { KIND_ICONS } from '@/features/world/kindIcons'
import { ENTRY_KINDS } from '@shared/fields'
import type { EntryKind } from '@shared/types'
import { useAskPrefs } from './askPrefs'
import { instantMotion } from './inputMode'
import { callMs, callTime, failureWords, kindsOf, prettyArgs, rowLabel, STATUS_WORDS, toolPhrase, toolsSummary } from './toolView'

export const TOOL_ICONS: Record<ToolKind, IconType> = {
  read: BookOpenText,
  outline: ListTree,
  search: Search,
  entry: UserRound,
  style: Palette,
  issues: MessageSquareWarning,
  propose: PenLine,
  draft: Feather,
  ask: CircleHelp,
  other: Wrench
}

/** A look-up's icon: the kind of entry it found, when it says (its outcome starts with the kind), else a person. */
function iconOf(c: Pick<ToolActivity, 'kind' | 'outcome'>): IconType {
  if (c.kind === 'entry') {
    const word = c.outcome.split(/[,\s]/)[0]?.toLowerCase() as EntryKind
    if ((ENTRY_KINDS as readonly string[]).includes(word)) return KIND_ICONS[word]
  }
  return TOOL_ICONS[c.kind]
}

/**
 * The AI's mark at the head of each answer: the lamp room of the app's lighthouse (components/ui/Lighthouse.tsx), its
 * light glowing softly while the answer is written. Drawn in the theme's own colours.
 */
export function AskMark({ live, size = 18 }: { live: boolean; size?: number }): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} aria-hidden className="shrink-0" data-ask-mark>
      <rect x="0.5" y="0.5" width="19" height="19" rx="6" fill="var(--ai-soft)" />
      <path d="M5.8 8.3 L10 4.4 L14.2 8.3 Z" fill="var(--ai)" opacity="0.9" />
      <rect x="6.7" y="8.7" width="6.6" height="5.2" rx="1.2" fill="none" stroke="var(--ai)" strokeWidth="1.2" />
      <circle cx="10" cy="11.3" r="1.45" fill="var(--ai)" className={live ? 'animate-pulse' : undefined} />
      <path d="M7.9 13.9 L7.3 16.6 H12.7 L12.1 13.9 Z" fill="var(--ai)" opacity="0.45" />
    </svg>
  )
}

/** A call's ✓ / ✗ / spinner and how long it took, at the row's end. */
function CallStatus({ c }: { c: ToolActivity }): React.JSX.Element {
  const ms = callMs(c)
  const time = ms !== null && c.status !== 'running' ? <span className="tabular-nums text-faint">{callTime(ms)}</span> : null
  switch (c.status) {
    case 'running':
      return <Spinner size={12} className="text-ai" />
    case 'done':
      return (
        <>
          <CheckCircle2 size={13} aria-hidden className="text-success" />
          {time}
        </>
      )
    case 'failed':
      return (
        <>
          <CircleX size={13} aria-hidden className="text-danger" />
          {time}
        </>
      )
    case 'not-proposed':
      return (
        <>
          <span className="flex items-center gap-1 text-danger">
            <CircleSlash size={11} aria-hidden /> not proposed
          </span>
          {time}
        </>
      )
    case 'stopped':
      return <span className="text-faint">{STATUS_WORDS.stopped}</span>
  }
}

function copyText(c: ToolActivity): string {
  return `${toolPhrase(c)}\n\nAsked with:\n${prettyArgs(c.arguments)}\n\nCame back:\n${c.result || '(nothing yet)'}`
}

/** One call: its icon, what it did, how it went; opens to what it was asked with and what came back. */
function CallRow({ c, fades }: { c: ToolActivity; fades: boolean }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const id = useId()
  const Icon = iconOf(c)
  const wrong = c.status === 'failed' || c.status === 'not-proposed'
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(t)
  }, [copied])
  return (
    <li data-tool-call={c.id} data-tool={c.tool} data-status={c.status} className={cn('flex flex-col', fades && 'animate-fade-in')}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={rowLabel(c, open)}
        onClick={() => setOpen((o) => !o)}
        className="group/row -mx-1 flex h-6 min-w-0 items-center gap-2 rounded-md px-1 text-left text-[12.5px] transition-colors duration-150 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-focus"
      >
        <Icon size={13} aria-hidden className={cn('shrink-0', wrong ? 'text-danger' : c.status === 'running' ? 'text-ai' : 'text-faint')} />
        <span className={cn('min-w-0 flex-1 truncate', wrong ? 'text-danger' : 'text-muted', c.status === 'running' && 'ask-shimmer')} title={toolPhrase(c)}>
          {toolPhrase(c)}
        </span>
        <span className="flex shrink-0 items-center gap-1.5 text-[11.5px]">
          <CallStatus c={c} />
        </span>
        <ChevronRight size={11} aria-hidden className={cn('shrink-0 text-faint transition-transform duration-150', open && 'rotate-90')} />
      </button>
      <div id={id} hidden={!open} data-tool-details className="mb-1.5 ml-[21px] mt-0.5 flex flex-col gap-1.5">
        <div className="flex min-w-0 items-center gap-2 text-[11.5px] text-faint">
          <span className="min-w-0 flex-1 truncate">
            {[c.outcome, c.step ? `request ${c.step}` : '', c.tool].filter(Boolean).join(' · ')}
          </span>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(copyText(c)).then(() => setCopied(true), () => undefined)
            }}
            aria-label={`Copy what ${toolPhrase(c)} was asked with and what came back`}
            className="flex h-5 shrink-0 items-center gap-1 rounded-md px-1 text-faint transition-colors duration-150 hover:bg-surface-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-focus"
          >
            {copied ? <Check size={11} aria-hidden /> : <Copy size={11} aria-hidden />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <Detail label="Asked with" text={prettyArgs(c.arguments)} />
        <Detail label="Came back" text={c.status === 'running' ? '(still running)' : c.result || '(nothing)'} />
      </div>
    </li>
  )
}

function Detail({ label, text }: { label: string; text: string }): React.JSX.Element {
  return (
    <div className="min-w-0">
      <div className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-faint">{label}</div>
      <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md border border-line bg-page px-2 py-1.5 font-mono text-[11.5px] leading-[1.5] text-muted">
        {text}
      </pre>
    </div>
  )
}

/** The icons of the kinds of call an answer made, side by side (the folded line's start). */
function KindIcons({ tools }: { tools: ToolActivity[] }): React.JSX.Element {
  return (
    <span className="flex shrink-0 items-center gap-0.5 text-faint" aria-hidden>
      {kindsOf(tools).map((k) => {
        const Icon = TOOL_ICONS[k]
        return <Icon key={k} size={12} />
      })}
    </span>
  )
}

export function ToolCalls({
  tools,
  live,
  ms,
  compact
}: {
  tools: ToolActivity[]
  /** While the answer is written: what it is doing now ("Reading Ch 1, Sc 1…", "Answering…"); null once it has ended. */
  live: string | null
  /** How long the answer took, when this session saw it start and end. */
  ms: number | null
  compact: boolean
}): React.JSX.Element | null {
  const pref = useAskPrefs((s) => s.toolsView)
  // Adam's own opening or folding wins; else open while the answer is written, then as the ⋯ menu says.
  const [chosen, setChosen] = useState<boolean | null>(null)
  const listId = useId()
  const [fades] = useState(() => !!live && !instantMotion())
  const summary = live ? null : toolsSummary(tools, ms)
  if (!live && !summary) return null
  const has = tools.length > 0
  const open = has && (chosen ?? (!!live || pref === 'open'))
  const said = live ? failureWords(tools) : ''
  const head = live ? (
    <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] font-medium" data-running>
      <span className="ask-shimmer truncate">{live}</span>
    </span>
  ) : has ? (
    <span className="flex min-w-0 items-center gap-1.5">
      <KindIcons tools={tools} />
      <span className="truncate">{summary}</span>
    </span>
  ) : (
    <span className="flex min-w-0 items-center gap-1.5">
      <BookOpen size={12} aria-hidden className="shrink-0" />
      <span className="truncate">{summary}</span>
    </span>
  )
  return (
    <div data-steps data-tools-open={open ? '' : undefined} className="mb-2">
      <div className="flex h-6 items-center gap-2">
        <AskMark live={!!live} size={compact ? 16 : 18} />
        {has ? (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={listId}
            aria-label={`${live ?? summary}. ${open ? 'Hide' : 'Show'} the tool calls`}
            onClick={() => setChosen(!open)}
            className="-ml-1 inline-flex h-6 min-w-0 items-center gap-1 rounded-md px-1 text-[12px] text-faint transition-colors duration-150 hover:bg-surface-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-focus"
            data-tools-toggle
          >
            <ChevronRight size={12} aria-hidden className={cn('shrink-0 transition-transform duration-150', open && 'rotate-90')} />
            {head}
          </button>
        ) : (
          <span className="flex min-w-0 text-[12px] text-faint">{head}</span>
        )}
      </div>
      {/* A call that goes wrong while the answer is written is said politely. */}
      <span role="status" className="sr-only">
        {said}
      </span>
      {has ? (
        // Folding closes the list's height smoothly (at once under reduced motion); folded, it is out of reach.
        <div className={cn('grid transition-[grid-template-rows,visibility] duration-200 ease-out', open ? 'visible grid-rows-[1fr]' : 'invisible grid-rows-[0fr]')}>
          <div className="min-h-0 overflow-hidden">
            <ol id={listId} aria-label="Tool calls" className="ml-[8px] mt-1 flex flex-col border-l border-line pl-3">
              {tools.map((c) => (
                <CallRow key={c.id} c={c} fades={fades} />
              ))}
            </ol>
          </div>
        </div>
      ) : null}
    </div>
  )
}
