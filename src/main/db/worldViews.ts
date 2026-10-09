// SQL for the timeline, relationship map and plot threads board (milestone 3). The views work out the
// in-world order themselves and never write it into the scene cards; the only thing they keep is where
// each character sits on the relationship map (in `meta`, so no table of their own).
import type Database from 'better-sqlite3'
import type { BoardMarks, BoardSceneCard } from '@shared/contracts/worldViews'
import type { ID, SceneCard, SceneStatus } from '@shared/types'
import { getMeta, setMeta } from './repo'

type DB = Database.Database
type Row = Record<string, unknown>

/**
 * How many rows this connection has changed since the world was opened. The views keep what they read
 * until it moves: the open world has a single connection, so an unchanged count means nothing changed.
 */
export const changesMade = (db: DB): number => (db.prepare('SELECT total_changes() AS n').get() as { n: number }).n

/** Each live story's time gap since the story before ("200 years"), for the stories that have one. */
export function storyGaps(db: DB): Map<ID, string> {
  const rows = db.prepare("SELECT id, time_gap FROM stories WHERE deleted_at IS NULL AND trim(time_gap) != ''").all() as Row[]
  return new Map(rows.map((r) => [r.id as ID, (r.time_gap as string).trim()]))
}

/** The parts of a scene card the views use. */
export type CardInfo = Pick<SceneCard, 'when' | 'povId' | 'presentIds' | 'locationId' | 'setsUpIds' | 'paysOffIds' | 'goal' | 'beats'> & {
  title: string
  /** The scene's status and words (the timeline's cards show them; the story board reads them from the outline). */
  status: SceneStatus
  words: number
  /** Nothing yet on what happens (no beats, goal, conflict, outcome or notes). */
  empty: boolean
}

const ids = (v: unknown): ID[] => (Array.isArray(v) ? v.filter((x): x is ID => typeof x === 'string' && x !== '') : [])
const id = (v: unknown): ID | null => (typeof v === 'string' && v ? v : null)

type CardFields = Omit<CardInfo, 'title' | 'status' | 'words'>

// Cards read before, by scene, with the text each was read from: most cards are the same from one
// visit to the next, so only the ones that changed are read again.
const read = new WeakMap<DB, Map<ID, { json: string; fields: CardFields }>>()

function fieldsOf(json: string): CardFields {
  let card: Partial<Record<keyof SceneCard, unknown>> = {}
  try {
    card = json ? (JSON.parse(json) as typeof card) : {}
  } catch {
    // A damaged card shows as an empty one rather than hiding the scene.
  }
  const text = (v: unknown): string => (typeof v === 'string' ? v : '')
  const beats = Array.isArray(card.beats) ? card.beats.filter((b): b is string => typeof b === 'string') : []
  const goal = text(card.goal)
  return {
    goal,
    beats,
    empty: !beats.some((b) => b.trim()) && ![goal, text(card.conflict), text(card.outcome), text(card.notes)].some((t) => t.trim()),
    when: typeof card.when === 'string' ? card.when : '',
    povId: id(card.povId),
    presentIds: ids(card.presentIds),
    locationId: id(card.locationId),
    setsUpIds: ids(card.setsUpIds),
    paysOffIds: ids(card.paysOffIds)
  }
}

const STATUSES = new Set<SceneStatus>(['planned', 'drafted', 'revised', 'done'])

/** Every live scene's card, by scene id: one query however many scenes. */
export function sceneCards(db: DB): Map<ID, CardInfo> {
  const rows = db.prepare('SELECT id, title, status, word_count, card_json FROM scenes WHERE deleted_at IS NULL').all() as Row[]
  const before = read.get(db)
  const now = new Map<ID, { json: string; fields: CardFields }>()
  const out = new Map<ID, CardInfo>()
  for (const r of rows) {
    const sceneId = r.id as string
    const json = typeof r.card_json === 'string' ? r.card_json : ''
    const last = before?.get(sceneId)
    const fields = last && last.json === json ? last.fields : fieldsOf(json)
    now.set(sceneId, { json, fields })
    const status = STATUSES.has(r.status as SceneStatus) ? (r.status as SceneStatus) : 'planned'
    out.set(sceneId, { ...fields, title: (r.title as string) ?? '', status, words: Number(r.word_count) || 0 })
  }
  read.set(db, now)
  return out
}

