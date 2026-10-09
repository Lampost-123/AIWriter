// Choosing a drawing (UI overhaul, D5.4), self-contained so it can sit wherever an entry's page puts it: the entry's
// drawing on its kind's tint (or Adam's portrait, which always wins), whether its words picked it or he did, and a
// "Change" pop-over with the whole library, the drawings that suit the entry first, and "Use the one its words call
// for". The same grid chooses a story's cover (CoverPicker), with a row of colours. The choices live in the world
// (features/world/art/artStore.ts); nothing about the entry itself changes, so its history and search never see it.
import * as P from '@radix-ui/react-popover'
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { MOTIFS, motifById, motifScores, type MotifSource } from '@shared/motifs'
import type { EntryKind, ID } from '@shared/types'
import { Check, RotateCcw } from '@/components/ui/icons'
import { Motif } from '@/components/art/Motif'
import { cn } from '@/lib/cn'
import { KIND_INK } from '@/features/world/kindIcons'
import { chooseEntryMotif, chooseStoryCover, motifOf, useArtChoices, useEntryMotifs } from './artStore'
import './picker.css'

/** The library in the order the picker shows it: the drawings the words call for, then the kind's own, then the rest. */
export function pickerOrder(entry: MotifSource | null, kind: EntryKind | null): string[] {
  const scores = entry
    ? motifScores(
        [
          { text: entry.name, weight: 3 },
          { text: entry.summary ?? '', weight: 2 },
          { text: entry.description ?? '', weight: 1 }
        ],
        kind
      )
    : new Map<string, number>()
  const rank = (id: string): number => (scores.get(id) ?? 0) + (kind && motifById(id)!.kinds.includes(kind) ? 0.25 : 0)
  return MOTIFS.map((m, i) => ({ id: m.id, r: rank(m.id), i }))
    .sort((a, b) => b.r - a.r || a.i - b.i)
    .map((x) => x.id)
}

