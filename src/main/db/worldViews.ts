// SQL for the timeline, relationship map and plot threads board (milestone 3). The views work out the
// in-world order themselves and never write it into the scene cards; the only thing they keep is where
// each character sits on the relationship map (in `meta`, so no table of their own). Putting events in the
// scene they happen in (worldViews/eventHomes.ts) moves their first-exists points, with Undo.
import type Database from 'better-sqlite3'
import type { BoardMarks, BoardSceneCard } from '@shared/contracts/worldViews'
import type { ExistsKind, ID, SceneCard, SceneStatus } from '@shared/types'
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
/** The live scenes with words in them (not only planned). */
export function writtenScenes(db: DB): Set<ID> {
  const rows = db.prepare('SELECT id FROM scenes WHERE deleted_at IS NULL AND word_count > 0').all() as Row[]
  return new Set(rows.map((r) => r.id as string))
}

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

/** The `meta` key holding where each character Adam dragged on the map sat before he first moved it: JSON of id to [x, y]. */
export const MAP_MOVED_KEY = 'map_moved'

/** Where each dragged character sat before it was first dragged (since the last reset). */
export function readMapMoved(db: DB): Map<ID, { x: number; y: number }> {
  let saved: unknown
  try {
    saved = JSON.parse(getMeta(db, MAP_MOVED_KEY) ?? 'null')
  } catch {
    saved = null
  }
  const out = new Map<ID, { x: number; y: number }>()
  if (!saved || typeof saved !== 'object') return out
  for (const [id, p] of Object.entries(saved as Record<string, unknown>)) {
    if (Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) out.set(id, { x: p[0] as number, y: p[1] as number })
  }
  return out
}

export function writeMapMoved(db: DB, moved: Map<ID, { x: number; y: number }>): void {
  const out: Record<string, [number, number]> = {}
  for (const [id, p] of moved) out[id] = [p.x, p.y]
  setMeta(db, MAP_MOVED_KEY, JSON.stringify(out))
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

// ---------- Events in the scene they happen in (2026-10-19, worldViews/eventHomes.ts) ----------

/**
 * The live events a World build made (the Story builder's and a recipe story's builds are World builds too), each with
 * the summary's words its line in What changed quotes: only while that line isn't undone.
 */
export function builtEvents(db: DB): Map<ID, { runId: ID; quote: string }> {
  const rows = db
    .prepare(
      `SELECT l.entry_id AS id, l.run_id AS run, l.quote AS quote FROM memory_log l JOIN entries e ON e.id = l.entry_id
       WHERE l.scene_id IS NULL AND l.what = 'entry' AND l.action = 'added' AND l.undone_at IS NULL
         AND l.undo_json LIKE '{"op":"world-build"%' AND e.kind = 'event' AND e.deleted_at IS NULL
       ORDER BY l.rowid`
    )
    .all() as Row[]
  const out = new Map<ID, { runId: ID; quote: string }>()
  for (const r of rows) if (!out.has(r.id as ID)) out.set(r.id as ID, { runId: r.run as ID, quote: (r.quote as string) ?? '' })
  return out
}

/**
 * The scenes where the memory keeper read something of these events in the words, by event: a change it made there
 * about one, or tying someone to one ("involved in"), still live. (The words its facts rest on: history.entryLinkScenes.)
 */
export function textChangeScenes(db: DB, eventIds: ID[]): Map<ID, Set<ID>> {
  const out = new Map<ID, Set<ID>>()
  if (!eventIds.length) return out
  const rows = db
    .prepare(
      `SELECT CASE WHEN c.entry_id IN (SELECT value FROM json_each(@ids)) THEN c.entry_id ELSE json_extract(c.payload_json, '$.otherId') END AS id,
         c.scene_id AS scene
       FROM changes c
       WHERE c.deleted_at IS NULL AND c.origin = 'text' AND c.anchor = 'scene' AND c.scene_id IS NOT NULL
         AND (c.entry_id IN (SELECT value FROM json_each(@ids))
           OR (c.kind = 'relationship' AND json_extract(c.payload_json, '$.otherId') IN (SELECT value FROM json_each(@ids))))`
    )
    .all({ ids: JSON.stringify([...new Set(eventIds)]) }) as Row[]
  for (const r of rows) {
    const id = r.id as ID
    const set = out.get(id)
    if (set) set.add(r.scene as ID)
    else out.set(id, new Set([r.scene as ID]))
  }
  return out
}

/** Where a first-exists point is (an event put at its scene, or put back). */
export function setExistsPointPlace(db: DB, pointId: ID, p: { kind: ExistsKind; storyId: ID | null; sceneId: ID | null }): void {
  db.prepare('UPDATE exists_points SET kind = ?, story_id = ?, scene_id = ? WHERE id = ?').run(p.kind, p.storyId, p.sceneId, pointId)
}

/** An entry's scene of origin (where it first exists by default). */
export function setOriginScene(db: DB, entryId: ID, sceneId: ID | null): void {
  db.prepare('UPDATE entries SET origin_scene_id = ? WHERE id = ?').run(sceneId, entryId)
}

/** One first-exists point as it is now; null when it is gone. */
export function existsPointPlace(db: DB, pointId: ID): { entryId: ID; kind: ExistsKind; storyId: ID | null; sceneId: ID | null; byHand: boolean } | null {
  const r = db.prepare('SELECT entry_id, kind, story_id, scene_id, by_hand FROM exists_points WHERE id = ?').get(pointId) as Row | undefined
  return r
    ? { entryId: r.entry_id as ID, kind: r.kind as ExistsKind, storyId: (r.story_id as ID) ?? null, sceneId: (r.scene_id as ID) ?? null, byHand: !!r.by_hand }
    : null
}

/** An entry's scene of origin as it is now (deleted entries too); undefined when it is gone for good. */
export function originSceneOf(db: DB, entryId: ID): ID | null | undefined {
  const r = db.prepare('SELECT origin_scene_id FROM entries WHERE id = ?').get(entryId) as Row | undefined
  return r ? ((r.origin_scene_id as ID) ?? null) : undefined
}

/** The story a live scene is in; null when the scene (or its chapter) is deleted or gone. */
export function liveSceneStory(db: DB, sceneId: ID): ID | null {
  const r = db
    .prepare('SELECT c.story_id AS storyId FROM scenes s JOIN chapters c ON c.id = s.chapter_id WHERE s.id = ? AND s.deleted_at IS NULL AND c.deleted_at IS NULL')
    .get(sceneId) as Row | undefined
  return r ? (r.storyId as ID) : null
}
