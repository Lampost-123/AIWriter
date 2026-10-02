import type Database from 'better-sqlite3'

// The Trash: deleting a story, chapter, scene or entry only sets deleted_at, so it can be
// restored for 30 days. After that, purgeTrash() removes it for good (run when a world opens).

type DB = Database.Database

export interface PurgeResult {
  stories: number
  chapters: number
  scenes: number
  entries: number
  generations: number
}

const ids = (db: DB, sql: string, ...params: unknown[]): string[] =>
  (db.prepare(sql).all(...params) as { id: string }[]).map((r) => r.id)

/**
 * Permanently removes everything that has been in the trash for longer than `olderThanDays`.
 * A purged story takes its chapters and scenes with it, a purged chapter its scenes, and a
 * purged scene its draft records (generations and the entry versions they used).
 */
export function purgeTrash(db: DB, olderThanDays: number, nowMs: number = Date.now()): PurgeResult {
  const cutoff = new Date(nowMs - olderThanDays * 24 * 60 * 60 * 1000).toISOString()
  const expired = 'deleted_at IS NOT NULL AND deleted_at < ?'

  return db.transaction((): PurgeResult => {
    const storyIds = ids(db, `SELECT id FROM stories WHERE ${expired}`, cutoff)
    const storySet = new Set(storyIds)
    const chapterIds = ids(db, `SELECT id FROM chapters WHERE ${expired}`, cutoff)
    for (const id of storyIds) chapterIds.push(...ids(db, 'SELECT id FROM chapters WHERE story_id = ?', id))
    const chapterSet = new Set(chapterIds)
    const sceneIds = ids(db, `SELECT id FROM scenes WHERE ${expired}`, cutoff)
    for (const id of chapterSet) sceneIds.push(...ids(db, 'SELECT id FROM scenes WHERE chapter_id = ?', id))
    const sceneSet = new Set(sceneIds)
    const entryIds = ids(db, `SELECT id FROM entries WHERE ${expired}`, cutoff)

    let generations = 0
    const delGenEntries = db.prepare('DELETE FROM generation_entries WHERE generation_id IN (SELECT id FROM generations WHERE scene_id = ?)')
    const delGens = db.prepare('DELETE FROM generations WHERE scene_id = ?')
    const delScene = db.prepare('DELETE FROM scenes WHERE id = ?')
    for (const id of sceneSet) {
      delGenEntries.run(id)
      generations += delGens.run(id).changes
      delScene.run(id)
    }
    const delChapter = db.prepare('DELETE FROM chapters WHERE id = ?')
    for (const id of chapterSet) delChapter.run(id)
    const delStory = db.prepare('DELETE FROM stories WHERE id = ?')
    const unlinkStory = db.prepare('UPDATE stories SET start_story_id = NULL WHERE start_story_id = ?')
    for (const id of storySet) {
      delStory.run(id)
      unlinkStory.run(id)
    }
    const delEntry = db.prepare('DELETE FROM entries WHERE id = ?')
    const unlinkParent = db.prepare('UPDATE entries SET parent_id = NULL WHERE parent_id = ?')
    for (const id of entryIds) {
      delEntry.run(id)
      unlinkParent.run(id)
    }

    return { stories: storySet.size, chapters: chapterSet.size, scenes: sceneSet.size, entries: entryIds.length, generations }
  })()
}
