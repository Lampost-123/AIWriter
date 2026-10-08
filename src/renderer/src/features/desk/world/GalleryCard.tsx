// One card in the desk's World room (UI overhaul phase 4, D4.1), drawn as its kind's material: a portrait for a
// character (the story's lead larger), a landscape for a place, parchment for a group, a scroll for lore, an index card
// for a plot thread, plain paper for items, events and terms. Every card lifts 3px on hover with a deeper shadow while its
// picture's two layers part (desk.css), and presses in a touch. It opens the entry's dossier.
import { memo } from 'react'
import { ShieldCheck } from '@/components/ui/icons'
import { KIND_LABELS } from '@shared/fields'
import type { BoardThread } from '@shared/contracts/worldViews'
import type { CodexCard } from '@shared/contracts/entryViews'
import type { Entry } from '@shared/types'
import { cn } from '@/lib/cn'
import { entryInitial } from '@/features/world/entryLogic'
import { displayName } from '@/features/codex/codexLogic'
import { LandscapeArt, PortraitArt, Seal } from './CardArt'
import { appearsShort, roleLabel, shortPlace, threadLine, threadState, type CardShape } from './galleryLogic'

/** How a card was opened: by the pointer (it flips into the dossier) or the keyboard (at once). */
export type OpenHow = 'pointer' | 'keyboard'

export interface GalleryCardProps {
  card: CodexCard
  shape: CardShape
  /** The entry in full, when loaded (its category, the place it is inside, its description). */
  entry: Entry | null
  /** For a plot thread: where it stands in the story Adam is in. */
  thread: BoardThread | null
  /** The place this one is inside, by name ('' when none). */
  inside: string
  featured: boolean
  /** Its place in the stagger (ms). */
  delay: number | null
  /** Its dossier is open over the gallery: the card steps out (it became the dossier). */
  opened: boolean
  /** Its drawing from the drawing library (phase 5); its own portrait still wins. */
  motif: string | null
  onOpen: (card: CodexCard, el: HTMLElement, how: OpenHow) => void
}

const firstWords = (s: string, n: number): string => {
  const t = s.trim().replace(/\s+/g, ' ')
  if (t.length <= n) return t
  const cut = t.slice(0, n)
  return `${cut.slice(0, cut.lastIndexOf(' ') > n * 0.6 ? cut.lastIndexOf(' ') : n).replace(/[,;:.\s]+$/, '')}…`
}

/** The one line under a name: the one-liner, else the start of the description. */
const aboutOf = (card: CodexCard, entry: Entry | null, n = 120): string =>
  card.summary.trim() || (entry ? firstWords(entry.description, n) : '')

