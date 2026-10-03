// SQL for the start screen (src/main/library/): what a world holds, read from any world's database (the open
// world's own connection, or another world's opened read-only), and renaming a world or a story in a world
// that isn't open. Never reads a scene's text: words come from scenes.word_count. No Electron imports, so it
// is tested against made-up worlds.
import type Database from 'better-sqlite3'
import type { ID } from '@shared/types'
import type { LibraryStory } from '@shared/contracts/library'
import { loadShape } from './memory'
import { MIGRATIONS } from './migrations'
import { describe, readingOrder } from '../stories/rules'
import { now, UserError } from '../util'
import { SAMPLE_META_KEY } from '../setup/sampleWorld'

type Row = Record<string, unknown>
type DB = Database.Database

const metaOf = (db: DB, key: string): string | null =>
  (db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? null

/** The later of two ISO times ('' when neither is known). */
const later = (a: string, b: string): string => (a > b ? a : b)

/** Each live story's words and when one of its live scenes last changed. */
function sceneTotals(db: DB): Map<ID, { words: number; editedAt: string }> {
  const rows = db
    .prepare(
      `SELECT c.story_id AS id, COALESCE(SUM(s.word_count), 0) AS words, MAX(s.updated_at) AS edited
       FROM chapters c JOIN scenes s ON s.chapter_id = c.id
       WHERE c.deleted_at IS NULL AND s.deleted_at IS NULL
       GROUP BY c.story_id`
    )
    .all() as Row[]
  return new Map(rows.map((r) => [r.id as string, { words: Number(r.words) || 0, editedAt: (r.edited as string) ?? '' }]))
}

/**
 * A world's live stories in reading order, each with what it is in a few words (the story menu's grey line),
 * its words and when it last changed. A world from an older AI Write (not brought up to date until it opens)
 * may not have the columns the story menu reads: its stories are then listed in shelf order with no label.
 */
export function libraryStories(db: DB): LibraryStory[] {
  const rows = db.prepare('SELECT id, title, updated_at FROM stories WHERE deleted_at IS NULL ORDER BY position, created_order').all() as Row[]
  const totals = sceneTotals(db)
  let order: ID[] = rows.map((r) => r.id as string)
  const labels = new Map<ID, string>()
  try {
    const shape = loadShape(db)
    for (const node of shape.stories) {
      const { label } = describe(shape, node)
      if (label) labels.set(node.id, label)
    }
    const read = readingOrder(shape)
    const known = new Set(read)
    order = [...read, ...order.filter((id) => !known.has(id))]
  } catch (e) {
    console.warn('Could not read how the stories fit together', e instanceof Error ? e.message : e)
  }
  const byId = new Map(rows.map((r) => [r.id as string, r]))
  return order
    .filter((id) => byId.has(id))
    .map((id) => {
      const r = byId.get(id)!
      const t = totals.get(id)
      return {
        id,
        title: r.title as string,
        kind: labels.get(id) ?? '',
        words: t?.words ?? 0,
        editedAt: later((r.updated_at as string) ?? '', t?.editedAt ?? '')
      }
    })
}

/** The world's name, "last changed" time and whether it is the sample world. */
export function worldMeta(db: DB): { id: ID | null; name: string; updatedAt: string; sample: boolean } {
  return {
    id: metaOf(db, 'id'),
    name: metaOf(db, 'name') ?? 'Untitled world',
    updatedAt: metaOf(db, 'updated_at') ?? '',
    sample: !!metaOf(db, SAMPLE_META_KEY)
  }
}

/** Where Adam left off in a world: a live story and a live scene in it, by the same rules as reopening the world. */
export function placeIn(
  db: DB,
  wanted: { storyIds: (ID | null | undefined)[]; sceneIds: (ID | null | undefined)[] }
): { storyId: ID | null; storyTitle: string; sceneId: ID | null; sceneTitle: string } {
  const stories = db.prepare('SELECT id, title FROM stories WHERE deleted_at IS NULL ORDER BY position, created_order').all() as Row[]
  const story = wanted.storyIds.map((id) => stories.find((s) => id && s.id === id)).find(Boolean) ?? stories[0]
  if (!story) return { storyId: null, storyTitle: '', sceneId: null, sceneTitle: '' }
  const scenes = db
    .prepare(
      `SELECT s.id, s.title FROM scenes s JOIN chapters c ON c.id = s.chapter_id
       WHERE c.story_id = ? AND s.deleted_at IS NULL AND c.deleted_at IS NULL
       ORDER BY c.position, s.position`
    )
    .all(story.id) as Row[]
  const scene = wanted.sceneIds.map((id) => scenes.find((s) => id && s.id === id)).find(Boolean) ?? scenes[0]
  return {
    storyId: story.id as string,
    storyTitle: story.title as string,
    sceneId: (scene?.id as string) ?? null,
    sceneTitle: ((scene?.title as string) ?? '').trim()
  }
}

/** A world's live stories and their words, for Recently deleted. */
export function worldCounts(db: DB): { stories: number; words: number } {
  const r = db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM stories WHERE deleted_at IS NULL) AS stories,
         (SELECT COALESCE(SUM(s.word_count), 0) FROM scenes s
            JOIN chapters c ON c.id = s.chapter_id JOIN stories t ON t.id = c.story_id
          WHERE s.deleted_at IS NULL AND c.deleted_at IS NULL AND t.deleted_at IS NULL) AS words`
    )
    .get() as Row
  return { stories: Number(r.stories) || 0, words: Number(r.words) || 0 }
}

/**
 * A world that isn't open is only changed when its database is exactly this AI Write's layout: one from an
 * older AI Write is brought up to date when it opens (with a backup first), never from the start screen.
 */
export function checkWritable(db: DB): void {
  const version = db.pragma('user_version', { simple: true }) as number
  if (version > MIGRATIONS.length) {
    throw new UserError('This world was saved by a newer version of AI Write. Update AI Write, then try again.', 'newer-world')
  }
  if (version < MIGRATIONS.length) {
    throw new UserError('This world needs to be opened once before it can be renamed here. Open it, then try again.', 'open-world-first')
  }
}

/** Renames a world in its own database (not its folder). */
export function renameWorldMeta(db: DB, name: string): void {
  const set = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
  db.transaction(() => {
    set.run('name', name)
    set.run('updated_at', now())
  })()
}

/** Renames a live story and moves the world's "last changed" time. */
export function renameStoryRow(db: DB, storyId: ID, title: string): void {
  db.transaction(() => {
    const t = now()
    const done = db.prepare('UPDATE stories SET title = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL').run(title, t, storyId)
    if (done.changes === 0) throw new UserError('That story no longer exists.')
    db.prepare("INSERT INTO meta (key, value) VALUES ('updated_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(t)
  })()
}
