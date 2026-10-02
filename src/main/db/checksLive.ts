// The SQL of the live checks (milestone 5): the names they match spellings against, and the flags Adam
// ignored. An ignored flag is an `issues` row with status 'ignored', kind phrase, repetition or spelling,
// and its key in `payload_json.key` (see liveKey in src/shared/liveChecks.ts). A spelling is ignored
// across the world; a phrase or a repetition only in the scene it was ignored in.
import type Database from 'better-sqlite3'
import type { ID } from '@shared/types'
import type { LiveIgnore } from '@shared/contracts/checks'
import { newId, now } from '../util'

type DB = Database.Database
type Row = Record<string, unknown>

const LIVE_KINDS = "('phrase', 'repetition', 'spelling')"

const list = (s: unknown): string[] => {
  try {
    const v = JSON.parse(String(s ?? '[]')) as unknown
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/** Every entry not in Recently deleted: its name and aliases. */
export function liveEntryNames(db: DB): { id: ID; kind: string; name: string; aliases: string[] }[] {
  const rows = db.prepare('SELECT id, kind, name, aliases_json FROM entries WHERE deleted_at IS NULL ORDER BY kind, name COLLATE NOCASE').all() as Row[]
  return rows.map((r) => ({ id: r.id as ID, kind: r.kind as string, name: r.name as string, aliases: list(r.aliases_json) }))
}

/** The keys ignored for a scene, and the spellings ignored anywhere in the world. */
export function liveIgnores(db: DB, sceneId: ID): LiveIgnore[] {
  const rows = db
    .prepare(
      `SELECT kind, json_extract(payload_json, '$.key') AS key FROM issues
       WHERE status = 'ignored' AND kind IN ${LIVE_KINDS} AND (scene_id = ? OR kind = 'spelling')
       ORDER BY created_at`
    )
    .all(sceneId) as Row[]
  const seen = new Set<string>()
  const out: LiveIgnore[] = []
  for (const r of rows) {
    const key = typeof r.key === 'string' ? r.key : ''
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push({ kind: r.kind as LiveIgnore['kind'], key })
  }
  return out
}

/** Marks a live flag as intended. Does nothing when it already is. */
export function ignoreLiveFlag(
  db: DB,
  i: { sceneId: ID; storyId: ID | null; kind: LiveIgnore['kind']; key: string; quote: string; message: string }
): void {
  if (liveIgnores(db, i.sceneId).some((x) => x.key === i.key)) return
  const t = now()
  db.prepare(
    `INSERT INTO issues (id, scene_id, story_id, kind, severity, status, quote, message, payload_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'minor', 'ignored', ?, ?, ?, ?, ?)`
  ).run(newId(), i.sceneId, i.storyId, i.kind, i.quote, i.message, JSON.stringify({ key: i.key }), t, t)
}

/** Takes back an ignore (Undo): the scene's own, or a spelling ignored anywhere. Returns how many rows went. */
export function unignoreLiveFlag(db: DB, sceneId: ID, key: string): number {
  return db
    .prepare(
      `DELETE FROM issues WHERE status = 'ignored' AND kind IN ${LIVE_KINDS}
       AND json_extract(payload_json, '$.key') = ? AND (scene_id = ? OR kind = 'spelling')`
    )
    .run(key, sceneId).changes
}
