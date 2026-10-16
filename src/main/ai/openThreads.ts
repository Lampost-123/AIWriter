// The open plot threads the writer keeps alive (Adam, 2026-10-08: the AI manages plot threads). Generate and Add below
// get them as a block in the steady part of the briefing (ai/context.ts 'open-threads', just after the card's own
// threads, so a provider's cache keeps it), the planner reads that block (plan/plan.ts), and Continue gets a short form
// (edits/briefing.ts, at most 4). One line each: name — promise — last clue, and when it is due. Weave gently (Adam's
// choice): bring one in only where it fits naturally, and never pay one off unless the scene card, the author's direction
// or its own line (due now, or overdue) asks for it. A thread on the scene card is left out here: the card's own block
// says "this scene sets it up / pays it off". A thread Adam dropped is left out too.
// Which threads (the promises ledger, long story memory fix 10), at most openThreadsMost(memoryScale): those due by the
// end of this chapter or overdue first; then those that involve the scene (the card's words name them, or they name a
// character or place on the card or an item those people hold, by the one name rule, shared/names.ts); then the
// longest untouched. Only what is fixed for the scene decides (the card, the memory before it, Adam's plans), so the
// block reads the same at every step of a scene. Pure.

import type { EntryState, ID, RelationshipState, SceneCard, ThreadDue, ThreadState } from '@shared/types'
import { lastClue } from '../keeper/threads'
import { QUIET_SCENES } from '../memory/threadQuiet'
import { holdingsOf, itemHeads, nameIn, namesOf } from '../memory/items'
import { MOST_SCALE } from './memoryRoom'

/** The most open threads Generate, Add below and the planner are given on the smallest model (memoryScale 1). */
export const OPEN_THREADS_MOST = 6
/** The most in the block's short form there. */
export const OPEN_THREADS_SHORT = 3
/** The most Continue is given. */
export const CONTINUE_THREADS_MOST = 4

/** The most open threads for a model `scale` times the smallest one's memory (ai/memoryRoom.ts): 6, up to 22. */
export const openThreadsMost = (scale = 1): number => Math.round(OPEN_THREADS_MOST * Math.max(1, Math.min(MOST_SCALE, scale)))
/** The short form's most: 3, up to twice that. */
export const openThreadsShort = (scale = 1): number => Math.round(OPEN_THREADS_SHORT * Math.max(1, Math.min(2, scale)))

export const OPEN_THREADS_BLOCK = 'open-threads'
export const OPEN_THREADS_TITLE = 'Open plot threads'
/** What the writer is told about them (gentle: never forced in, never paid off unasked). */
export const OPEN_THREADS_LEAD =
  "Plot threads still open in the story. Keep these alive. Bring one in only where it fits naturally. Don't pay a thread off unless the scene card or the author's direction asks for it, or its line below says it is due."

export interface OpenThread {
  id: ID
  name: string
  promise: string
  clue: string
  /** Scenes it has been quiet, when overdue in this part of the story (B4: QUIET_SCENES or more, last touched in this story). */
  overdue?: number
  /** When it is due to be paid off, as this scene is written (the promises ledger, fix 10). */
  due?: ThreadDue
}

/** The most overdue threads the gentle reminder names (one line). */
export const REMINDER_MOST = 2

const clean = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim()
const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)

