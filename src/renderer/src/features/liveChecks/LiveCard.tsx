// The small card over a live underline: what the check found, in a plain sentence, and what Adam can do
// about it (Change to Mara, Rewrite, Fix, Ignore). Like the card over a name (features/editor/names/
// HoverCard.tsx): always the same size, so nothing in it moves; in a portal, so the page never shifts;
// pressing on it never moves the caret. It takes the keyboard only when Adam asks (Tab from the page);
// Esc then gives it back.
import { forwardRef } from 'react'
import { createPortal } from 'react-dom'
import { WandSparkles } from '@/components/ui/icons'
import { SLOP_GROUPS } from '@shared/slop'
import { Button } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { PlacedFlag } from './liveDecorations'

export const LIVE_CARD_WIDTH = 300
/** Room for the kind, a message of two lines and the buttons. */
export const LIVE_CARD_HEIGHT = 124
const GAP = 6
const MARGIN = 8

const KIND_WORDS: Record<PlacedFlag['kind'], string> = {
  spelling: 'Name spelling',
  phrase: 'Phrase to avoid',
  ai: 'Common AI phrase',
  repetition: 'Repeated nearby'
}

/** The card's heading: the kind, and for a common AI phrase its group ("Common AI phrase · Stock body reaction"). */
export const liveCardHeading = (flag: Pick<PlacedFlag, 'kind' | 'group'>): string =>
  flag.kind === 'ai' && flag.group ? `${KIND_WORDS.ai} · ${SLOP_GROUPS[flag.group]}` : KIND_WORDS[flag.kind]

/** Where the card goes for a word: just below it, or above when there's no room below, kept inside the window. */
export function liveCardPosition(word: DOMRect, view: { width: number; height: number }): { left: number; top: number } {
  const below = word.bottom + GAP
  const top = below + LIVE_CARD_HEIGHT <= view.height - MARGIN ? below : Math.max(MARGIN, word.top - GAP - LIVE_CARD_HEIGHT)
  const left = Math.min(Math.max(MARGIN, word.left - 12), view.width - LIVE_CARD_WIDTH - MARGIN)
  return { left, top }
}

/** True for the key that takes the keyboard from the page into the card. */
export const movesIntoCard = (e: KeyboardEvent): boolean => e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey

/** True for the key that closes the card. */
export const closesCard = (e: KeyboardEvent): boolean => e.key === 'Escape'

interface Props {
  flag: PlacedFlag
  at: { left: number; top: number }
  onChange: () => void
  onRewrite: () => void
  onIgnore: () => void
  onEnter: () => void
  onLeave: () => void
  /** Esc in the card: it closes and the page takes the keyboard back. */
  onEscape: () => void
}

export const LiveCard = forwardRef<HTMLDivElement, Props>(function LiveCard(
  { flag, at, onChange, onRewrite, onIgnore, onEnter, onLeave, onEscape },
  ref
) {
  return createPortal(
    <div
      ref={ref}
      role="group"
      aria-label={liveCardHeading(flag)}
      data-hover-card=""
      data-live-card={flag.kind}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      // Pressing on it keeps the caret and the selection in the page (and never reaches the page behind).
      onMouseDown={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          onEscape()
          return
        }
        // Tab and Shift+Tab stay among the card's buttons.
        if (e.key !== 'Tab') return
        const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
        if (!buttons.length) return
        const i = buttons.indexOf(document.activeElement as HTMLButtonElement)
        e.preventDefault()
        buttons[(i + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length].focus()
      }}
      style={{ left: at.left, top: at.top, width: LIVE_CARD_WIDTH, height: LIVE_CARD_HEIGHT }}
      className="fixed z-50 flex select-none flex-col rounded-xl border border-line bg-surface px-3.5 pb-3 pt-3 text-left shadow-pop animate-fade-in"
    >
      <p className="flex h-4 shrink-0 items-center gap-1.5 text-[12px] leading-4 text-faint">
        <span aria-hidden className={cn('aw-live-swatch', `aw-live-swatch-${flag.kind}`)} />
        <span className="min-w-0 truncate">{liveCardHeading(flag)}</span>
      </p>
      <p className="mt-1.5 line-clamp-2 h-10 shrink-0 text-[13.5px] leading-5 text-fg">{flag.message}</p>
      <div className="mt-auto flex items-center gap-1.5">
        {flag.kind === 'spelling' && flag.suggestion ? (
          <Button size="sm" onClick={onChange} className="min-w-0">
            <span className="truncate">Change to {flag.suggestion}</span>
          </Button>
        ) : null}
        {flag.kind === 'phrase' ? (
          <Button
            size="sm"
            icon={<WandSparkles size={14} className="text-ai" aria-hidden />}
            onClick={onRewrite}
            title="The AI rewrites the sentence without it, as a change to accept or reject"
          >
            Rewrite
          </Button>
        ) : null}
        {flag.kind === 'ai' ? (
          <Button
            size="sm"
            icon={<WandSparkles size={14} className="text-ai" aria-hidden />}
            onClick={onRewrite}
            title="The AI rewrites the sentence without the stock phrase, as a change to accept or reject"
          >
            Fix
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          onClick={onIgnore}
          // On its own, it lines up with the words above.
          className={cn(flag.kind === 'repetition' && '-ml-2.5')}
          title="Mark it as intended: it won’t be flagged again"
        >
          Ignore
        </Button>
      </div>
    </div>,
    document.body
  )
})
