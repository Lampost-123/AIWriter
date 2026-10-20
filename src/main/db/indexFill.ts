// The SQL for keeping the story index current and filling in its physical details (storyIndex/upkeep.ts and fill.ts):
// which stories the index holds, which stories are being written, and a story's scenes with their words, in reading
// order. Pure functions over a better-sqlite3 handle, no Electron imports.

import type Database from 'better-sqlite3'
import type { ID } from '@shared/types'

type DB = Database.Database
type Row = Record<string, unknown>

const LIVE = `FROM scenes s JOIN chapters c ON c.id = s.chapter_id JOIN stories st ON st.id = c.story_id
  WHERE s.deleted_at IS NULL AND c.deleted_at IS NULL AND st.deleted_at IS NULL`

/** The stories the index holds rows for (live or not). */
export function indexedStoryIds(db: DB): ID[] {
  return (db.prepare('SELECT DISTINCT story_id FROM index_scenes').all() as Row[]).map((r) => r.story_id as string)
}

/** The live stories, in shelf order. */
export function liveStoryIds(db: DB): ID[] {
  return (db.prepare('SELECT id FROM stories WHERE deleted_at IS NULL ORDER BY position, created_order').all() as Row[]).map(
    (r) => r.id as string
  )
}

export interface FillScene {
  id: ID
  chapterId: ID
  words: number
  chars: number
  /** When the scene last changed (its words, card or anything else), as stored. */
  updatedAt: string
}

/** A live story's live scenes, in reading order, with their words (no text is read). */
export function storyFillScenes(db: DB, storyId: ID): FillScene[] {
  const rows = db
    .prepare(
      `SELECT s.id, s.chapter_id, s.word_count, length(s.text) AS chars, s.updated_at ${LIVE} AND c.story_id = ?
       ORDER BY c.position, c.created_at, s.position, s.created_at`
    )
    .all(storyId) as Row[]
  return rows.map((r) => ({
    id: r.id as string,
    chapterId: r.chapter_id as string,
    words: (r.word_count as number) ?? 0,
    chars: (r.chars as number) ?? 0,
    updatedAt: (r.updated_at as string) ?? ''
  }))
}

/** Each live story with words in it, and when one of its scenes with words last changed. */
export function storiesWithWords(db: DB): { storyId: ID; lastChanged: string }[] {
  const rows = db.prepare(`SELECT c.story_id, MAX(s.updated_at) AS last ${LIVE} AND s.word_count > 0 GROUP BY c.story_id`).all() as Row[]
  return rows.map((r) => ({ storyId: r.story_id as string, lastChanged: (r.last as string) ?? '' }))
}