const words = (s: string): string[] => (s.toLowerCase().match(/[a-z0-9']+/g) ?? []).filter((w) => w.length >= 4)

/** The card's own words (beats, goal, conflict, outcome, notes, mood): what makes a thread more relevant here. */
function cardWords(card: SceneCard | null): Set<string> {
  if (!card) return new Set()
  return new Set(words([...(card.beats ?? []), card.goal, card.conflict, card.outcome, card.notes, card.mood].join(' ')))
}

/**
 * The words the scene's own entries are found by (shared/names.ts, as memory/items.ts reads them): the point of view and
 * the others on the card, its location, and the items those people hold as the scene begins.
 */
function sceneNames(memory: { entries: EntryState[]; relationships?: RelationshipState[] }, card: SceneCard | null): string[][] {
  if (!card) return []
  const byId = new Map(memory.entries.map((e) => [e.id, e]))
  const people = [card.povId, ...(card.presentIds ?? [])].filter((id): id is ID => !!id && byId.has(id))
  const held = memory.relationships ? holdingsOf({ entries: memory.entries, relationships: memory.relationships, people }).filter((h) => h.has) : []
  const ids = [...new Set([...people, ...(card.locationId ? [card.locationId] : []), ...held.map((h) => h.itemId)])]
  const heads = itemHeads(memory.entries)
  return ids.flatMap((id) => {
    const e = byId.get(id)
    return e ? [namesOf(e, heads)] : []
  })
}

const URGENT: Record<ThreadDue['state'], number> = { overdue: 2, now: 1, later: 0 }

/**
 * The plot threads open at a scene (set up on the line, not yet resolved, not dropped), without those on its card, most
 * urgent first (see the top of this file), at most `most`. `hidden`: threads Adam kept out of this scene's briefing (a
 * 'hide' pin), never listed.
 */
export function openThreadsAt(
  memory: { entries: EntryState[]; threads: ThreadState[]; storyId?: ID; relationships?: RelationshipState[] },
  card: SceneCard | null,
  most = OPEN_THREADS_MOST,
  hidden: ReadonlySet<ID> = new Set()
): OpenThread[] {
  const byId = new Map(memory.entries.map((e) => [e.id, e]))
  const onCard = new Set([...(card?.setsUpIds ?? []), ...(card?.paysOffIds ?? [])])
  const near = cardWords(card)
  const open = memory.threads.filter(
    (t) => t.status === 'open' && !t.planned && t.standing !== 'dropped' && !onCard.has(t.entryId) && !hidden.has(t.entryId)
  )
  const here = open.length ? sceneNames(memory, card) : []
  const ranked = open
    .flatMap((t, order) => {
      const e = byId.get(t.entryId)
      if (!e || e.kind !== 'thread' || !clean(e.name)) return []
      const own = words(`${e.name} ${e.fields?.promise ?? ''}`)
      const shared = own.filter((w) => near.has(w)).length
      const text = [e.name, e.fields?.promise, e.fields?.clues, e.fields?.payoff, e.summary].map(clean).filter(Boolean).join('. ')
      const involves = here.some((names) => names.some((n) => nameIn(text, n)))
      const named = shared >= 2 || (shared >= 1 && own.length <= 2) || involves ? 1 : 0
      const last = Math.max(-1, ...(e.happened ?? []).map((h) => h.at ?? -1))
      // Overdue in this part of the story (B4): quiet for a while, and last touched in the story being written.
      const overdue = t.quiet != null && t.quiet >= QUIET_SCENES && (!memory.storyId || t.lastStoryId === memory.storyId) ? t.quiet : 0
      return [{ e, t, urgent: t.due ? URGENT[t.due.state] : 0, named, quiet: t.quiet ?? -1, last, order, overdue }]
    })
    .sort(
      (a, b) =>
        b.urgent - a.urgent ||
        b.named - a.named ||
        b.quiet - a.quiet ||
        a.last - b.last ||
        // Ties on what never changes (when it was made, then its id), never on its last edit: a write to a thread
        // between two steps of a scene mustn't reorder the block (the cache).
        (a.e.createdAt < b.e.createdAt ? -1 : a.e.createdAt > b.e.createdAt ? 1 : 0) ||
        (a.e.id < b.e.id ? -1 : a.e.id > b.e.id ? 1 : 0) ||
        a.order - b.order
    )
  // The most overdue (at most REMINDER_MOST) always make the list, in place of the last ones, keeping its order.
  const n = Math.max(0, most)
  const due = new Set(
    [...ranked]
      .filter((r) => r.overdue)
      .sort((a, b) => b.overdue - a.overdue)
      .slice(0, Math.min(REMINDER_MOST, n))
  )
  const rest = ranked.filter((r) => !due.has(r)).slice(0, n - due.size)
  const kept = new Set([...rest, ...due])
  return ranked
    .filter((r) => kept.has(r))
    .map(({ e, t, overdue }) => ({
      id: e.id,
      name: clean(e.name),
      promise: clean(e.fields?.promise ?? '') || clean(e.summary),
      clue: clean(lastClue(e)),
      ...(overdue ? { overdue } : {}),
      ...(t.due ? { due: t.due } : {})
    }))
}

/**
 * The gentle reminder (B4), one line: the threads overdue here, most quiet first, at most REMINDER_MOST. '' for none.
 * "Quiet for a while: The drowned bell (8 scenes). If it fits here, a passing mention keeps it alive; never force it."
 */
export function quietReminder(threads: OpenThread[]): string {
  const due = threads
    .filter((t) => t.overdue)
    .sort((a, b) => (b.overdue ?? 0) - (a.overdue ?? 0))
    .slice(0, REMINDER_MOST)
  if (!due.length) return ''
  const names = due.map((t) => `${t.name} (${t.overdue} scenes)`).join('; ')
  return `Quiet for a while: ${names}. If ${due.length === 1 ? 'it fits' : 'one fits'} here, a passing mention keeps it alive; never force it.`
}

/**
 * When a thread is due, in the writer's words (the promises ledger, fix 10); '' when it has no date. Due now: "Pay this
 * off by the end of this chapter." Later: when, and "not yet", so it isn't paid off early.
 */
export function dueWords(due: ThreadDue | undefined): string {
  if (!due) return ''
  const card = due.from === 'card' && !!due.sceneLabel
  switch (due.state) {
    case 'now':
      return 'Pay this off by the end of this chapter.'
    case 'overdue':
      return card
        ? `Overdue: its pay-off was planned for ${due.sceneLabel}. Pay it off soon, where it fits.`
        : `Overdue: it was to be paid off by the end of ${due.label}. Pay it off soon, where it fits.`
    case 'later':
      return card ? `its pay-off is planned for ${due.sceneLabel}, not yet` : `to be paid off by the end of ${due.label}, not yet`
  }
}

/** One thread in one line: "The drowned bell — Who rang it? — last clue: wet footprints by the tower". */
export function openThreadLine(t: OpenThread, short = false): string {
  const cut = short ? 90 : 160
  const parts = [t.name, t.promise ? clip(t.promise, cut) : '', t.clue ? `last clue: ${clip(t.clue, cut)}` : '', dueWords(t.due)].filter(Boolean)
  return `- ${parts.join(' — ')}`
}

/** The block's text: the lead, then a line a thread. '' for none. */
export function openThreadsText(threads: OpenThread[], short = false): string {
  if (!threads.length) return ''
  const reminder = quietReminder(threads)
  return [OPEN_THREADS_LEAD, ...threads.map((t) => openThreadLine(t, short)), ...(reminder ? [reminder] : [])].join('\n')
}
