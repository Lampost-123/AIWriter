import { describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import * as repo from '../../src/main/db/repo'
import { purgeTrash } from '../../src/main/db/trash'
import { memoryWorld } from './helpers'

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-10-01T12:00:00.000Z')
const daysAgo = (n: number): string => new Date(NOW - n * DAY).toISOString()

const setDeleted = (db: Database.Database, table: string, id: string, at: string | null): void =>
  void db.prepare(`UPDATE ${table} SET deleted_at = ? WHERE id = ?`).run(at, id)

const count = (db: Database.Database, table: string): number => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n

function addGeneration(db: Database.Database, id: string, sceneId: string, entryId: string): void {
  db.prepare(
    `INSERT INTO generations (id, scene_id, job, status, provider_id, provider_name, model_id, params_json, blocks_json, messages_json, budget_json, created_at)
     VALUES (?, ?, 'draft', 'complete', 'p', 'OpenRouter', 'm', '{}', '[]', '[]', '{}', ?)`
  ).run(id, sceneId, daysAgo(40))
  db.prepare('INSERT INTO generation_entries (generation_id, entry_id, entry_version) VALUES (?, ?, ?)').run(id, entryId, daysAgo(40))
}

describe('purgeTrash', () => {
  it('removes only what has been in the trash longer than the limit', () => {
    const db = memoryWorld()
    const story = repo.listStories(db)[0]
    const [ch] = repo.getOutline(db, story.id).chapters
    const [kept] = repo.getOutline(db, story.id).scenes
    const old = repo.createScene(db, ch.id)
    const recent = repo.createScene(db, ch.id)
    const oldEntry = repo.createEntry(db, 'character', { name: 'Gone' })
    const recentEntry = repo.createEntry(db, 'character', { name: 'Still in trash' })
    setDeleted(db, 'scenes', old.id, daysAgo(31))
    setDeleted(db, 'scenes', recent.id, daysAgo(29))
    setDeleted(db, 'entries', oldEntry.id, daysAgo(45))
    setDeleted(db, 'entries', recentEntry.id, daysAgo(1))

    const res = purgeTrash(db, 30, NOW)
    expect(res).toEqual({ stories: 0, chapters: 0, scenes: 1, entries: 1, generations: 0 })
    const sceneIds = (db.prepare('SELECT id FROM scenes').all() as { id: string }[]).map((r) => r.id).sort()
    expect(sceneIds).toEqual([kept.id, recent.id].sort())
    // Still restorable: only purged rows are gone.
    repo.restoreDeleted(db, 'scene', recent.id)
    repo.restoreDeleted(db, 'entry', recentEntry.id)
    expect(() => repo.restoreDeleted(db, 'entry', oldEntry.id)).toThrow()
  })

  it("removes a purged scene's draft records but keeps other scenes' records", () => {
    const db = memoryWorld()
    const story = repo.listStories(db)[0]
    const [ch] = repo.getOutline(db, story.id).chapters
    const [live] = repo.getOutline(db, story.id).scenes
    const dead = repo.createScene(db, ch.id)
    const mara = repo.createEntry(db, 'character', { name: 'Mara' })
    addGeneration(db, 'g-live', live.id, mara.id)
    addGeneration(db, 'g-dead-1', dead.id, mara.id)
    addGeneration(db, 'g-dead-2', dead.id, mara.id)
    setDeleted(db, 'scenes', dead.id, daysAgo(60))

    const res = purgeTrash(db, 30, NOW)
    expect(res.scenes).toBe(1)
    expect(res.generations).toBe(2)
    expect((db.prepare('SELECT id FROM generations').all() as { id: string }[]).map((r) => r.id)).toEqual(['g-live'])
    expect(count(db, 'generation_entries')).toBe(1)
  })

  it('a purged chapter takes all its scenes, even one restored on its own', () => {
    const db = memoryWorld()
    const story = repo.listStories(db)[0]
    const [ch] = repo.getOutline(db, story.id).chapters
    const [s1] = repo.getOutline(db, story.id).scenes
    const s2 = repo.createScene(db, ch.id)
    addGeneration(db, 'g1', s1.id, 'x')
    repo.deleteChapter(db, ch.id)
    setDeleted(db, 'chapters', ch.id, daysAgo(31))
    setDeleted(db, 'scenes', s1.id, daysAgo(31))
    setDeleted(db, 'scenes', s2.id, null) // restored by itself, chapter still in the trash

    const res = purgeTrash(db, 30, NOW)
    expect(res).toMatchObject({ chapters: 1, scenes: 2, generations: 1 })
    expect(count(db, 'chapters')).toBe(0)
    expect(count(db, 'scenes')).toBe(0)
  })

  it('a purged story takes its chapters and scenes, and stories that continued it start fresh', () => {
    const db = memoryWorld()
    const book1 = repo.listStories(db)[0]
    const book2 = repo.createStory(db, { title: 'Book 2' })
    expect(book2.startStoryId).toBe(book1.id)
    repo.createChapter(db, book1.id)
    repo.deleteStory(db, book1.id)
    setDeleted(db, 'stories', book1.id, daysAgo(90))

    const res = purgeTrash(db, 30, NOW)
    expect(res).toMatchObject({ stories: 1, chapters: 2, scenes: 1 })
    expect(repo.listStories(db).map((s) => s.title)).toEqual(['Book 2'])
    expect(repo.getStory(db, book2.id).startStoryId).toBeNull()
    expect(count(db, 'chapters')).toBe(0)
  })

  it('places inside a purged place lose the link, not their data', () => {
    const db = memoryWorld()
    const keep = repo.createEntry(db, 'place', { name: 'Keep' })
    const hall = repo.createEntry(db, 'place', { name: 'Hall', parentId: keep.id })
    repo.deleteEntry(db, keep.id)
    setDeleted(db, 'entries', keep.id, daysAgo(31))
    purgeTrash(db, 30, NOW)
    expect(repo.getEntry(db, hall.id).parentId).toBeNull()
  })

  it('does nothing when the trash is empty', () => {
    const db = memoryWorld()
    expect(purgeTrash(db, 30, NOW)).toEqual({ stories: 0, chapters: 0, scenes: 0, entries: 0, generations: 0 })
    expect(count(db, 'scenes')).toBe(1)
  })
})
