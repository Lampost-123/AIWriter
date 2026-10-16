// End-of-chapter snapshots (long story memory fix 15): how things stand at the end of each chapter, worked out from the
// story record with no AI (memory/chapterRecord.ts), kept in the world's meta table, one row a chapter
// (`chapter_snapshot:<chapter id>`, JSON of StoredSnapshot), as chapter cards and thread plans are, so it travels with the
// world and needs no migration. `key` says what it was worked out from (keeper/snapshots.ts), so it is worked out again
// only when that changes. A chapter in Recently deleted keeps its row; purgeTrash drops the rows of chapters gone for
// good (db/trash.ts). Also the stamps those keys are made of: one query each, however long the story.

import type Database from 'better-sqlite3'
import type { ID } from '@shared/types'
import type { ChapterSnapshot } from '../memory/snapshot'

type DB = Database.Database
type Row = Record<string, unknown>

export const SNAPSHOT_PREFIX = 'chapter_snapshot:'
const key = (chapterId: ID): string => `${SNAPSHOT_PREFIX}${chapterId}`

/** A snapshot as kept: what it was worked out from, and the snapshot (null for a chapter with no words yet). */
export interface StoredSnapshot {
  key: string
  snapshot: ChapterSnapshot | null
}

function readRow(raw: string): StoredSnapshot | null {
  try {
    const v = JSON.parse(raw) as Partial<StoredSnapshot> | null
    if (!v || typeof v !== 'object' || typeof v.key !== 'string') return null
    const s = v.snapshot
    return { key: v.key, snapshot: s && typeof s === 'object' && typeof s.chapterId === 'string' ? s : null }
  } catch {
    // A damaged row reads as none: it is worked out again.
    return null
  }
}

/** The kept snapshots of these chapters (every chapter's when none are named), by chapter id: one query. */
export function storedSnapshots(db: DB, chapterIds?: ID[]): Map<ID, StoredSnapshot> {
  const out = new Map<ID, StoredSnapshot>()
  if (chapterIds && !chapterIds.length) return out
  const rows = (
    chapterIds
      ? db.prepare('SELECT key, value FROM meta WHERE key IN (SELECT ? || value FROM json_each(?))').all(SNAPSHOT_PREFIX, JSON.stringify(chapterIds))
      : db.prepare(`SELECT key, value FROM meta WHERE substr(key, 1, ${SNAPSHOT_PREFIX.length}) = ?`).all(SNAPSHOT_PREFIX)
  ) as { key: string; value: string }[]
  for (const r of rows) {
    const s = readRow(r.value)
    if (s) out.set(r.key.slice(SNAPSHOT_PREFIX.length), s)
  }
  return out
}

/** Keeps a chapter's snapshot with what it was worked out from. */
export function putSnapshot(db: DB, chapterId: ID, s: StoredSnapshot): void {
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key(chapterId), JSON.stringify(s))
}

/** Takes away the snapshots of chapters gone for good (no longer in the world at all; one in Recently deleted stays). */
export function dropSnapshotsOfGoneChapters(db: DB): void {
  db.prepare(`DELETE FROM meta WHERE substr(key, 1, ${SNAPSHOT_PREFIX.length}) = ? AND substr(key, ${SNAPSHOT_PREFIX.length + 1}) NOT IN (SELECT id FROM chapters)`).run(
    SNAPSHOT_PREFIX
  )
}

/**
 * What a chapter's snapshot rests on, scene by scene, for these scenes: the version of its words the memory last read,
 * and each change pinned to it or ended in it (its id, when it last changed, whether it is deleted). One query each.
 */
export function sceneStamps(db: DB, sceneIds: ID[]): Map<ID, string> {
  const out = new Map<ID, string>()
  if (!sceneIds.length) return out
  const ids = JSON.stringify(sceneIds)
  for (const r of db.prepare('SELECT id, memory_version FROM scenes WHERE id IN (SELECT value FROM json_each(?))').all(ids) as Row[])
    out.set(r.id as string, `m${r.memory_version as number}`)
  const rows = db
    .prepare(
      `SELECT id, scene_id, until_scene_id, updated_at, deleted_at FROM changes
       WHERE scene_id IN (SELECT value FROM json_each(?)) OR until_scene_id IN (SELECT value FROM json_each(?))
       ORDER BY id`
    )
    .all(ids, ids) as Row[]
  for (const r of rows) {
    const stamp = `${r.id as string}@${r.updated_at as string}${r.deleted_at ? '-' : ''}`
    for (const at of [r.scene_id, r.until_scene_id]) {
      if (typeof at === 'string' && out.has(at)) out.set(at, `${out.get(at)};${stamp}`)
    }
  }
  return out
}

/**
 * What every snapshot of a story also rests on: the changes pinned anywhere but its own scenes (the starting setup,
 * story starts, and the scenes of other stories, such as the books before it), as a count, the latest time one changed,
 * and how many are deleted; and every entry's kind and whether it is deleted (a character made an item, or deleted,
 * changes who is in a snapshot; a rename changes nothing, as names are read when a snapshot is said). Two queries.
 */
export function outsideStamp(db: DB, sceneIds: ID[]): string {
  const r = db
    .prepare(
      `SELECT COUNT(*) AS n, MAX(updated_at) AS u, COUNT(deleted_at) AS d FROM changes
       WHERE scene_id IS NULL OR scene_id NOT IN (SELECT value FROM json_each(?))`
    )
    .get(JSON.stringify(sceneIds)) as Row
  const e = db
    .prepare(
      `SELECT group_concat(id || ':' || kind || ':' || (deleted_at IS NOT NULL), ',') AS k FROM (SELECT id, kind, deleted_at FROM entries ORDER BY id)`
    )
    .get() as Row
  return `${r.n as number}:${(r.u as string) ?? ''}:${r.d as number}|${(e.k as string) ?? ''}`
}
