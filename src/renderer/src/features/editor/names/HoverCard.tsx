// The small card over a name in the page: the portrait, name, one-liner and how it stands as of
// this scene. Always the same size, so nothing in it moves as it fills in; it never takes keyboard
// focus, and clicking it shows the entry beside the page (as Ctrl+click on the name does).
import { createPortal } from 'react-dom'
import type { NamedEntry } from '@shared/contracts/manuscript'
import { modKey } from '@/lib/api'
import { Portrait } from '@/features/views/Portrait'
import { cardLines, displayName, kindWord, noStateWords, whereWords } from '@/features/peek/entryView'

export const CARD_WIDTH = 304
/** Room for the portrait row, a one-liner of two lines, three lines of state and the hint, with a little space above the hint. */
export const CARD_HEIGHT = 202
const GAP = 6
const MARGIN = 8

/** Where the card goes for a word: just below it, or above when there's no room below, kept inside the window. */
export function cardPosition(word: DOMRect, view: { width: number; height: number }): { left: number; top: number } {
  const below = word.bottom + GAP
  const top = below + CARD_HEIGHT <= view.height - MARGIN ? below : Math.max(MARGIN, word.top - GAP - CARD_HEIGHT)
  const left = Math.min(Math.max(MARGIN, word.left - 12), view.width - CARD_WIDTH - MARGIN)
  return { left, top }
}

export function HoverCard({
  entry,
  at,
  onOpen,
  onEnter,
  onLeave,
  hint,
  id,
  instant
}: {
  entry: NamedEntry
  at: { left: number; top: number }
  onOpen: () => void
  onEnter: () => void
  onLeave: () => void
  /** The line at its foot (default: Ctrl+click to open, as in the page). */
  hint?: string
  /** For the name it describes (aria-describedby), where one shows it from the keyboard (Ask's names). */
  id?: string
  /** Shown at once, without fading in (opened from the keyboard). */
  instant?: boolean
}): React.JSX.Element {
  const lines = cardLines(entry.state, 3)
  const name = displayName(entry)
  return createPortal(
    <div
      id={id}
      role="tooltip"
      aria-label={name}
      data-hover-card=""
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      // Clicking it keeps the caret and the selection in the page (and the press never reaches the page behind).
      onMouseDown={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      onClick={onOpen}
      style={{ left: at.left, top: at.top, width: CARD_WIDTH, height: CARD_HEIGHT }}
      className={`fixed z-50 flex select-none flex-col rounded-xl border border-line bg-surface px-3.5 pb-2.5 pt-3 text-left shadow-pop transition-colors duration-150 hover:border-line-strong ${instant ? '' : 'animate-fade-in'}`}
    >
      <div className="flex h-10 shrink-0 items-center gap-2.5">
        <Portrait entry={entry} size={40} />
        <div className="min-w-0">
          <p className="truncate text-[14px] font-semibold leading-5 text-fg">{name}</p>
          <p className="truncate text-[12px] leading-4 text-faint">{kindWord(entry.kind)}</p>
        </div>
      </div>
      <p className="mt-2 line-clamp-2 h-[38px] shrink-0 text-[12.5px] leading-[19px] text-muted">
        {entry.summary || <span className="text-faint">No summary yet.</span>}
      </p>
      <div className="mt-1.5 min-h-0 flex-1 border-t border-line pt-1.5">
        {lines.length && !entry.absent ? (
          lines.map((l, i) => (
            <p key={i} className="truncate text-[12.5px] leading-[19px] text-fg">
              {l.text}
              {whereWords(l) ? <span className="text-faint"> · {whereWords(l)}</span> : null}
            </p>
          ))
        ) : (
          <p className="text-[12.5px] leading-[19px] text-faint">{noStateWords(entry)}</p>
        )}
      </div>
      <p className="shrink-0 text-[11.5px] leading-4 text-faint">{hint ?? `${modKey()}+click to open`}</p>
    </div>,
    document.body
  )
}
