import type Database from 'better-sqlite3'
import { settlePlacements } from './memory'
import { purgeActs } from './acts'
import { CHAPTER_CARD_PREFIX } from '@shared/chapterCard'

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
    // Stories that start or end in what goes, and entries first seen there, keep their place: the
    // safe points worked out while it was only deleted are written down before it goes for good.
    settlePlacements(db, { stories: storySet, chapters: chapterSet, scenes: sceneSet })

    let generations = 0
    const delGenEntries = db.prepare('DELETE FROM generation_entries WHERE generation_id IN (SELECT id FROM generations WHERE scene_id = ?)')
    const delGens = db.prepare('DELETE FROM generations WHERE scene_id = ?')
    const delScene = db.prepare('DELETE FROM scenes WHERE id = ?')
    for (const id of sceneSet) {
      delGenEntries.run(id)
      generations += delGens.run(id).changes
      delScene.run(id)
    }
    // Beat markers (beats/marks.ts, `beat_marks:<scene id>` in meta) go with their scene. While it is only in
    // Recently deleted they stay, so a restored scene has its beats; this also clears any left by a scene that
    // went for good another way (the outline helper's Undo, an imported story taking the empty first one's place).
    db.prepare("DELETE FROM meta WHERE substr(key, 1, 11) = 'beat_marks:' AND substr(key, 12) NOT IN (SELECT id FROM scenes)").run()
    const delChapter = db.prepare('DELETE FROM chapters WHERE id = ?')
    for (const id of chapterSet) delChapter.run(id)
    // Chapter cards (`chapter_card:<chapter id>` in meta, repo.ts) go with their chapter. While it is only in Recently
    // deleted they stay, so a restored chapter has its card; this also clears any left by a chapter that went for
    // good another way (the outline helper's Undo).
    db.prepare(`DELETE FROM meta WHERE substr(key, 1, ${CHAPTER_CARD_PREFIX.length}) = ? AND substr(key, ${CHAPTER_CARD_PREFIX.length + 1}) NOT IN (SELECT id FROM chapters)`).run(
      CHAPTER_CARD_PREFIX
    )
    // The chapter writer's report and the words before its run (chapterWriter/store.ts) go with their chapter too.
    for (const prefix of ['chapter_writer:', 'chapter_writer_before:']) {
      db.prepare(`DELETE FROM meta WHERE substr(key, 1, ${prefix.length}) = ? AND substr(key, ${prefix.length + 1}) NOT IN (SELECT id FROM chapters)`).run(prefix)
    }
    // Milestone 4: deleted acts too (a purged story's acts go with it).
    purgeActs(db, cutoff)
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
