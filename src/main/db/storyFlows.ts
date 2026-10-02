// All SQL for the automatic story flows (milestone 3): the changes at a story's start they read and
// write, and their runs and lines in What changed. A flow run uses the memory keeper's tables
// (migration 2): a memory run whose scene is '' (it belongs to no scene, so nothing that reads runs
// by scene ever sees it) and lines with no scene, whose undo data starts { op: 'story-flow' }.
// Pure functions over a better-sqlite3 handle, no Electron imports.

import type Database from 'better-sqlite3'
import type { Change, ID, Origin } from '@shared/types'
import { getChange } from './memory'
import { logForRun, type LogRow } from './keeper'

type DB = Database.Database
type Row = Record<string, unknown>

/** The scene a flow's memory run is recorded against: none. */
export const FLOW_RUN_SCENE = ''

/** Every live change at a story's start, in order. */
export function startChanges(db: DB, storyId: ID): Change[] {
  const ids = db
    .prepare(
      "SELECT id FROM changes WHERE story_id = ? AND anchor = 'story-start' AND deleted_at IS NULL ORDER BY position, created_at, rowid"
    )
    .all(storyId) as Row[]
  return ids.map((r) => getChange(db, r.id as string))
}

/** Where a change is, whether or not it is deleted. */
export interface ChangeAt {
  deleted: boolean
  storyId: ID | null
  position: number
  origin: Origin
}

const toAt = (r: Row): ChangeAt => ({
  deleted: r.deleted_at != null,
  storyId: (r.story_id as string) ?? null,
  position: r.position as number,
  origin: r.origin as Origin
})

/** A change whether or not it is deleted (null once it is gone for good), with when it was deleted. */
export function anyChange(db: DB, id: ID): ChangeAt | null {
  const r = db.prepare('SELECT deleted_at, story_id, position, origin FROM changes WHERE id = ?').get(id) as Row | undefined
  return r ? toAt(r) : null
}

/** Where the change of every flow line is now, by change id, in one query (a change gone for good is left out). */
export function flowLineChanges(db: DB): Map<ID, ChangeAt> {
  const rows = db
    .prepare(
      `SELECT c.id, c.deleted_at, c.story_id, c.position, c.origin FROM changes c WHERE c.id IN (
         SELECT l.fact_id FROM memory_log l JOIN memory_runs r ON r.id = l.run_id
         WHERE r.scene_id = ? AND l.undo_json LIKE '{"op":"story-flow"%')`
    )
    .all(FLOW_RUN_SCENE) as Row[]
  return new Map(rows.map((r) => [r.id as string, toAt(r)]))
}

/** A story's title, live or deleted (null when there is no such story). */
export function storyTitle(db: DB, id: ID): string | null {
  const r = db.prepare('SELECT title FROM stories WHERE id = ?').get(id) as Row | undefined
  return r ? ((r.title as string) ?? '') : null
}

/** Puts a change back at its old place among the changes beside it (an undo moves it back exactly). */
export function setChangePosition(db: DB, id: ID, position: number): void {
  db.prepare('UPDATE changes SET position = ? WHERE id = ?').run(position, id)
}

/** Takes away a first-exists point a flow added (set on purpose or not). */
export function deletePoint(db: DB, id: ID): void {
  db.prepare('DELETE FROM exists_points WHERE id = ?').run(id)
}

/** The flow runs listed in What changed, oldest first. */
export function flowRunIds(db: DB): ID[] {
  return (
    db
      .prepare(
        `SELECT l.run_id AS id, MIN(l.rowid) AS first FROM memory_log l JOIN memory_runs r ON r.id = l.run_id
         WHERE r.scene_id = ? AND l.undo_json LIKE '{"op":"story-flow"%' GROUP BY l.run_id ORDER BY first`
      )
      .all(FLOW_RUN_SCENE) as Row[]
  ).map((r) => r.id as string)
}

/** Every line the flows wrote, oldest first (undone ones too). */
export function flowLines(db: DB): LogRow[] {
  return flowRunIds(db).flatMap((runId) => logForRun(db, runId))
}

/** Every flow line about one change (a flow's lines are found by the change they are about). */
export function linesAboutChange(db: DB, changeId: ID): LogRow[] {
  const runs = (
    db
      .prepare(
        `SELECT DISTINCT l.run_id AS id FROM memory_log l JOIN memory_runs r ON r.id = l.run_id
         WHERE r.scene_id = ? AND l.fact_id = ? AND l.undo_json LIKE '{"op":"story-flow"%'`
      )
      .all(FLOW_RUN_SCENE, changeId) as Row[]
  ).map((r) => r.id as string)
  return runs.flatMap((runId) => logForRun(db, runId)).filter((l) => l.factId === changeId)
}
