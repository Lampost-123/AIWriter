// All SQL for the World builder (milestone 4) that the memory keeper's (db/keeper.ts) doesn't cover. A
// build uses the memory keeper's tables, as the story flows do: a memory run whose scene is '' (it
// belongs to no scene, so nothing that reads runs by scene ever sees it) and lines with no scene, whose
// undo data starts { op: 'world-build' }. Pure functions over a better-sqlite3 handle, no Electron imports.

import type Database from 'better-sqlite3'
import type { EntryKind, ID } from '@shared/types'
import { logForRun, type LogRow } from './keeper'

type DB = Database.Database
type Row = Record<string, unknown>

/** The scene a build's memory run (and the suppressions its undone lines leave) is recorded against: none. */
export const BUILD_RUN_SCENE = ''

/** Brings back a line undone with the rest of its build (the Undo on "Build undone"). */
export function markNotUndone(db: DB, id: ID): void {
  db.prepare('UPDATE memory_log SET undone_at = NULL WHERE id = ?').run(id)
}

/** Every build's run, oldest first. */
export function buildRunIds(db: DB): ID[] {
  return (
    db
      .prepare(
        `SELECT run_id AS id, MIN(rowid) AS first FROM memory_log
         WHERE scene_id IS NULL AND undo_json LIKE '{"op":"world-build"%' GROUP BY run_id ORDER BY first`
      )
      .all() as Row[]
  ).map((r) => r.id as string)
}

/** The newest build's run: how it ended, what it cost and when. Null when no build has saved anything. */
export function lastBuildRun(db: DB): { id: ID; status: string; cost: number | null; finishedAt: string } | null {
  const id = buildRunIds(db).at(-1)
  if (!id) return null
  const r = db.prepare('SELECT status, cost, finished_at, created_at FROM memory_runs WHERE id = ?').get(id) as Row | undefined
  if (!r) return null
  return { id, status: r.status as string, cost: (r.cost as number | null) ?? null, finishedAt: (r.finished_at ?? r.created_at) as string }
}

/** Every line the builds wrote, oldest first (undone ones too). */
export function buildLines(db: DB): LogRow[] {
  return buildRunIds(db).flatMap((runId) => logForRun(db, runId))
}

/** Whether an entry is live or in Recently deleted; null once it is gone for good. */
export function entryState(db: DB, id: ID): 'live' | 'deleted' | null {
  const r = db.prepare('SELECT deleted_at FROM entries WHERE id = ?').get(id) as Row | undefined
  return r ? (r.deleted_at == null ? 'live' : 'deleted') : null
}

type Named = { id: ID; kind: EntryKind; name: string; aliases: string[] }

function namedRow(r: Row): Named {
  let aliases: string[] = []
  try {
    const v = JSON.parse((r.aliases_json as string) || '[]') as unknown
    if (Array.isArray(v)) aliases = v.filter((a): a is string => typeof a === 'string')
  } catch {
    // Other names that can't be read count as none.
  }
  return { id: r.id as string, kind: r.kind as EntryKind, name: (r.name as string) ?? '', aliases }
}

/** Every live entry's kind, name and other names, oldest first: what a build matches the summary's names against. */
export function entryNames(db: DB): Named[] {
  const rows = db
    .prepare('SELECT id, kind, name, aliases_json FROM entries WHERE deleted_at IS NULL ORDER BY created_at, rowid')
    .all() as Row[]
  return rows.map(namedRow)
}

/** One entry's kind, name and other names, live or in Recently deleted; null once it is gone for good. */
export function entryNamed(db: DB, id: ID): Named | null {
  const r = db.prepare('SELECT id, kind, name, aliases_json FROM entries WHERE id = ?').get(id) as Row | undefined
  return r ? namedRow(r) : null
}
