// What a suggestion's card holds, on screen (2026-10-19, after "the Edit form can't edit what it makes"): every part the
// AI gave a chapter or scene (point of view, characters, location, When, mood, plot threads) shown quietly under its
// words, and editable in its Edit form with the same pickers as a scene card (people, places and plot threads from the
// codex, or a name typed in, whose page is made when it is kept). Shared by the panels (Suggestions.tsx) and the desk
// (DeskSuggestions.tsx).

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Entry, EntryKind, ID } from '@shared/types'
import { Field, Input } from '@/components/ui'
import { cn } from '@/lib/cn'
import { api } from '@/lib/api'
import { useApp } from '@/lib/store'
import { CastPicker } from '@/features/inspector/CastPicker'
import { codexOf, namesFor, picksFor, standInFor } from './codexNames'
import type { SuggestedCard } from './parse'
import type { NodeKind, Words } from './tree'

/** The parts of a suggestion's card that have something in them, by their names on a scene card. */
export function cardParts(kind: NodeKind, card: SuggestedCard | undefined): [string, string][] {
  if (!card || kind === 'act') return []
  const out: [string, string][] = []
  if (card.pov.trim()) out.push(['Point of view', card.pov.trim()])
  const people = card.characters.map((c) => c.trim()).filter(Boolean)
  if (people.length) out.push(['Characters', people.join(', ')])
  if (card.location.trim()) out.push(['Location', card.location.trim()])
  if (card.mood.trim()) out.push(['Mood', card.mood.trim()])
  return out
}

/** A suggestion's When as its head shows it: a scene's own, or a chapter's card's. */
export const whenOf = (kind: NodeKind, words: Words): string => (kind === 'scene' ? words.when : kind === 'chapter' ? (words.card?.when ?? '') : '').trim()

/** Who and where, and the plot threads, under a suggestion's words (nothing when it has none). */
export function CardLines({ kind, words, className }: { kind: NodeKind; words: Words; className?: string }): React.JSX.Element | null {
  const parts = cardParts(kind, words.card)
  const setsUp = words.setsUp.filter((t) => t.trim())
  const paysOff = words.paysOff.filter((t) => t.trim())
  if (!parts.length && !setsUp.length && !paysOff.length) return null
  return (
    <div className={cn('mt-1.5 flex flex-col gap-0.5 break-words text-[12px] leading-relaxed text-faint', className)}>
      {parts.length ? (
        <p data-card-parts>
          {parts.map(([label, value], i) => (
            <span key={label}>
              {i ? ' · ' : ''}
              <span className="text-muted">{label}:</span> {value}
            </span>
          ))}
        </p>
      ) : null}
      {/* The plot threads the scene sets up and pays off (2026-10-08): they go on its card when it is kept. */}
      {setsUp.length || paysOff.length ? (
        <p data-threads>
          {setsUp.length ? <span>Sets up: {setsUp.join('; ')}</span> : null}
          {setsUp.length && paysOff.length ? <span> · </span> : null}
          {paysOff.length ? <span>Pays off: {paysOff.join('; ')}</span> : null}
        </p>
      ) : null}
    </div>
  )
}

