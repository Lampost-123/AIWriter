// Pure helpers for the plot threads board: its columns and the words on each card, and the ledger's rows (World Memory
// Overhaul B4), with where each thread stands and when it is due (the promises ledger, long story memory fix 10).
// Tested in boardLogic.test.ts.
import type { ID, ThreadDue } from '@shared/types'
import { QUIET_SCENES, type BoardPlace, type BoardThread, type ThreadsBoard } from '@shared/contracts/worldViews'

// ---------- The ledger (B4) ----------

export type LedgerSort = 'quiet' | 'name'

const STATUS_WORDS: Record<Column, string> = { open: 'Open', resolved: 'Resolved', planned: 'Planned', dropped: 'Dropped' }

/**
 * Where a thread stands, in a word (fix 10): Open, Advanced (moved on since it was set up), Resolved (paid off), Dropped,
 * or Planned (not set up in the story yet).
 */
export function statusWords(t: Pick<BoardThread, 'column' | 'standing'>): string {
  if (t.column === 'open' && t.standing === 'advanced') return 'Advanced'
  return STATUS_WORDS[t.column]
}

// ---------- The promises ledger (fix 10) ----------

/** The chapter a due date names: "Ch 5" (its own words, for a scene card's plan "Ch 5, Sc 2"). */
const dueChapter = (due: ThreadDue): string => (due.from === 'card' && due.sceneLabel ? due.sceneLabel : due.label)

/**
 * When a thread is to be paid off, for its card and the ledger: "By the end of Ch 5", "Planned for Ch 5, Sc 2" (a scene
 * card's Pays off), "Due by the end of this chapter", "Overdue: due by the end of Ch 4". '' when it has no date.
 */
export function dueWords(t: Pick<BoardThread, 'due'>): string {
  const due = t.due
  if (!due) return ''
  const planned = due.from === 'card' && !!due.sceneLabel
  if (due.state === 'overdue') return planned ? `Overdue: planned for ${dueChapter(due)}` : `Overdue: due by the end of ${due.label}`
  if (due.state === 'now') return planned ? `Due now: planned for ${dueChapter(due)}` : 'Due by the end of this chapter'
  return planned ? `Planned for ${dueChapter(due)}` : `By the end of ${due.label}`
}

/** The "Pay off by" chapter Adam chose, for the picker; null for none (a scene card's plan isn't his choice here). */
export const payBy = (t: Pick<BoardThread, 'due'>): ID | null => (t.due?.from === 'adam' ? t.due.chapterId : null)

/** True when the "Pay off by" picker belongs on a thread: one still to be paid off (open, or planned on the cards). */
export const canPlan = (t: Pick<BoardThread, 'column'>): boolean => t.column === 'open' || t.column === 'planned'

/** "Ch 3, Sc 2" when something moved it on after its set-up; "Not since it was set up" for an open thread; '' else. */
export function advancedWords(t: Pick<BoardThread, 'column' | 'advanced'>): string {
  if (t.advanced?.label) return t.advanced.label
  return t.column === 'open' || t.column === 'dropped' ? 'Not since it was set up' : ''
}

/** What Worth a look says of a thread on the board too: "Overdue", "Untouched for a long stretch"; '' for nothing. */
export function warnWords(t: Pick<BoardThread, 'warn'>): string {
  if (t.warn === 'overdue') return 'Overdue'
  if (t.warn === 'quiet') return 'Untouched for a long stretch'
  return ''
}

/** True when an open thread has been quiet long enough to be worth a look (QUIET_SCENES or more). */
export const isQuiet = (t: Pick<BoardThread, 'column' | 'quietScenes'>): boolean =>
  t.column === 'open' && t.quietScenes != null && t.quietScenes >= QUIET_SCENES

/** "7 scenes", "1 scene", "Touched in the latest scene"; '' when it isn't open or nothing has touched it. */
export function quietWords(t: Pick<BoardThread, 'column' | 'quietScenes'>): string {
  if (t.column !== 'open' || t.quietScenes == null) return ''
  if (t.quietScenes === 0) return 'Touched in the latest scene'
  return `${t.quietScenes} ${t.quietScenes === 1 ? 'scene' : 'scenes'}`
}