export const GalleryCard = memo(function GalleryCard({
  card,
  shape,
  entry,
  thread,
  inside,
  featured,
  delay,
  opened,
  motif,
  onOpen
}: GalleryCardProps): React.JSX.Element {
  const name = displayName(card)
  const about = aboutOf(card, entry)
  const category = entry?.fields.category?.trim() ?? ''
  const role = roleLabel(card)
  // A keyboard press of Enter or Space opens at once; a click flips (a click made from the keyboard has no pointer).
  const open = (e: React.MouseEvent<HTMLButtonElement>): void => onOpen(card, e.currentTarget, e.detail === 0 ? 'keyboard' : 'pointer')
  const common = {
    type: 'button' as const,
    'data-gallery-card': card.id,
    'data-codex-card': card.id,
    'data-shape': shape,
    'data-featured': featured || undefined,
    'data-opened': opened || undefined,
    'aria-haspopup': 'dialog' as const,
    onClick: open,
    style: delay === null ? undefined : ({ '--d': `${delay}ms` } as React.CSSProperties)
  }
  const label = [name, role, KIND_LABELS[card.kind].one].filter(Boolean)
  const foot =
    card.kind === 'thread' ? null : (
      <span className="g-foot">{card.last ? `${appearsShort(card)} · last ${shortPlace(card.last.label)}` : appearsShort(card)}</span>
    )

  if (shape === 'portrait') {
    return (
      <button {...common} aria-label={label.join(', ')} className={cn('g-card g-portrait', featured && 'is-featured')}>
        <PortraitArt id={card.id} kind={card.kind} image={card.image} featured={featured} motif={motif} />
        {role ? <span className="g-role">{role}</span> : null}
        {card.image ? null : (
          <span aria-hidden className="g-mono">
            {entryInitial(name)}
          </span>
        )}
        <span className="g-body">
          <span className={cn('g-name', !card.name.trim() && 'is-unnamed')}>{name}</span>
          <span className={cn('g-sum', !about && 'is-empty')}>{about || 'No summary yet'}</span>
        </span>
        {foot}
      </button>
    )
  }
  if (shape === 'landscape') {
    return (
      <button {...common} aria-label={label.join(', ')} className="g-card g-landscape">
        <LandscapeArt id={card.id} image={card.image} motif={motif} />
        <span className="g-ptag">{inside ? `In ${inside}` : 'Place'}</span>
        <span className="g-body">
          <span className={cn('g-name', !card.name.trim() && 'is-unnamed')}>{name}</span>
          <span className={cn('g-line', !about && 'is-empty')}>{about || 'No summary yet'}</span>
          {foot}
        </span>
      </button>
    )
  }
  if (shape === 'parchment') {
    return (
      <button {...common} aria-label={label.join(', ')} className="g-card g-parchment">
        <span aria-hidden className="g-rules" />
        <Seal kind={card.kind} motif={motif} />
        <span className="g-body">
          <span className="g-caps">{category || KIND_LABELS[card.kind].one}</span>
          <span className={cn('g-title', !card.name.trim() && 'is-unnamed')}>{name}</span>
          <span className={cn('g-text', !about && 'is-empty')}>{about || 'No summary yet'}</span>
          {foot}
        </span>
      </button>
    )
  }
  if (shape === 'scroll') {
    const words = card.summary.trim() && entry?.description.trim() ? firstWords(entry.description, 170) : about
    return (
      <button {...common} aria-label={[...label, card.hardRule ? 'hard rule' : ''].filter(Boolean).join(', ')} className="g-card g-scroll">
        <span aria-hidden className="g-roll is-left" />
        <span aria-hidden className="g-roll is-right" />
        <span className="g-body">
          <span className="g-caps">
            {category || 'Lore'}
            {card.hardRule ? (
              <span className="g-hardrule">
                <ShieldCheck size={12} aria-hidden />
                Hard rule
              </span>
            ) : null}
          </span>
          <span className={cn('g-title', !card.name.trim() && 'is-unnamed')}>{name}</span>
          {card.summary.trim() && words !== card.summary.trim() ? <span className="g-lede">{card.summary.trim()}</span> : null}
          <span className={cn('g-text', !words && 'is-empty')}>{words || 'No summary yet'}</span>
          {foot}
        </span>
      </button>
    )
  }
  if (shape === 'index') {
    const state = threadState(thread)
    const promise = entry?.fields.promise?.trim() || thread?.promise.trim() || card.summary.trim()
    return (
      <button
        {...common}
        aria-label={`Plot thread, ${state.label.toLowerCase()}: ${name}`}
        className="g-card g-index"
        data-state={state.tone}
      >
        <span aria-hidden className="g-ic-rules" />
        <span aria-hidden className="g-ic-top" />
        <span aria-hidden className="g-ic-margin" />
        <span className="g-body">
          <span className="g-caps g-state">Plot thread · {state.label}</span>
          <span className={cn('g-title', !card.name.trim() && 'is-unnamed')}>{name}</span>
          <span className={cn('g-promise', !promise && 'is-empty')}>{promise || 'No promise written yet'}</span>
          <span className="g-foot">
            <svg aria-hidden width={13} height={13} viewBox="0 0 16 16" className="g-state-mark">
              {state.tone === 'done' ? (
                <>
                  <circle cx={8} cy={8} r={7} fill="currentColor" />
                  <path
                    d="M5.1 8.2l1.9 1.9 3.9-4"
                    fill="none"
                    stroke="var(--card)"
                    strokeWidth={1.7}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </>
              ) : state.tone === 'open' ? (
                <>
                  <circle cx={8} cy={8} r={6} fill="none" stroke="currentColor" strokeWidth={1.5} />
                  <path d="M8 2a6 6 0 0 1 0 12z" fill="currentColor" />
                </>
              ) : (
                <circle cx={8} cy={8} r={6} fill="none" stroke="currentColor" strokeWidth={1.5} strokeDasharray="2.4 2" />
              )}
            </svg>
            {threadLine(thread)}
          </span>
        </span>
      </button>
    )
  }
  return (
    <button {...common} aria-label={label.join(', ')} className="g-card g-plain">
      <Seal kind={card.kind} size={30} motif={motif} />
      <span className="g-body">
        <span className="g-caps">{category || KIND_LABELS[card.kind].one}</span>
        <span className={cn('g-title', !card.name.trim() && 'is-unnamed')}>{name}</span>
        <span className={cn('g-text', !about && 'is-empty')}>{about || 'No summary yet'}</span>
        {foot}
      </span>
    </button>
  )
})