/** The codex, for the pickers (kept up to date while the form is open); empty until it has loaded. */
function useCodex(): Entry[] {
  const entriesRev = useApp((s) => s.entriesRev)
  const [entries, setEntries] = useState<Entry[]>([])
  useEffect(() => {
    let live = true
    api
      .listEntries()
      .then((list) => live && setEntries(list))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [entriesRev])
  return entries
}

/** Names picked from the codex or typed in: several (characters, plot threads), or one (`single`: point of view, location). */
function NamesPicker({
  id,
  kind,
  names,
  onChange,
  all,
  single = false,
  noun,
  listLabel,
  placeholder,
  pov,
  describedBy
}: {
  id: string
  kind: EntryKind
  names: string[]
  onChange: (names: string[]) => void
  all: Entry[]
  single?: boolean
  noun: string
  listLabel: string
  placeholder: string
  /** The point of view, marked among the characters. */
  pov?: string
  describedBy?: string
}): React.JSX.Element {
  const codex = useMemo(() => codexOf(kind, all), [kind, all])
  const { ids, options } = useMemo(() => picksFor(kind, names, codex, all), [kind, names, codex, all])
  const povId = useMemo(() => (pov?.trim() ? (picksFor(kind, [pov], codex, all).ids[0] ?? null) : null), [kind, pov, codex, all])
  const change = useCallback((next: ID[]) => onChange(namesFor(single ? next.slice(-1) : next, codex, all)), [onChange, single, codex, all])
  const create = useCallback(async (name: string) => standInFor(kind, name.replace(/\s+/g, ' ').trim()), [kind])
  return (
    <CastPicker
      id={id}
      aria-describedby={describedBy}
      value={ids}
      characters={options}
      povId={povId}
      onChange={change}
      onCreate={create}
      noun={noun}
      listLabel={listLabel}
      placeholder={placeholder}
      addPlaceholder={single ? 'Change…' : undefined}
    />
  )
}

const one = (s: string): string[] => (s.trim() ? [s.trim()] : [])

/**
 * The card's parts in the Edit form: a chapter's (its scenes follow them), or where a scene differs from its chapter,
 * then a scene's plot threads. Compact: two columns where there is room, one in a narrow card.
 */
export function CardFields({
  kind,
  card,
  onCard,
  setsUp,
  onSetsUp,
  paysOff,
  onPaysOff,
  onEnter
}: {
  kind: 'chapter' | 'scene'
  card: SuggestedCard
  onCard: (patch: Partial<SuggestedCard>) => void
  setsUp: string[]
  onSetsUp: (names: string[]) => void
  paysOff: string[]
  onPaysOff: (names: string[]) => void
  /** Enter in a one-line box saves the form. */
  onEnter: () => void
}): React.JSX.Element {
  const all = useCodex()
  const enter = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onEnter()
    }
  }
  const scene = kind === 'scene'
  const head = 'text-[11px] font-semibold uppercase tracking-wide text-faint'
  // Two columns where the form is wide enough (container queries: the desk's index cards are narrow), else one.
  const grid = 'grid grid-cols-1 gap-3 @md/card:grid-cols-2'
  return (
    <>
      <div className="@container/card flex flex-col gap-2" data-card-fields>
        <div>
          <p className={head}>{scene ? 'Where it differs from its chapter' : 'Who and where'}</p>
          <p className="text-[12px] text-faint">
            {scene ? 'Left empty, the scene follows its chapter.' : 'Its scenes follow these unless they say otherwise. A name the codex doesn’t have gets a page when you keep it.'}
          </p>
        </div>
        <div className={grid}>
          <Field label="Point of view">
            {(id) => (
              <NamesPicker
                id={id}
                kind="character"
                single
                names={one(card.pov)}
                all={all}
                onChange={(n) => onCard({ pov: n[0] ?? '' })}
                noun="character"
                listLabel="Characters"
                placeholder="Type a name…"
              />
            )}
          </Field>
          <Field label="Location">
            {(id) => (
              <NamesPicker
                id={id}
                kind="place"
                single
                names={one(card.location)}
                all={all}
                onChange={(n) => onCard({ location: n[0] ?? '' })}
                noun="place"
                listLabel="Places"
                placeholder="Type a place…"
              />
            )}
          </Field>
          <Field label="Characters present" className="@md/card:col-span-2">
            {(id) => (
              <NamesPicker
                id={id}
                kind="character"
                names={card.characters}
                all={all}
                pov={card.pov}
                onChange={(characters) => onCard({ characters })}
                noun="character"
                listLabel="Characters"
                placeholder="Type a name…"
              />
            )}
          </Field>
          {scene ? null : (
            <Field label="When" hint="When the chapter starts, such as “Day 2, evening”.">
              {(id) => <Input id={id} value={card.when} placeholder="Day 2, evening" onChange={(e) => onCard({ when: e.target.value })} onKeyDown={enter} />}
            </Field>
          )}
          <Field label="Mood or tone">
            {(id) => <Input id={id} value={card.mood} placeholder="Quiet and tense" onChange={(e) => onCard({ mood: e.target.value })} onKeyDown={enter} />}
          </Field>
        </div>
      </div>
      {scene ? (
        <div className="@container/card flex flex-col gap-2">
          <p className={head}>Plot threads</p>
          <div className={grid}>
            <Field label="Sets up" hint="Mysteries, promises and setups it opens.">
              {(id) => (
                <NamesPicker id={id} kind="thread" names={setsUp} all={all} onChange={onSetsUp} noun="plot thread" listLabel="Plot threads" placeholder="Type a plot thread…" />
              )}
            </Field>
            <Field label="Pays off" hint="Threads it resolves.">
              {(id) => (
                <NamesPicker id={id} kind="thread" names={paysOff} all={all} onChange={onPaysOff} noun="plot thread" listLabel="Plot threads" placeholder="Type a plot thread…" />
              )}
            </Field>
          </div>
        </div>
      ) : null}
    </>
  )
}
