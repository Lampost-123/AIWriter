// The names an answer cites (chat overhaul Phase 2): inline in its words as a quiet dotted underline, and in the
// "Used:" row under it as chips in their kind's ink. Resting on one (or reaching it with Tab) for 300 ms shows a small
// card of the entry, the page's own hover card where the open scene knows the entry; Esc or moving away closes it.
// Clicking shows the entry as before: beside the page with a scene open, else on its own page.
import { createContext, useContext, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { NamedEntry } from '@shared/contracts/manuscript'
import type { EntryKind, ID } from '@shared/types'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { CARD_WIDTH, HoverCard, cardPosition } from '@/features/editor/names/HoverCard'
import { kindWord } from '@/features/peek/entryView'
import { KIND_ICONS, KIND_INK } from '@/features/world/kindIcons'
import type { LinkTarget } from './citations'
import { instantMotion } from './inputMode'

/** The open scene's entries as of the scene, by id, for the cards (empty with no scene open). */
export const SceneEntries = createContext<Map<ID, NamedEntry>>(new Map())

/** Shows a page an answer cites: beside the page (in this panel) with a scene open, else on its own page. */
export function openEntry(id: ID, kind: EntryKind): void {
  const a = useApp.getState()
  if (a.sceneId && a.view.kind === 'write') a.peekEntry(id)
  else a.navigate({ kind: 'entries', entryKind: kind, entryId: id })
}

export const PEEK_DELAY = 300
const CLOSE_GRACE = 150

type Peek = { at: { left: number; top: number }; instant: boolean }

/** A name's card: opens after a rest (pointer or keyboard), stays while the pointer is on it, closes on Esc. */
function usePeek(): {
  peek: Peek | null
  bind: {
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => void
    onMouseLeave: () => void
    onFocus: (e: React.FocusEvent<HTMLElement>) => void
    onBlur: () => void
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => void
  }
  card: { onEnter: () => void; onLeave: () => void }
  close: () => void
} {
  const [peek, setPeek] = useState<Peek | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clear = (): void => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }
  useEffect(() => clear, [])
  const openFor = (el: HTMLElement, instant: boolean): void => {
    clear()
    timer.current = setTimeout(() => {
      if (!el.isConnected) return
      const r = el.getBoundingClientRect()
      setPeek({ at: cardPosition(r, { width: window.innerWidth, height: window.innerHeight }), instant })
    }, PEEK_DELAY)
  }
  const closeSoon = (): void => {
    clear()
    timer.current = setTimeout(() => setPeek(null), CLOSE_GRACE)
  }
  const close = (): void => {
    clear()
    setPeek(null)
  }
  // The panel scrolling moves the name from under its card: the card goes.
  useEffect(() => {
    if (!peek) return
    const go = (): void => close()
    window.addEventListener('scroll', go, true)
    return () => window.removeEventListener('scroll', go, true)
  })
  return {
    peek,
    bind: {
      onMouseEnter: (e) => openFor(e.currentTarget, false),
      onMouseLeave: closeSoon,
      onFocus: (e) => {
        if (e.currentTarget.matches(':focus-visible')) openFor(e.currentTarget, instantMotion())
      },
      onBlur: close,
      onKeyDown: (e) => {
        if (e.key === 'Escape' && (peek || timer.current)) {
          // The card closes; the panel's own Esc (stopping an answer) waits for the next press.
          e.preventDefault()
          e.stopPropagation()
          close()
        }
      }
    },
    card: { onEnter: clear, onLeave: closeSoon },
    close
  }
}

