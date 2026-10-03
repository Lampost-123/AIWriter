// All SQL for importing a manuscript (milestone 6): leaving imported scenes unread by the memory, finding the
// scenes the memory hasn't read since they were imported, putting chapters into their acts, clearing a new
// world's empty first story, and the import catch-up's state (the meta key 'import_catchup'). Built on the
// tables of migrations 1 and 2 (no migration); no Electron imports.
//
// An imported scene is "unread": it has words, its memory state is 'current' and the keeper has read no
// paragraphs of it (memory_paragraphs_json '[]'). A scene the keeper has read always has paragraphs, and one
// saved since is 'pending', so this state means exactly "imported and not read yet". The keeper leaves such a
// scene alone (nothing is waiting), and an edit makes it 'pending' as usual, when the keeper reads it whole.

import type Database from 'better-sqlite3'
import type { ID } from '@shared/types'
import { getMeta, setMeta } from './repo'

type DB = Database.Database
type Row = Record<string, unknown>

const LIVE = `FROM scenes s JOIN chapters c ON c.id = s.chapter_id JOIN stories st ON st.id = c.story_id
  WHERE s.deleted_at IS NULL AND c.deleted_at IS NULL AND st.deleted_at IS NULL`
const UNREAD = "s.word_count > 0 AND s.memory_paragraphs_json = '[]' AND s.memory_status = 'current'"
const ORDER = 'ORDER BY c.position, s.position'

/** An imported scene's text has been saved: it is left unread by the memory (version 1, nothing read). */
export function markImported(db: DB, sceneId: ID): void {
  db.prepare(
    "UPDATE scenes SET text_version = 1, memory_version = 1, memory_status = 'current', memory_paragraphs_json = '[]', memory_error = NULL WHERE id = ?"
  ).run(sceneId)
}

/** Stories with unread scenes, and how many each has. */
export function unreadCounts(db: DB): Record<ID, number> {
  const rows = db.prepare(`SELECT c.story_id AS id, COUNT(*) AS n ${LIVE} AND ${UNREAD} GROUP BY c.story_id`).all() as Row[]
  return Object.fromEntries(rows.map((r) => [r.id as string, r.n as number]))
}

export interface CatchUpScene {
  sceneId: ID
  chapterId: ID
  words: number
  /** Not read yet: never read since it was imported (or the catch-up made it wait, or it failed). */
  unread: boolean
  memoryState: string
  /** Characters of text, for working out the cost. */
  chars: number
}

/** A story's live scenes with words, in reading order, and whether the memory has read each. */
export function storyScenes(db: DB, storyId: ID): CatchUpScene[] {
  return (
    db
      .prepare(
        `SELECT s.id, s.chapter_id, s.word_count, s.memory_status, s.memory_paragraphs_json = '[]' AS unread, length(s.text) AS chars
         ${LIVE} AND c.story_id = ? AND s.word_count > 0 ${ORDER}`
      )
      .all(storyId) as Row[]
  ).map((r) => ({
    sceneId: r.id as string,
    chapterId: r.chapter_id as string,
    words: r.word_count as number,
    unread: !!r.unread,
    memoryState: r.memory_status as string,
    chars: (r.chars as number) ?? 0
  }))
}

/** A story's scenes the memory hasn't read, with their sizes, for working out what reading them costs. */
export function unreadSizes(db: DB, storyId: ID): { chapterId: ID; words: number; chars: number }[] {
  return (
    db
      .prepare(
        `SELECT s.chapter_id, s.word_count, length(s.text) AS chars ${LIVE} AND c.story_id = ? AND s.word_count > 0
           AND s.memory_paragraphs_json = '[]' ${ORDER}`
      )
      .all(storyId) as Row[]
  ).map((r) => ({ chapterId: r.chapter_id as string, words: r.word_count as number, chars: (r.chars as number) ?? 0 }))
}

/** A story's live chapters, in order. */
export function storyChapters(db: DB, storyId: ID): ID[] {
  return (
    db.prepare('SELECT id FROM chapters WHERE story_id = ? AND deleted_at IS NULL ORDER BY position').all(storyId) as Row[]
  ).map((r) => r.id as string)
}

