// One scene idea, and the foot under a set of them (review #38, 2026-10-21): the same card and the same buttons wherever
// Adam asks for ideas for a scene (the board's ideas drawer, the story home, a scene's row in Build with AI and the scene
// card). The card: its title (or "Idea two"), what happens, its beats, Use this once it has all arrived, and Dismiss
// where ideas can be put away. The foot: Stop while the ideas are written, else Three more ideas.
import { useRef, type ReactNode } from 'react'
import { Plus, Sparkles, Square } from '@/components/ui/icons'
import { Button } from '@/components/ui'
import { cn } from '@/lib/cn'
import { FreshText } from '@/features/planning/FreshText'
import { useDealDelay } from '@/features/planning/deal'
import type { SceneIdea } from './parse'
import '@/features/planning/planning.css'

const NUMBER = ['one', 'two', 'three', 'four', 'five']

/** An idea's name: its title, else "Idea one". */
export const ideaTitle = (idea: SceneIdea, n: number): string => idea.title.trim() || `Idea ${NUMBER[n] ?? n + 1}`

export function IdeaCard({
  idea,
  n,
  live,
  onUse,
  onDismiss,
  beats = 'line',
  useTitle,
  leaving = false,
  extra
}: {
  idea: SceneIdea
  /** Its place in the set, from 0. */
  n: number
  /** The answer is still arriving: new words fade in. */
  live: boolean
  /** Use this (left out where an idea can't be used from here). */
  onUse?: (el: HTMLElement | null) => void
  onDismiss?: () => void
  /** Every beat as a list (the scene card), or how many with the first (elsewhere). */
  beats?: 'list' | 'line'
  /** Use this's tooltip. */
  useTitle?: string
  /** Being put away: it fades out at the exit speed. */
  leaving?: boolean
  /** At the end of its actions (the board's faces of who is in it). */
  extra?: ReactNode
}): React.JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  // Ideas that show together are dealt in one after another; one arriving while the AI writes lands at once.
  const deal = useDealDelay()
  const title = ideaTitle(idea, n)
  const writing = live && !idea.complete
  return (
    <div
      ref={box}
      className={cn(
        'plan-idea plan-deal rounded-lg border border-ai/25 bg-ai-soft px-3 py-2.5',
        writing && 'is-writing',
        leaving && 'pointer-events-none opacity-0 transition-opacity duration-[var(--dur-exit)]'
      )}
      style={deal}
      data-idea
    >
      <p className="plan-idea-t break-words font-serif text-[14px] font-semibold leading-snug text-fg">
        <FreshText text={title} live={live} />
      </p>
      {idea.summary ? (
        <p className="mt-1 break-words text-[13px] leading-relaxed text-fg">
          <FreshText text={idea.summary} live={live} />
        </p>
      ) : null}
      {idea.beats.length ? (
        beats === 'list' ? (
          <ol className="mt-1.5 list-decimal space-y-0.5 pl-4 text-[12.5px] leading-relaxed text-muted marker:text-faint">
            {idea.beats.map((b, i) => (
              <li key={i} className="break-words pl-0.5">
                <FreshText text={b} live={live} />
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-1 break-words text-[12.5px] leading-relaxed text-muted">
            {idea.beats.length === 1 ? '1 beat' : `${idea.beats.length} beats`}: {idea.beats[0]}
            {idea.beats.length > 1 ? '…' : ''}
          </p>
        )
      ) : null}
      {onUse || onDismiss || extra ? (
        // Its room is kept while it is written, so nothing moves when the buttons appear.
        <div className={cn('mt-2 flex items-center gap-3', writing && 'invisible')} aria-hidden={writing || undefined}>
          {onUse ? (
            <Button size="sm" variant="ai" className="plan-use" icon={<Plus size={12} />} disabled={!idea.complete} title={useTitle} onClick={() => onUse(box.current)} aria-label={`Use “${title}”`}>
              Use this
            </Button>
          ) : null}
          {onDismiss ? (
            <button type="button" className="rounded text-[12.5px] font-medium text-muted outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/40" onClick={onDismiss} aria-label={`Dismiss “${title}”`}>
              Dismiss
            </button>
          ) : null}
          {extra ? <span className="ml-auto flex items-center gap-1">{extra}</span> : null}
        </div>
      ) : null}
    </div>
  )
}

/** Under a set of ideas: Stop while they are written, else Three more ideas (Suggest three ideas before any). */
export function IdeasFooter({
  running,
  hasIdeas,
  onMore,
  onStop,
  children,
  className
}: {
  running: boolean
  /** Ideas have come before (shown, used or put away). */
  hasIdeas: boolean
  onMore: () => void
  onStop: () => void
  /** Beside the button (a line on what happens, What the AI saw). */
  children?: ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1.5', className)}>
      {running ? (
        <Button size="sm" icon={<Square size={10} fill="currentColor" />} onClick={onStop} title="Stop. The ideas that have arrived stay.">
          Stop
        </Button>
      ) : (
        <Button size="sm" variant={hasIdeas ? 'secondary' : 'ai'} icon={<Sparkles size={13} />} onClick={onMore} data-ask-ideas>
          {hasIdeas ? 'Three more ideas' : 'Suggest three ideas'}
        </Button>
      )}
      {children}
    </div>
  )
}
