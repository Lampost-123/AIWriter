// SQL for the consistency reports (milestone 5, Reports part): a story's live chapters and scenes with
// their text, in story order, and the names the repetition report leaves alone.
import type Database from 'better-sqlite3'
import type { ID } from '@shared/types'

type DB = Database.Database
type Row = Record<string, unknown>

export interface ChapterText {
  chapterId: ID
  title: string
  /** Live scenes, in order, with their text. */
  scenes: { sceneId: ID; text: string }[]
}

/** Every live chapter of a story, in order, with its live scenes' text: one query however many scenes. */
export function storyTexts(db: DB, storyId: ID): ChapterText[] {
  const rows = db
    .prepare(
      `SELECT c.id AS chapter_id, c.title AS chapter_title, s.id AS scene_id, s.text
       FROM chapters c LEFT JOIN scenes s ON s.chapter_id = c.id AND s.deleted_at IS NULL
       WHERE c.story_id = ? AND c.deleted_at IS NULL
       ORDER BY c.position, s.position`
    )
    .all(storyId) as Row[]
  const out: ChapterText[] = []
  for (const r of rows) {
    let ch = out[out.length - 1]
    if (!ch || ch.chapterId !== r.chapter_id) out.push((ch = { chapterId: r.chapter_id as ID, title: (r.chapter_title as string) ?? '', scenes: [] }))
    if (typeof r.scene_id === 'string') ch.scenes.push({ sceneId: r.scene_id, text: typeof r.text === 'string' ? r.text : '' })
  }
  return out
}

/** Kinds whose names are names (people, places, groups, things, the glossary's terms), meant to repeat. */
const NAMED_KINDS = ['character', 'place', 'group', 'item', 'glossary']

/** Every live name and alias of the world's characters, places, groups, items and glossary terms. */
export function worldNames(db: DB): string[] {
  const rows = db
    .prepare(`SELECT name, aliases_json FROM entries WHERE deleted_at IS NULL AND kind IN (${NAMED_KINDS.map(() => '?').join(', ')})`)
    .all(...NAMED_KINDS) as Row[]
  const names: string[] = []
  for (const r of rows) {
    if (typeof r.name === 'string' && r.name.trim()) names.push(r.name)
    try {
      const aliases: unknown = JSON.parse((r.aliases_json as string) || '[]')
      if (Array.isArray(aliases)) for (const a of aliases) if (typeof a === 'string' && a.trim()) names.push(a)
    } catch {
      // A damaged alias list leaves just the name.
    }
  }
  return names
}
