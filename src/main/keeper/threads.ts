// The memory keeper manages plot threads (Adam, 2026-10-08). What it reads in a scene (keeper/apply.ts applyThread):
// - open: a promise, mystery, threat, goal, debt or secret the story will need to answer, with its quote. A new thread
//   is made with its promise (the `promise` field, from the text); one already listed (planned by Adam, say) gets the
//   promise only when its field is empty and not his. The opening is a thread change {status 'open'} pinned to the
//   scene, and the thread goes on the scene card's "Sets up", marked as the AI's (shared/threadLinks.ts).
// - clue: appended to the thread's `clues` field, one a line (from the text). Adam's own clues are never changed: the
//   clue is a note on the thread in that scene instead.
// - developing: a note on the thread (a thread change that keeps it open). No new status: open and resolved only.
// - resolved: only when the payoff is on the page, with its quote. Ignored (kept as a note that it moves on) while a
//   later scene card lists the thread under "Pays off" (Adam's plan; a link the memory made for a resolve it read there
//   doesn't count) or the thread's own "How it should pay off" says it comes later (payoffLater). A resolve goes on the
//   scene card's "Pays off", marked as the AI's; Undo (the board or What changed) takes both back and records a
//   suppression, so the same words don't resolve it again.
// Pure helpers here; the reads use the open world's database. No Electron imports.

import type Database from 'better-sqlite3'
import type { Change, EntryState, ID } from '@shared/types'
import type { WorldShape } from '../memory/types'
import * as repo from '../db/repo'
import * as mem from '../db/memory'

type DB = Database.Database

/** What the memory model says happened to a plot thread. */
export type ThreadStep = 'open' | 'clue' | 'developing' | 'resolved'

/** The step a thread item gives ("status"), read forgivingly; open when it says nothing usable. */
export function threadStep(v: unknown): ThreadStep {
  const s = String(v ?? '')
    .toLowerCase()
    .trim()
  if (/^(resolved?|paid off|pays? off|closed|answered|done)$/.test(s)) return 'resolved'
  if (/^(clues?|hint)$/.test(s)) return 'clue'
  if (/^(developing|develops|moves on|moved on|progress|progresses|advanced?)$/.test(s)) return 'developing'
  return 'open'
}

/** A clues field as a list, one clue a line (older fields may use semicolons). */
export function clueList(field: string | null | undefined): string[] {
  return (field ?? '')
    .split(/\n|;\s+/)
    .map((s) => s.replace(/^[-•*]\s*/, '').trim())
    .filter(Boolean)
}

/** The note a clue leaves on a thread whose clues field is Adam's ("Clue: wet footprints by the tower"). */
export const CLUE_NOTE = 'Clue: '

/** The last clue given for a thread as of a point: the last line of its clues, else the last clue noted on it. */
export function lastClue(e: Pick<EntryState, 'fields' | 'happened'>): string {
  const list = clueList(e.fields?.clues)
  if (list.length) return list[list.length - 1]
  const noted = [...(e.happened ?? [])].reverse().find((h) => h.note.startsWith(CLUE_NOTE))
  return noted ? noted.note.slice(CLUE_NOTE.length).trim() : ''
}

/** Where a scene is, for payoffLater: its chapter's number and how many chapters its story has, and the book's number. */
export interface ThreadPlace {
  storyId: ID
  chapter: number
  chapters: number
  book: number
  /** The live scenes after it in its story, in order. */
  later: ID[]
}

export function threadPlace(shape: WorldShape | null, sceneId: ID): ThreadPlace | null {
  for (const story of shape?.stories ?? []) {
    const order = story.chapters.flatMap((c, ci) => c.scenes.map((s) => ({ id: s.id, chapter: ci + 1 })))
    const at = order.findIndex((s) => s.id === sceneId)
    if (at < 0) continue
    const series = story.seriesId
      ? shape!.stories.filter((s) => s.seriesId === story.seriesId).sort((a, b) => a.position - b.position || a.createdOrder - b.createdOrder)
      : [story]
    return {
      storyId: story.id,
      chapter: order[at].chapter,
      chapters: story.chapters.length,
      book: Math.max(1, series.findIndex((s) => s.id === story.id) + 1),
      later: order.slice(at + 1).map((s) => s.id)
    }
  }
  return null
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5
}
const numberOf = (w: string): number => (/^\d+$/.test(w) ? Number(w) : (NUMBER_WORDS[w] ?? NaN))

/**
 * True when a thread's "How it should pay off" says the payoff comes after this scene: a later chapter or book by
 * number ("in chapter 20", "Book 3"), a sequel or the next book, or (unless this is the story's last chapter) the
 * end, the finale, the climax or the last chapter, or "later" / "eventually". Nothing said: false.
 */
export function payoffLater(payoff: string | null | undefined, at: Pick<ThreadPlace, 'chapter' | 'chapters' | 'book'>): boolean {
  const t = ` ${(payoff ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `
  if (!t.trim()) return false
  for (const m of t.matchAll(/ (?:chapter|ch) ([a-z0-9]+) /g)) {
    const n = numberOf(m[1])
    if (n > at.chapter) return true
  }
  for (const m of t.matchAll(/ (?:book|volume|part) ([a-z0-9]+) /g)) {
    const n = numberOf(m[1])
    if (n > at.book) return true
  }
  if (/ (sequel|next book|later book|another book|book after) /.test(t)) return true
  if (/ (later|eventually|in time|much later|down the line) /.test(t)) return true
  const lastChapter = at.chapters > 0 && at.chapter >= at.chapters
  if (!lastChapter && /( finale | climax | the end | ending | final (chapter|act|scene|battle|confrontation) | last chapter | last act )/.test(t))
    return true
  return false
}

/**
 * True when a later scene's card in the same story plans this thread's payoff: it lists the thread under "Pays off",
 * and that link isn't the memory's record of a resolve it read in that scene.
 */
export function laterCardPaysOff(db: DB, place: ThreadPlace | null, threadId: ID): boolean {
  if (!place?.later.length) return false
  const cards = repo.sceneCards(db, place.later)
  for (const id of place.later) {
    const card = cards.get(id)
    if (!card?.paysOffIds?.includes(threadId)) continue
    const readThere = mem
      .changesInScene(db, id)
      .some((c) => c.entryId === threadId && c.kind === 'thread' && c.payload.status === 'resolved' && c.origin === 'text')
    if (!readThere) return true
  }
  return false
}

/** Where a thread stands in a scene: none (never opened on the line), open or resolved, before its own changes and after. */
export function threadStatus(before: 'none' | 'open' | 'resolved', own: Change[], threadId: ID): 'none' | 'open' | 'resolved' {
  let s = before
  for (const c of own) if (c.entryId === threadId && c.kind === 'thread') s = c.payload.status
  return s
}