/** The `meta` key holding where each character sits on the relationship map: JSON of id to [x, y]. */
export const MAP_LAYOUT_KEY = 'map_layout'

/** Where each character sat on the relationship map when it was last laid out; null when it never was. */
export function readMapLayout(db: DB): Map<ID, { x: number; y: number }> | null {
  let saved: unknown
  try {
    saved = JSON.parse(getMeta(db, MAP_LAYOUT_KEY) ?? 'null')
  } catch {
    return null
  }
  if (!saved || typeof saved !== 'object') return null
  const out = new Map<ID, { x: number; y: number }>()
  for (const [id, p] of Object.entries(saved as Record<string, unknown>)) {
    if (Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) out.set(id, { x: p[0] as number, y: p[1] as number })
  }
  return out
}

/** Keeps where each character sits on the relationship map, so it looks the same after a restart. */
export function writeMapLayout(db: DB, positions: Map<ID, { x: number; y: number }>): void {
  const out: Record<string, [number, number]> = {}
  for (const [id, p] of positions) out[id] = [p.x, p.y]
  setMeta(db, MAP_LAYOUT_KEY, JSON.stringify(out))
}

// ---------- The desk's story board ----------

/** Each live scene's card in a story (one query for the story's scenes; the cards as sceneCards reads them). */
export function storySceneCards(db: DB, storyId: ID): Record<ID, BoardSceneCard> {
  const rows = db
    .prepare(
      'SELECT s.id FROM scenes s JOIN chapters c ON c.id = s.chapter_id WHERE c.story_id = ? AND s.deleted_at IS NULL AND c.deleted_at IS NULL'
    )
    .all(storyId) as Row[]
  const cards = sceneCards(db)
  const out: Record<ID, BoardSceneCard> = {}
  for (const r of rows) {
    const c = cards.get(r.id as ID)
    if (!c) continue
    const { title: _title, status: _status, words: _words, ...card } = c
    out[r.id as ID] = card
  }
  return out
}

/** The `meta` key holding the story board's marks: JSON of { aiIdeas: scene ids }. */
export const BOARD_KEY = 'desk_board'

/** The story board's marks, with any for scenes that are gone left out. */
export function readBoardMarks(db: DB): BoardMarks {
  let saved: unknown
  try {
    saved = JSON.parse(getMeta(db, BOARD_KEY) ?? 'null')
  } catch {
    saved = null
  }
  const ids = saved && typeof saved === 'object' && Array.isArray((saved as BoardMarks).aiIdeas) ? (saved as BoardMarks).aiIdeas.filter((x) => typeof x === 'string') : []
  return { aiIdeas: liveScenes(db, ids) }
}

/** Marks a scene as planned from an AI idea, or takes the mark off; marks for scenes that are gone are dropped. */
export function markAiIdea(db: DB, sceneId: ID, on: boolean): BoardMarks {
  const now = new Set(readBoardMarks(db).aiIdeas)
  if (on) now.add(sceneId)
  else now.delete(sceneId)
  const marks = { aiIdeas: liveScenes(db, [...now]) }
  setMeta(db, BOARD_KEY, JSON.stringify(marks))
  return marks
}

/** The ids that are live scenes, in the order given. */
function liveScenes(db: DB, ids: ID[]): ID[] {
  if (!ids.length) return []
  const live = new Set((db.prepare('SELECT id FROM scenes WHERE deleted_at IS NULL').all() as Row[]).map((r) => r.id as ID))
  return ids.filter((x) => live.has(x))
}