/** The grid of drawings, one of them chosen. */
export function MotifGrid({
  order,
  value,
  onPick,
  label,
  tile
}: {
  order: string[]
  value: string
  onPick: (id: string) => void
  label: string
  /** The tint behind each drawing. */
  tile?: string
}): React.JSX.Element {
  return (
    <div role="radiogroup" aria-label={label} className="motif-grid">
      {order.map((id) => {
        const m = motifById(id)!
        const on = id === value
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={on}
            data-art-hover=""
            aria-label={m.label}
            title={m.label}
            className={cn('motif-cell', tile, on && 'is-on')}
            onClick={() => onPick(id)}
          >
            <Motif id={id} size={26} />
            {on ? (
              <span className="motif-tick" aria-hidden>
                <Check size={10} />
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

export interface PickerEntry extends MotifSource {
  id: ID
  image?: string | null
}

/**
 * An entry's drawing, and the way to change it. `compact`: the drawing and a Change button in one line (for a page's
 * head); otherwise a small card with the drawing, what it is and why.
 */
export function MotifPicker({ entry, compact = false, className }: { entry: PickerEntry; compact?: boolean; className?: string }): React.JSX.Element {
  const choices = useArtChoices()
  const [open, setOpen] = useState(false)
  // The drawing it shows on its card and portrait (handed out so a row of cards doesn't repeat one: artStore).
  const current = useEntryMotifs().get(entry.id) ?? motifOf(choices, entry)
  const chosen = choices.entries[entry.id]
  const order = useMemo(() => pickerOrder(entry, entry.kind), [entry])
  const tint = KIND_INK[entry.kind].tile
  const label = motifById(current)?.label ?? 'A drawing'
  const why = chosen ? 'You chose it' : 'Picked from its words'
  return (
    <div className={cn('motif-picker', compact && 'is-compact', className)} data-motif-picker>
      <span className={cn('motif-face', tint, entry.kind === 'character' ? 'rounded-full' : 'rounded-[10px]')} aria-hidden>
        <Motif id={current} size={compact ? 26 : 40} />
      </span>
      <span className="motif-text">
        <span className="motif-label">
          Drawing: <b>{label.replace(/^An? /, '').replace(/^./, (c) => c.toLowerCase())}</b>
        </span>
        <span className="motif-why">
          {why}
          {entry.image ? '. Your portrait shows instead wherever there is one.' : '.'}
        </span>
      </span>
      <P.Root open={open} onOpenChange={setOpen}>
        <P.Trigger className="motif-change">Change</P.Trigger>
        <P.Portal>
          <P.Content
            side="bottom"
            align="start"
            sideOffset={6}
            collisionPadding={12}
            className="motif-pop z-50 data-[state=open]:animate-pop-in"
            aria-label={`Choose a drawing for ${entry.name}`}
          >
            <p className="motif-pop-title">A drawing for {entry.name}</p>
            <p className="motif-pop-sub">Shown on its card and wherever it has no portrait. The ones its words suit come first.</p>
            <MotifGrid
              order={order}
              value={current}
              tile={tint}
              label={`Drawings for ${entry.name}`}
              onPick={(id) => {
                void chooseEntryMotif(entry.id, id)
                setOpen(false)
              }}
            />
            {chosen ? (
              <button
                type="button"
                className="motif-reset"
                onClick={() => {
                  void chooseEntryMotif(entry.id, null)
                  setOpen(false)
                }}
              >
                <RotateCcw size={13} />
                Use the one its words call for
              </button>
            ) : null}
          </P.Content>
        </P.Portal>
      </P.Root>
    </div>
  )
}

/** The cover's colours to choose from (hues, OKLCH): dusk blue, harbour teal, moss, amber, ember, rose, plum, slate. */
export const COVER_HUES = [265, 205, 145, 70, 35, 10, 330, 240]

/** A story's cover: its drawing and its colour, chosen over its own. `children` is what opens it (the book). */
export function CoverPicker({
  story,
  motif,
  hue,
  children
}: {
  story: { id: ID; title: string; premise: string }
  motif: string
  hue: number
  children: ReactNode
}): React.JSX.Element {
  const choices = useArtChoices()
  const [open, setOpen] = useState(false)
  const chosen = choices.stories[story.id]
  const order = useMemo(() => pickerOrder({ kind: 'item', name: story.title, summary: story.premise }, null), [story.title, story.premise])
  return (
    <P.Root open={open} onOpenChange={setOpen}>
      <P.Trigger asChild>{children}</P.Trigger>
      <P.Portal>
        <P.Content side="right" align="start" sideOffset={14} collisionPadding={12} className="motif-pop z-50 data-[state=open]:animate-pop-in" aria-label="Choose the cover">
          <p className="motif-pop-title">The cover of {story.title.trim() || 'this story'}</p>
          <p className="motif-pop-sub">Its colour and its drawing. Made for it from its genre and its words until you choose.</p>
          <div role="radiogroup" aria-label="Cover colour" className="cover-hues">
            {COVER_HUES.map((h) => (
              <button
                key={h}
                type="button"
                role="radio"
                aria-checked={Math.round(hue) === h}
                aria-label={`Colour ${COVER_HUES.indexOf(h) + 1}`}
                className={cn('cover-hue', Math.round(hue) === h && 'is-on')}
                style={{ '--h': h } as CSSProperties}
                onClick={() => void chooseStoryCover(story.id, { ...chosen, hue: h })}
              />
            ))}
          </div>
          <MotifGrid order={order} value={motif} label="Cover drawing" tile="cover-tile" onPick={(id) => void chooseStoryCover(story.id, { ...chosen, motif: id })} />
          {chosen ? (
            <button
              type="button"
              className="motif-reset"
              onClick={() => {
                void chooseStoryCover(story.id, null)
                setOpen(false)
              }}
            >
              <RotateCcw size={13} />
              Use its own cover
            </button>
          ) : null}
        </P.Content>
      </P.Portal>
    </P.Root>
  )
}
