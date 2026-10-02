// All SQL for the codex and entry pages (milestone 3): the scenes' words and cards for finding where
// entries appear, first-exists points Adam changes, and putting a profile back after "Only from
// <story> on". Pure functions over a better-sqlite3 handle, no Electron imports.

import type Database from 'better-sqlite3'
import type { Entry, ExistsPoint, ID, Origin } from '@shared/types'
import { now } from '../util'
import { recordVersion } from './history'
import { addExistsPoint, listExistsPoints } from './memory'
import { getEntry } from './repo'

type DB = Database.Database
type Row = Record<string, unknown>

const json = <T>(s: unknown, fallback: T): T => {
  if (typeof s !== 'string' || s === '') return fallback
  try {
    return JSON.parse(s) as T
  } catch {
    return fallback
  }
}

// ---------- Scenes, for where entries appear ----------

/**
 * Every scene that isn't deleted, with a version that moves whenever its words or card change, and
 * its title. No text: the words are read only for scenes that changed since they were last read.
 */
export function sceneVersions(db: DB): Map<ID, { version: string; title: string }> {
  const rows = db.prepare('SELECT id, title, text_version, updated_at FROM scenes WHERE deleted_at IS NULL').all() as Row[]
  return new Map(
    rows.map((r) => [r.id as string, { version: `${r.text_version as number}|${r.updated_at as string}`, title: r.title as string }])
  )
}

/** What a scene's card says about who and where. */
export interface SceneCast {
  povId: ID | null
  presentIds: ID[]
  locationId: ID | null
}

function castOf(cardJson: unknown): SceneCast {
  const c = json<Record<string, unknown>>(cardJson, {})
  const id = (x: unknown): ID | null => (typeof x === 'string' && x ? x : null)
  return {
    povId: id(c.povId),
    presentIds: Array.isArray(c.presentIds) ? c.presentIds.filter((x): x is ID => typeof x === 'string' && !!x) : [],
    locationId: id(c.locationId)
  }
}

/** The words, card and version of some scenes (all scenes that aren't deleted when `ids` is null), in one query. */
export function sceneWords(db: DB, ids: ID[] | null): { id: ID; text: string; cast: SceneCast; version: string }[] {
  const cols = 'id, text, card_json, text_version, updated_at'
  const rows = (
    ids === null
      ? db.prepare(`SELECT ${cols} FROM scenes WHERE deleted_at IS NULL`).all()
      : ids.length
        ? db.prepare(`SELECT ${cols} FROM scenes WHERE id IN (SELECT value FROM json_each(?))`).all(JSON.stringify(ids))
        : []
  ) as Row[]
  return rows.map((r) => ({
    id: r.id as string,
    text: (r.text as string) ?? '',
    cast: castOf(r.card_json),
    version: `${r.text_version as number}|${r.updated_at as string}`
  }))
}

/** For each change pinned to a scene: the scene and every entry it is about (its own, and the other side of a relationship). */
export function sceneChangeEntries(db: DB): { sceneId: ID; entryIds: ID[] }[] {
  const rows = db
    .prepare(
      `SELECT entry_id, scene_id, kind, CASE WHEN kind IN ('relationship', 'full') THEN payload_json END AS payload
       FROM changes WHERE anchor = 'scene' AND scene_id IS NOT NULL AND deleted_at IS NULL`
    )
    .all() as Row[]
  return rows.map((r) => {
    const ids = new Set<ID>([r.entry_id as string])
    const p = json<Record<string, unknown>>(r.payload, {})
    if (r.kind === 'relationship' && typeof p.otherId === 'string') ids.add(p.otherId)
    if (r.kind === 'full' && Array.isArray(p.relationships))
      for (const rel of p.relationships as { otherId?: unknown }[]) if (typeof rel?.otherId === 'string') ids.add(rel.otherId)
    return { sceneId: r.scene_id as string, entryIds: [...ids] }
  })
}

// ---------- Stories and scenes, for checking a place ----------

/** Whether a story is there and not deleted. */
export const storyIsLive = (db: DB, id: ID): boolean => !!db.prepare('SELECT 1 FROM stories WHERE id = ? AND deleted_at IS NULL').get(id)

/**
 * The story a place belongs to (a scene's story, or the story whose start it is) while that place is
 * still in the world, in Recently deleted or not. Null when it is gone for good, or was never there.
 */
export function storyOfPlace(db: DB, p: { kind: string; storyId: ID | null; sceneId: ID | null }): ID | null {
  if (p.kind !== 'scene') return p.storyId && db.prepare('SELECT 1 FROM stories WHERE id = ?').get(p.storyId) ? p.storyId : null
  if (!p.sceneId) return null
  const r = db.prepare('SELECT c.story_id AS storyId FROM scenes s JOIN chapters c ON c.id = s.chapter_id WHERE s.id = ?').get(p.sceneId) as
    | Row
    | undefined
  return r ? (r.storyId as string) : null
}

// ---------- First-exists points Adam changes ----------

type PointInput = Omit<ExistsPoint, 'id' | 'entryId'>

const samePoint = (a: PointInput, b: PointInput): boolean =>
  a.kind === b.kind && (a.storyId ?? null) === (b.storyId ?? null) && (a.sceneId ?? null) === (b.sceneId ?? null)

/**
 * Makes an entry's first-exists points exactly these. Points that are already there as given keep
 * their row (so the app's default stays the first of its points); the rest are removed or added.
 */
export function replaceExistsPoints(db: DB, entryId: ID, points: PointInput[]): ExistsPoint[] {
  db.transaction(() => {
    const kept = new Set<ID>()
    const have = listExistsPoints(db, entryId)
    const toAdd: PointInput[] = []
    for (const p of points) {
      const same = have.find((h) => !kept.has(h.id) && samePoint(h, p) && h.byHand === p.byHand)
      if (same) kept.add(same.id)
      else toAdd.push(p)
    }
    const remove = db.prepare('DELETE FROM exists_points WHERE id = ?')
    for (const h of have) if (!kept.has(h.id)) remove.run(h.id)
    for (const p of toAdd) addExistsPoint(db, { ...p, entryId })
  })()
  return listExistsPoints(db, entryId)
}

// ---------- Putting a profile back ----------

/**
 * Sets some of an entry's profile back to how it was, with who each field came from, and writes a
 * memory-history version (Adam did it). `fields` is merged into the saved fields; `origins` null
 * lets a key follow the entry's own origin again.
 */
export function restoreProfile(
  db: DB,
  entryId: ID,
  values: { summary?: string; description?: string; fields?: Record<string, string> },
  origins: Record<string, Origin | null>
): Entry {
  const before = getEntry(db, entryId)
  const fieldOrigins: Record<string, Origin> = { ...before.fieldOrigins }
  for (const [k, v] of Object.entries(origins)) {
    if (v) fieldOrigins[k] = v
    else delete fieldOrigins[k]
  }
  db.prepare('UPDATE entries SET summary = ?, description = ?, fields_json = ?, field_origins_json = ?, updated_at = ? WHERE id = ?').run(
    values.summary ?? before.summary,
    values.description ?? before.description,
    JSON.stringify({ ...before.fields, ...(values.fields ?? {}) }),
    JSON.stringify(fieldOrigins),
    now(),
    entryId
  )
  const after = getEntry(db, entryId)
  recordVersion(db, { factKind: 'entry', factId: entryId, entryId, data: after, origin: 'adam' })
  return after
}
