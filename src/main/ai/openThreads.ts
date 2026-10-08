// The open plot threads the writer keeps alive (Adam, 2026-10-08: the AI manages plot threads). Generate and Add below
// get them as a block in the steady part of the briefing (ai/context.ts 'open-threads', just after the card's own
// threads, so a provider's cache keeps it), the planner reads that block (plan/plan.ts), and Continue gets a short form
// (edits/briefing.ts, at most 4). One line each: name — promise — last clue. Weave gently (Adam's choice): bring one in
// only where it fits naturally, and never pay one off unless the scene card or the author's direction asks for it. A
// thread on the scene card is left out here: the card's own block says "this scene sets it up / pays it off".
// Which threads, at most `most`: those whose names the scene card mentions first, then the ones that moved most
// recently. Only what is fixed for the scene decides (the card, the memory before it), so the block reads the same at
// every step of a scene. Pure.

import type { EntryState, ID, SceneCard, ThreadState } from '@shared/types'
import { lastClue } from '../keeper/threads'

/** The most open threads Generate, Add below and the planner are given. */
export const OPEN_THREADS_MOST = 6
/** The most Continue is given. */
export const CONTINUE_THREADS_MOST = 4

export const OPEN_THREADS_BLOCK = 'open-threads'
export const OPEN_THREADS_TITLE = 'Open plot threads'
/** What the writer is told about them (gentle: never forced in, never paid off unasked). */
export const OPEN_THREADS_LEAD =
  "Plot threads still open in the story. Keep these alive. Bring one in only where it fits naturally. Don't pay a thread off unless the scene card or the author's direction asks for it."

export interface OpenThread {
  id: ID
  name: string
  promise: string
  clue: string
}

const clean = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim()
const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)

const words = (s: string): string[] => (s.toLowerCase().match(/[a-z0-9']+/g) ?? []).filter((w) => w.length >= 4)

/** The card's own words (beats, goal, conflict, outcome, notes, mood): what makes a thread more relevant here. */
function cardWords(card: SceneCard | null): Set<string> {
  if (!card) return new Set()
  return new Set(words([...(card.beats ?? []), card.goal, card.conflict, card.outcome, card.notes, card.mood].join(' ')))
}

/**
 * The plot threads open at a scene (set up on the line, not yet resolved), without those on its card, most relevant
 * first, at most `most`.
 */
export function openThreadsAt(
  memory: { entries: EntryState[]; threads: ThreadState[] },
  card: SceneCard | null,
  most = OPEN_THREADS_MOST
): OpenThread[] {
  const byId = new Map(memory.entries.map((e) => [e.id, e]))
  const onCard = new Set([...(card?.setsUpIds ?? []), ...(card?.paysOffIds ?? [])])
  const near = cardWords(card)
  const ranked = memory.threads
    .filter((t) => t.status === 'open' && !t.planned && !onCard.has(t.entryId))
    .flatMap((t, order) => {
      const e = byId.get(t.entryId)
      if (!e || e.kind !== 'thread' || !clean(e.name)) return []
      const own = words(`${e.name} ${e.fields?.promise ?? ''}`)
      const shared = own.filter((w) => near.has(w)).length
      const last = Math.max(-1, ...(e.happened ?? []).map((h) => h.at ?? -1))
      return [{ e, named: shared >= 2 || (shared >= 1 && own.length <= 2) ? 1 : 0, last, order }]
    })
    .sort((a, b) => b.named - a.named || b.last - a.last || (a.e.updatedAt < b.e.updatedAt ? 1 : a.e.updatedAt > b.e.updatedAt ? -1 : 0) || a.order - b.order)
  return ranked.slice(0, Math.max(0, most)).map(({ e }) => ({
    id: e.id,
    name: clean(e.name),
    promise: clean(e.fields?.promise ?? '') || clean(e.summary),
    clue: clean(lastClue(e))
  }))
}

/** One thread in one line: "The drowned bell — Who rang it? — last clue: wet footprints by the tower". */
export function openThreadLine(t: OpenThread, short = false): string {
  const cut = short ? 90 : 160
  const parts = [t.name, t.promise ? clip(t.promise, cut) : '', t.clue ? `last clue: ${clip(t.clue, cut)}` : ''].filter(Boolean)
  return `- ${parts.join(' — ')}`
}

/** The block's text: the lead, then a line a thread. '' for none. */
export function openThreadsText(threads: OpenThread[], short = false): string {
  if (!threads.length) return ''
  return [OPEN_THREADS_LEAD, ...threads.map((t) => openThreadLine(t, short))].join('\n')
}
