// All SQL for the story index (overhaul phase 1, migration 5): a scene's row with its facts and thread events, written
// whole and dropped whole (a scene's rows are never patched: storyIndex/build.ts makes them again when what they were built
// from changes), where each scene sits in its story, the ends of facts (storyIndex/link.ts works them out), and the reads
// the look-ups and the free checks make. Pure functions over a better-sqlite3 handle, no Electron imports.

import type Database from 'better-sqlite3'
import type { EntryKind, ID } from '@shared/types'
import { newId, now } from '../util'
import type {
  IndexFact,
  IndexFactKind,
  IndexFilled,
  IndexOrigin,
  IndexScene,
  IndexThreadEvent,
  NewIndexFact,
  NewThreadEvent,
  PlacedFact,
  ThreadEvent
} from '../storyIndex/types'

type DB = Database.Database
type Row = Record<string, unknown>

const ids = (s: unknown): ID[] => {
  if (typeof s !== 'string' || !s) return []
  try {
    const v = JSON.parse(s) as unknown
    return Array.isArray(v) ? v.filter((x): x is ID => typeof x === 'string') : []
  } catch {
    return []
  }
}

/** Runs `run` over the ids a few hundred at a time (SQLite's limit on bound values). */
function chunked<T>(list: readonly ID[], run: (chunk: ID[], marks: string) => T[]): T[] {
  const out: T[] = []
  for (let i = 0; i < list.length; i += 500) {
    const chunk = list.slice(i, i + 500)
    if (chunk.length) out.push(...run(chunk, chunk.map(() => '?').join(',')))
  }
  return out
}

// ---------- Scene rows ----------

const toScene = (r: Row): IndexScene => ({
  sceneId: r.scene_id as string,
  storyId: r.story_id as string,
  position: r.position as number,
  label: r.label as string,
  gist: r.gist as string,
  present: ids(r.present_json),
  mentioned: ids(r.mentioned_json),
  placeEntryId: (r.place_entry_id as string) ?? null,
  whenText: r.when_text as string,
  sourceHash: r.source_hash as string,
  filled: r.filled as IndexFilled,
  updatedAt: r.updated_at as string
})

/** A story's scene rows, in story order. */
export function indexScenes(db: DB, storyId: ID): IndexScene[] {
  return (db.prepare('SELECT * FROM index_scenes WHERE story_id = ? ORDER BY position').all(storyId) as Row[]).map(toScene)
}

/** One scene's row, or null when it isn't in the index. */
export function indexScene(db: DB, sceneId: ID): IndexScene | null {
  const r = db.prepare('SELECT * FROM index_scenes WHERE scene_id = ?').get(sceneId) as Row | undefined
  return r ? toScene(r) : null
}

/** The scenes in the index under this story, with what each was built from and where it sits (no other columns). */
export function indexedScenes(db: DB, storyId: ID): Map<ID, { hash: string; position: number; label: string }> {
  const rows = db.prepare('SELECT scene_id, source_hash, position, label FROM index_scenes WHERE story_id = ?').all(storyId) as Row[]
  return new Map(
    rows.map((r) => [r.scene_id as string, { hash: r.source_hash as string, position: r.position as number, label: r.label as string }])
  )
}

/** The scenes of a story between two places in it (both included), in story order. */
export function indexScenesBetween(db: DB, storyId: ID, from: number, to: number): IndexScene[] {
  return (
    db
      .prepare('SELECT * FROM index_scenes WHERE story_id = ? AND position BETWEEN ? AND ? ORDER BY position')
      .all(storyId, from, to) as Row[]
  ).map(toScene)
}

/** The last scene before a place in the story that has someone there; null when none has. */
export function lastPresentBefore(db: DB, storyId: ID, entryId: ID, before: number): IndexScene | null {
  const r = db
    .prepare(
      `SELECT * FROM index_scenes WHERE story_id = ? AND position < ?
       AND EXISTS (SELECT 1 FROM json_each(present_json) WHERE value = ?) ORDER BY position DESC LIMIT 1`
    )
    .get(storyId, before, entryId) as Row | undefined
  return r ? toScene(r) : null
}