/**
 * The ledger's rows: by how long each has been quiet (the quietest first; `ascending` turns it round) with the threads
 * that aren't open after the open ones, or by name. Ties keep the board's order (where each was set up).
 */
export function ledgerRows(board: ThreadsBoard, sort: LedgerSort, ascending = false): BoardThread[] {
  const order = new Map(board.threads.map((t, i) => [t.id, i]))
  const byName = (a: BoardThread, b: BoardThread): number => a.name.localeCompare(b.name) || order.get(a.id)! - order.get(b.id)!
  const quiet = (t: BoardThread): number | null => (t.column === 'open' ? (t.quietScenes ?? null) : null)
  return [...board.threads].sort((a, b) => {
    if (sort === 'name') return ascending ? -byName(a, b) : byName(a, b)
    const qa = quiet(a)
    const qb = quiet(b)
    if (qa === null || qb === null) return qa === qb ? order.get(a.id)! - order.get(b.id)! : qa === null ? 1 : -1
    return (ascending ? qa - qb : qb - qa) || order.get(a.id)! - order.get(b.id)!
  })
}

export type Column = BoardThread['column']

export const COLUMNS: { id: Column; title: string; hint: string; none: string }[] = [
  { id: 'open', title: 'Open', hint: 'Set up and still to be paid off', none: 'Nothing is open.' },
  { id: 'resolved', title: 'Resolved', hint: 'Set up and paid off', none: 'Nothing is resolved yet.' },
  { id: 'dropped', title: 'Dropped', hint: 'You decided not to pay these off', none: '' },
  { id: 'planned', title: 'Planned', hint: 'Not yet set up in the story', none: '' }
]

/** The board's columns with their threads. Dropped and Planned show only when a thread is dropped or planned. */
export function columnsOf(board: ThreadsBoard): { column: (typeof COLUMNS)[number]; threads: BoardThread[] }[] {
  return COLUMNS.map((column) => ({ column, threads: board.threads.filter((t) => t.column === column.id) })).filter(
    (c) => (c.column.id !== 'planned' && c.column.id !== 'dropped') || c.threads.length > 0
  )
}

/** A sentence about a place, split so the place itself can be a link to its scene. */
export interface PlaceWords {
  before: string
  /** The place, when there is one to show ("Book 1, Ch 3, Sc 2"). */
  place: string
  link: { storyId: ID; sceneId: ID } | null
}

const atOrIn = (label: string): string => (label.startsWith('the start of ') ? 'at' : 'in')

/** "Set up in Book 1, Ch 3, Sc 2", "To be set up in…", "Set up before the story begins", "Not set up in a scene yet". */
export function setUpWords(place: BoardPlace | null): PlaceWords {
  if (!place) return { before: 'Not set up in a scene yet', place: '', link: null }
  if (!place.label) return { before: 'Set up before the story begins', place: '', link: null }
  const verb = place.planned ? 'To be set up' : 'Set up'
  return { before: `${verb} ${atOrIn(place.label)} `, place: place.label, link: linkOf(place) }
}

/** "Paid off in Book 3, Ch 1, Sc 2", "To be paid off in…", or null when there is nothing to say. */
export function paidOffWords(place: BoardPlace | null): PlaceWords | null {
  if (!place) return null
  if (!place.label) return { before: 'Paid off before the story begins', place: '', link: null }
  const verb = place.planned ? 'To be paid off' : 'Paid off'
  return { before: `${verb} ${atOrIn(place.label)} `, place: place.label, link: linkOf(place) }
}

const linkOf = (p: BoardPlace): PlaceWords['link'] => (p.sceneId && p.storyId ? { storyId: p.storyId, sceneId: p.sceneId } : null)

/** "Open for 1 chapter", "Open for 12 chapters"; null for a thread that isn't open or opened in this chapter. */
export function openFor(t: Pick<BoardThread, 'column' | 'openChapters'>): string | null {
  if (t.column !== 'open' || !t.openChapters) return null
  return `Open for ${t.openChapters} ${t.openChapters === 1 ? 'chapter' : 'chapters'}`
}