/** The card itself: the page's hover card for an entry the open scene knows, else its name and kind. */
function PeekCard({
  target,
  peek,
  id,
  onOpen,
  card
}: {
  target: LinkTarget
  peek: Peek
  id: string
  onOpen: () => void
  card: { onEnter: () => void; onLeave: () => void }
}): React.JSX.Element {
  const entries = useContext(SceneEntries)
  const entry = entries.get(target.id)
  if (entry) return <HoverCard entry={entry} at={peek.at} id={id} hint="Click the name to open" instant={peek.instant} onOpen={onOpen} onEnter={card.onEnter} onLeave={card.onLeave} />
  const Icon = KIND_ICONS[target.kind]
  return createPortal(
    <div
      id={id}
      role="tooltip"
      data-hover-card=""
      onMouseEnter={card.onEnter}
      onMouseLeave={card.onLeave}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onOpen}
      style={{ left: peek.at.left, top: peek.at.top, width: Math.min(CARD_WIDTH, 260) }}
      className={cn('fixed z-50 flex select-none items-center gap-2.5 rounded-xl border border-line bg-surface px-3 py-2.5 shadow-pop', !peek.instant && 'animate-fade-in')}
    >
      <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg', KIND_INK[target.kind].tile)}>
        <Icon size={16} aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[13.5px] font-semibold text-fg">{target.name}</span>
        <span className="block truncate text-[12px] text-faint">{kindWord(target.kind)} · click the name to open</span>
      </span>
    </div>,
    document.body
  )
}

/** Opens the entry from a name (the keyboard goes with it: the chat hides while the entry shows). */
function openFrom(el: HTMLElement, target: LinkTarget): void {
  el.blur()
  openEntry(target.id, target.kind)
}

/** A name the answer cites, in its words: a quiet dotted underline, like names on the page. */
export function Cite({ target, children }: { target: LinkTarget; children: React.ReactNode }): React.JSX.Element {
  const { peek, bind, card, close } = usePeek()
  const id = useId()
  const ref = useRef<HTMLSpanElement>(null)
  const open = (): void => {
    close()
    if (ref.current) openFrom(ref.current, target)
  }
  return (
    <>
      <span
        ref={ref}
        role="button"
        tabIndex={0}
        data-entry-id={target.id}
        aria-describedby={peek ? id : undefined}
        {...bind}
        onClick={open}
        onKeyDown={(e) => {
          bind.onKeyDown(e)
          if (e.key !== 'Enter' && e.key !== ' ') return
          e.preventDefault()
          open()
        }}
        className="cursor-pointer rounded-sm underline decoration-faint/70 decoration-dotted decoration-[1.5px] underline-offset-[0.24em] hover:text-accent hover:decoration-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
      >
        {children}
      </span>
      {peek ? <PeekCard target={target} peek={peek} id={id} onOpen={open} card={card} /> : null}
    </>
  )
}

/** A chip in the "Used:" row: the entry's kind icon and name, in its kind's ink. */
export function SourceChip({ target }: { target: LinkTarget }): React.JSX.Element {
  const { peek, bind, card, close } = usePeek()
  const id = useId()
  const ref = useRef<HTMLButtonElement>(null)
  const Icon = KIND_ICONS[target.kind]
  const open = (): void => {
    close()
    if (ref.current) openFrom(ref.current, target)
  }
  return (
    <>
      <button
        ref={ref}
        type="button"
        data-source-id={target.id}
        aria-label={`${target.name}, ${kindWord(target.kind).toLowerCase()}. Show it`}
        aria-describedby={peek ? id : undefined}
        {...bind}
        onClick={open}
        className={cn(
          'inline-flex h-6 max-w-[11rem] shrink-0 items-center gap-1 rounded-full border border-transparent px-2 text-[12px] font-medium leading-none transition-[border-color,filter] duration-150 hover:border-line-strong',
          'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
          KIND_INK[target.kind].tile
        )}
      >
        <Icon size={12} aria-hidden className="shrink-0" />
        <span className="truncate">{target.name}</span>
      </button>
      {peek ? <PeekCard target={target} peek={peek} id={id} onOpen={open} card={card} /> : null}
    </>
  )
}

/** "Used: [Wren] [The Light]": the entries the answer cites, in the order it first names them. */
export function SourcesRow({ targets, className }: { targets: LinkTarget[]; className?: string }): React.JSX.Element | null {
  if (!targets.length) return null
  return (
    <div data-sources className={cn('flex flex-wrap items-center gap-1.5 px-1', className)}>
      <span className="text-[12px] text-faint">Used:</span>
      {targets.map((t) => (
        <SourceChip key={t.id} target={t} />
      ))}
    </div>
  )
}
