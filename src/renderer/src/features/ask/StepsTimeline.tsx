// The steps row over an answer (chat overhaul Phase 2): one row of a fixed height from the moment the question is
// asked, so nothing under it moves. While the answer is written it says what the chat is doing now ("Reading Ch 2,
// Sc 1…", with a shimmer); once it has ended it folds to "Looked at 3 things · 4s ›", which opens a list of the steps,
// an icon each for what the step did.
import { useId, useState } from 'react'
import {
  AlertTriangle,
  BookOpenText,
  ChevronRight,
  ListTree,
  MessageCircleQuestion,
  MessageSquareWarning,
  Palette,
  PenLine,
  Search,
  Sparkles,
  UserRound,
  type IconType
} from '@/components/ui/icons'
import { cn } from '@/lib/cn'
import { stepKind, stepsSummary, type StepKind } from './answerView'

const STEP_ICONS: Record<StepKind, IconType> = {
  read: BookOpenText,
  outline: ListTree,
  search: Search,
  entry: UserRound,
  style: Palette,
  issues: MessageSquareWarning,
  propose: PenLine,
  ask: MessageCircleQuestion,
  error: AlertTriangle,
  other: Sparkles
}

export function StepsTimeline({
  steps,
  live,
  ms
}: {
  steps: string[]
  /** While the answer is written: what it is doing now ("Answering…", "Stopping…"); null once it has ended. */
  live: string | null
  /** How long the answer took, when this session saw it start and end. */
  ms: number | null
}): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const listId = useId()
  const summary = live ? null : stepsSummary(steps, ms)
  if (!live && !summary) return null
  const canOpen = steps.length > 0
  const label = live ? (
    <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] font-medium" data-running>
      <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-ai" aria-hidden />
      <span className="ask-shimmer truncate">{live}</span>
    </span>
  ) : (
    <span className="truncate">{summary}</span>
  )
  return (
    <div data-steps className="mb-2 px-1">
      <div className="flex h-6 items-center">
        {canOpen ? (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={listId}
            aria-label={`${live ?? summary}. ${open ? 'Hide' : 'Show'} the steps`}
            onClick={() => setOpen((o) => !o)}
            className="-ml-1 inline-flex h-6 min-w-0 items-center gap-1 rounded-md px-1 text-[12px] text-faint transition-colors duration-150 hover:bg-surface-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-focus"
          >
            <ChevronRight size={12} aria-hidden className={cn('shrink-0 transition-transform duration-150', open && 'rotate-90')} />
            {label}
          </button>
        ) : (
          <span className="flex min-w-0 text-[12px] text-faint">{label}</span>
        )}
      </div>
      {/* Kept in the page while folded (hidden), so what was looked at can still be read and found. */}
      <ol id={listId} hidden={!open} aria-label="Steps" className="ml-[7px] mt-1 flex flex-col border-l border-line pl-3">
        {steps.map((s, i) => {
          const kind = stepKind(s)
          const Icon = STEP_ICONS[kind]
          const running = !!live && i === steps.length - 1
          return (
            <li
              key={i}
              data-step-state={running ? 'running' : kind === 'error' ? 'error' : 'done'}
              className={cn('flex min-h-6 items-center gap-2 text-[12.5px] leading-snug', kind === 'error' ? 'text-danger' : 'text-muted')}
            >
              <Icon size={13} aria-hidden className="shrink-0 opacity-80" />
              <span className={cn('min-w-0 break-words', running && 'ask-shimmer')}>{s}</span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