/**
 * Writes a scene's row with its facts and thread events, in place of whatever the index had for it (its own facts: the
 * ones its build made, wherever they start).
 */
export function writeSceneIndex(
  db: DB,
  scene: Omit<IndexScene, 'updatedAt'>,
  facts: readonly NewIndexFact[],
  threads: readonly NewThreadEvent[]
): void {
  const t = now()
  db.transaction(() => {
    dropSceneIndex(db, [scene.sceneId])
    db.prepare(
      `INSERT INTO index_scenes (scene_id, story_id, position, label, gist, present_json, mentioned_json, place_entry_id, when_text,
         source_hash, filled, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      scene.sceneId,
      scene.storyId,
      scene.position,
      scene.label,
      scene.gist,
      JSON.stringify(scene.present),
      JSON.stringify(scene.mentioned),
      scene.placeEntryId,
      scene.whenText,
      scene.sourceHash,
      scene.filled,
      t
    )
    const fact = db.prepare(
      `INSERT INTO index_facts (id, story_id, entry_id, kind, slot, value, from_scene_id, until_scene_id, source_scene_id, quote, origin,
         created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`
    )
    for (const f of facts)
      fact.run(newId(), scene.storyId, f.entryId, f.kind, f.slot, f.value, f.fromSceneId, scene.sceneId, f.quote, f.origin, t)
    const thread = db.prepare('INSERT INTO index_threads (id, story_id, thread_entry_id, scene_id, event, note) VALUES (?, ?, ?, ?, ?, ?)')
    for (const e of threads) thread.run(newId(), scene.storyId, e.threadEntryId, scene.sceneId, e.event, e.note)
  })()
}

/** Takes scenes out of the index: their rows, the facts their builds made and their thread events. */
export function dropSceneIndex(db: DB, sceneIds: readonly ID[]): void {
  chunked(sceneIds, (chunk, marks) => {
    db.prepare(`DELETE FROM index_facts WHERE source_scene_id IN (${marks})`).run(...chunk)
    db.prepare(`DELETE FROM index_threads WHERE scene_id IN (${marks})`).run(...chunk)
    db.prepare(`DELETE FROM index_scenes WHERE scene_id IN (${marks})`).run(...chunk)
    return []
  })
}

/** Takes a whole story out of the index (it was deleted). */
export function dropStoryIndex(db: DB, storyId: ID): void {
  db.transaction(() => {
    db.prepare('DELETE FROM index_facts WHERE story_id = ?').run(storyId)
    db.prepare('DELETE FROM index_threads WHERE story_id = ?').run(storyId)
    db.prepare('DELETE FROM index_scenes WHERE story_id = ?').run(storyId)
  })()
}

/** Where each scene now sits in its story; only rows that moved are written. How many moved. */
export function placeIndexScenes(db: DB, places: readonly { sceneId: ID; position: number; label: string }[]): number {
  const get = db.prepare('SELECT position, label FROM index_scenes WHERE scene_id = ?')
  const set = db.prepare('UPDATE index_scenes SET position = ?, label = ? WHERE scene_id = ?')
  let moved = 0
  for (const p of places) {
    const r = get.get(p.sceneId) as Row | undefined
    if (!r || (r.position === p.position && r.label === p.label)) continue
    set.run(p.position, p.label, p.sceneId)
    moved++
  }
  return moved
}

// ---------- Facts ----------

const toFact = (r: Row): IndexFact => ({
  id: r.id as string,
  storyId: r.story_id as string,
  entryId: (r.entry_id as string) ?? null,
  kind: r.kind as IndexFactKind,
  slot: r.slot as string,
  value: r.value as string,
  fromSceneId: r.from_scene_id as string,
  untilSceneId: (r.until_scene_id as string) ?? null,
  sourceSceneId: r.source_scene_id as string,
  quote: r.quote as string,
  origin: r.origin as IndexOrigin,
  createdAt: r.created_at as string
})

const toPlaced = (r: Row): PlacedFact => ({
  ...toFact(r),
  fromPosition: r.from_pos as number,
  fromLabel: r.from_label as string,
  untilPosition: (r.until_pos as number) ?? null,
  untilLabel: (r.until_label as string) ?? null
})

/** Facts with where they start and stop in the story (a start or an end in another story's scene doesn't count here). */
const PLACED = `SELECT f.*, f.rowid AS seq, f.value <> '' AS has_value, fs.position AS from_pos, fs.label AS from_label,
    us.position AS until_pos, us.label AS until_label
  FROM index_facts f
  JOIN index_scenes fs ON fs.scene_id = f.from_scene_id AND fs.story_id = f.story_id
  LEFT JOIN index_scenes us ON us.scene_id = f.until_scene_id AND us.story_id = f.story_id`
/** Within a scene, where a fact stops comes before a fact starting there: what starts holds at the scene's end. */
const IN_ORDER = 'ORDER BY from_pos, has_value, seq'

/** Every fact and end of a story, in story order (for working out where each fact stops). */
export function storyFactsInOrder(db: DB, storyId: ID): PlacedFact[] {
  return (db.prepare(`${PLACED} WHERE f.story_id = ? ${IN_ORDER}`).all(storyId) as Row[]).map(toPlaced)
}

/** Sets where facts stop (the scene, or null while still true). */
export function setFactEnds(db: DB, ends: readonly { id: ID; untilSceneId: ID | null }[]): void {
  const set = db.prepare('UPDATE index_facts SET until_scene_id = ? WHERE id = ?')
  db.transaction(() => {
    for (const e of ends) set.run(e.untilSceneId, e.id)
  })()
}

/**
 * The facts true at a point of the story: as the scene at `cut` ends (a fact started there counts, one stopped there
 * doesn't). With `entryId`, its own facts and the relationships others have with it; with `kinds`, only those kinds.
 */
export function factsAt(db: DB, storyId: ID, cut: number, filter: { entryId?: ID; kinds?: readonly IndexFactKind[] } = {}): PlacedFact[] {
  const kinds = filter.kinds?.length ? ` AND f.kind IN (${filter.kinds.map(() => '?').join(',')})` : ''
  const visible = `f.story_id = ? AND f.value <> '' AND fs.position <= ? AND (us.position IS NULL OR us.position > ?)${kinds}`
  const args = [storyId, cut, cut, ...(filter.kinds ?? [])]
  // Its own facts, and the relationships others have with it: two indexed reads rather than one with an OR.
  const sql = filter.entryId
    ? `${PLACED} WHERE ${visible} AND f.entry_id = ? UNION ALL ${PLACED} WHERE ${visible} AND f.kind = 'relationship' AND f.slot = ? ${IN_ORDER}`
    : `${PLACED} WHERE ${visible} ${IN_ORDER}`
  const all = filter.entryId ? [...args, filter.entryId, ...args, `with:${filter.entryId}`] : args
  return (db.prepare(sql).all(...all) as Row[]).map(toPlaced)
}

// ---------- Plot threads ----------

/** A story's thread events up to a point (included), in story order, with where each is. */
export function threadEventsUpTo(db: DB, storyId: ID, cut: number): (IndexThreadEvent & { position: number; label: string })[] {
  return (
    db
      .prepare(
        `SELECT t.*, s.position, s.label FROM index_threads t JOIN index_scenes s ON s.scene_id = t.scene_id AND s.story_id = t.story_id
         WHERE t.story_id = ? AND s.position <= ? ORDER BY s.position, t.rowid`
      )
      .all(storyId, cut) as Row[]
  ).map((r) => ({
    id: r.id as string,
    storyId: r.story_id as string,
    threadEntryId: r.thread_entry_id as string,
    sceneId: r.scene_id as string,
    event: r.event as ThreadEvent,
    note: r.note as string,
    position: r.position as number,
    label: r.label as string
  }))
}

// ---------- What the build and the look-ups read from the world ----------

/** The words and title of these live scenes, by id (a few hundred at a time). */
export function sceneWords(db: DB, sceneIds: readonly ID[]): Map<ID, { title: string; text: string }> {
  const rows = chunked(
    sceneIds,
    (chunk, marks) => db.prepare(`SELECT id, title, text FROM scenes WHERE deleted_at IS NULL AND id IN (${marks})`).all(...chunk) as Row[]
  )
  return new Map(rows.map((r) => [r.id as string, { title: (r.title as string) ?? '', text: (r.text as string) ?? '' }]))
}

/** The live story a live scene is in, or null. */
export function storyOfIndexScene(db: DB, sceneId: ID): ID | null {
  const r = db
    .prepare(
      `SELECT c.story_id FROM scenes s JOIN chapters c ON c.id = s.chapter_id JOIN stories st ON st.id = c.story_id
       WHERE s.id = ? AND s.deleted_at IS NULL AND c.deleted_at IS NULL AND st.deleted_at IS NULL`
    )
    .get(sceneId) as Row | undefined
  return r ? (r.story_id as string) : null
}

/** The story a scene is filed under in the index, or null. */
export function indexStoryOf(db: DB, sceneId: ID): ID | null {
  const r = db.prepare('SELECT story_id FROM index_scenes WHERE scene_id = ?').get(sceneId) as Row | undefined
  return r ? (r.story_id as string) : null
}

/** Live entries' names and kinds, by id. */
export function entryNames(db: DB, entryIds: readonly ID[]): Map<ID, { name: string; kind: EntryKind; parentId: ID | null }> {
  const rows = chunked(
    [...new Set(entryIds)],
    (chunk, marks) =>
      db.prepare(`SELECT id, name, kind, parent_id FROM entries WHERE deleted_at IS NULL AND id IN (${marks})`).all(...chunk) as Row[]
  )
  return new Map(
    rows.map((r) => [r.id as string, { name: r.name as string, kind: r.kind as EntryKind, parentId: (r.parent_id as string) ?? null }])
  )
}

/**
 * A story's routes (facts of kind 'route', free rules 2026-10-19: how long it takes from one place to another, from
 * Adam's place entries and from narration), in story order, whatever scene they were stated in: places don't move.
 */
export function storyRouteFacts(db: DB, storyId: ID): PlacedFact[] {
  return (db.prepare(`${PLACED} WHERE f.story_id = ? AND f.kind = 'route' AND f.value <> '' ${IN_ORDER}`).all(storyId) as Row[]).map(toPlaced)
}

/** Every live place's parent place, by id (a room in an inn in a town). */
export function placeParents(db: DB): Map<ID, ID | null> {
  const rows = db.prepare("SELECT id, parent_id FROM entries WHERE deleted_at IS NULL AND kind = 'place'").all() as Row[]
  return new Map(rows.map((r) => [r.id as string, (r.parent_id as string) ?? null]))
}

/**
 * The live entry with this id, else the one with this name, else the one with this other name (whatever their case);
 * null when none, or when two share the name asked for.
 */
export function findIndexEntry(db: DB, idOrName: string): { id: ID; name: string; kind: EntryKind } | null {
  const pick = (r: Row): { id: ID; name: string; kind: EntryKind } => ({
    id: r.id as string,
    name: r.name as string,
    kind: r.kind as EntryKind
  })
  const byId = db.prepare('SELECT id, name, kind FROM entries WHERE deleted_at IS NULL AND id = ?').get(idOrName) as Row | undefined
  if (byId) return pick(byId)
  const wanted = idOrName.replace(/\s+/g, ' ').trim()
  if (!wanted) return null
  const named = db.prepare('SELECT id, name, kind FROM entries WHERE deleted_at IS NULL AND name = ? COLLATE NOCASE').all(wanted) as Row[]
  if (named.length) return named.length === 1 ? pick(named[0]) : null
  const lower = wanted.toLowerCase()
  const others = (
    db
      .prepare('SELECT id, name, kind, aliases_json FROM entries WHERE deleted_at IS NULL AND aliases_json LIKE ?')
      .all(`%${wanted.slice(0, 40)}%`) as Row[]
  ).filter((r) => ids(r.aliases_json).some((a) => a.replace(/\s+/g, ' ').trim().toLowerCase() === lower))
  return others.length === 1 ? pick(others[0]) : null
}
