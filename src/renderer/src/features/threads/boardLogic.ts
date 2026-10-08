// Pure helpers for the plot threads board: its columns and the words on each card, and the ledger's rows (World Memory
// Overhaul B4). Tested in boardLogic.test.ts.
import type { ID } from '@shared/types'
import { QUIET_SCENES, type BoardPlace, type BoardThread, type ThreadsBoard } from '@shared/contracts/worldViews'

// ---------- The ledger (B4) ----------

export type LedgerSort = 'quiet' | 'name'

const STATUS_WORDS: Record<Column, string> = { open: 'Open', resolved: 'Resolved', planned: 'Planned' }
export const statusWords = (t: Pick<BoardThread, 'column'>): string => STATUS_WORDS[t.column]

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
  { id: 'planned', title: 'Planned', hint: 'Not yet set up in the story', none: '' }
]

/** The board's columns with their threads. Planned shows only when a thread is planned. */
export function columnsOf(board: ThreadsBoard): { column: (typeof COLUMNS)[number]; threads: BoardThread[] }[] {
  return COLUMNS.map((column) => ({ column, threads: board.threads.filter((t) => t.column === column.id) })).filter(
    (c) => c.column.id !== 'planned' || c.threads.length > 0
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