/** The catch-up asks for these unread scenes to be read: they wait for the keeper ('pending'), with their text as it is. */
export function markWaiting(db: DB, sceneIds: ID[]): void {
  const stmt = db.prepare(`UPDATE scenes SET memory_status = 'pending' WHERE id = ? AND memory_status = 'current' AND memory_paragraphs_json = '[]'`)
  db.transaction(() => {
    for (const id of sceneIds) stmt.run(id)
  })()
}

/**
 * Stop: these scenes, still waiting and never read, go back to unread, so the keeper passes them over. A scene
 * saved since it was asked for (its text moved on) keeps waiting, as any edited scene does.
 */
export function backToUnread(db: DB, sceneIds: ID[]): void {
  const stmt = db.prepare(
    `UPDATE scenes SET memory_status = 'current' WHERE id = ? AND memory_status = 'pending' AND memory_paragraphs_json = '[]'
       AND text_version = memory_version`
  )
  db.transaction(() => {
    for (const id of sceneIds) stmt.run(id)
  })()
}

/** The latest reason one of these scenes couldn't be read ("Memory not updated"), if any. */
export function failureOf(db: DB, sceneIds: ID[]): string | null {
  if (!sceneIds.length) return null
  const r = db
    .prepare(`SELECT memory_error FROM scenes WHERE memory_status = 'failed' AND memory_error IS NOT NULL AND id IN (${sceneIds.map(() => '?').join(', ')}) LIMIT 1`)
    .get(...sceneIds) as Row | undefined
  return (r?.memory_error as string | undefined) ?? null
}

/** Puts imported chapters into an act. */
export function setChapterAct(db: DB, chapterIds: ID[], actId: ID): void {
  const stmt = db.prepare('UPDATE chapters SET act_id = ? WHERE id = ?')
  for (const id of chapterIds) stmt.run(actId, id)
}

/**
 * A world made for the book: its only story, if it has no words in it at all (the "Book 1" every new world
 * starts with), is taken out for good so the imported story takes its place. Returns whether it was.
 */
export function clearEmptyFirstStory(db: DB): boolean {
  const stories = db.prepare('SELECT id FROM stories').all() as Row[]
  if (stories.length !== 1) return false
  const id = stories[0].id as string
  const words = db
    .prepare('SELECT COALESCE(SUM(s.word_count), 0) AS n FROM scenes s JOIN chapters c ON c.id = s.chapter_id WHERE c.story_id = ?')
    .get(id) as Row
  if ((words.n as number) > 0) return false
  // Anything that points at it (its summary, its acts) goes with it; entries and changes never do in a new world.
  const pointers = db.prepare('SELECT COUNT(*) AS n FROM changes WHERE story_id = ?').get(id) as Row
  if ((pointers.n as number) > 0) return false
  db.prepare('DELETE FROM scenes WHERE chapter_id IN (SELECT id FROM chapters WHERE story_id = ?)').run(id)
  db.prepare('DELETE FROM chapters WHERE story_id = ?').run(id)
  db.prepare('DELETE FROM acts WHERE story_id = ?').run(id)
  db.prepare('DELETE FROM stories WHERE id = ?').run(id)
  return true
}

// ---------- The catch-up's state ----------

const KEY = 'import_catchup'

export interface CatchUpRecord {
  /** Stories to build the memory from, first one now; the rest wait their turn. */
  storyIds: ID[]
}

export function getCatchUpRecord(db: DB): CatchUpRecord | null {
  try {
    const v = JSON.parse(getMeta(db, KEY) ?? 'null') as CatchUpRecord | null
    return v && Array.isArray(v.storyIds) && v.storyIds.length ? { storyIds: v.storyIds.filter((x) => typeof x === 'string') } : null
  } catch {
    return null
  }
}

export function setCatchUpRecord(db: DB, record: CatchUpRecord | null): void {
  if (!record || !record.storyIds.length) db.prepare('DELETE FROM meta WHERE key = ?').run(KEY)
  else setMeta(db, KEY, JSON.stringify(record))
}
