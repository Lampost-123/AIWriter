// Chapter cards in the world database (2026-10-08): kept in meta, written into the scene cards that follow them.
import { describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import type { ChapterCard, ID } from '../../src/shared/types'
import { emptyChapterCard } from '../../src/shared/chapterCard'
import * as repo from '../../src/main/db/repo'
import { purgeTrash } from '../../src/main/db/trash'
import { fillChapterCard } from '../../src/main/outline/chapterCard'
import { memoryWorld } from './helpers'

const card = (more: Partial<ChapterCard> = {}): ChapterCard => ({ ...emptyChapterCard(), ...more })

function lighthouse(): { db: Database.Database; ch: ID; wren: ID; odo: ID; tower: ID; quay: ID } {
  const db = memoryWorld()
  const story = repo.listStories(db)[0]
  const ch = repo.getOutline(db, story.id).chapters[0].id
  const wren = repo.createEntry(db, 'character', { name: 'Wren Calloway' }).id
  const odo = repo.createEntry(db, 'character', { name: 'Odo Fenn' }).id
  const tower = repo.createEntry(db, 'place', { name: 'The Lamp Tower' }).id
  const quay = repo.createEntry(db, 'place', { name: 'Gull Quay' }).id
  return { db, ch, wren, odo, tower, quay }
}

const scenesOf = (db: Database.Database, ch: ID): ID[] =>
  repo
    .getOutline(db, repo.getChapter(db, ch).storyId)
    .scenes.filter((s) => s.chapterId === ch)
    .map((s) => s.id)

describe('chapter cards', () => {
  it('are kept in the meta table, and an empty one is no row at all', () => {
    const { db, ch, wren } = lighthouse()
    expect(repo.getChapterCard(db, ch)).toEqual(emptyChapterCard())
    repo.saveChapterCard(db, ch, card({ povId: wren, when: 'Day 1, dawn' }))
    expect(repo.getMeta(db, `chapter_card:${ch}`)).toContain('Day 1, dawn')
    expect(repo.getChapterCard(db, ch).povId).toBe(wren)
    repo.saveChapterCard(db, ch, emptyChapterCard())
    expect(repo.getMeta(db, `chapter_card:${ch}`)).toBeNull()
  })

  it('go into every scene that follows them, in one go, moving each scene’s time so its views are made again', async () => {
    const { db, ch, wren, tower } = lighthouse()
    const [first] = scenesOf(db, ch)
    const second = repo.createScene(db, ch).id
    const was = repo.getSceneMeta(db, first).updatedAt
    await new Promise((r) => setTimeout(r, 5))
    const saved = repo.saveChapterCard(db, ch, card({ povId: wren, locationId: tower, when: 'Day 1, dawn', mood: 'Hushed' }))
    expect(saved.updated.map((u) => u.sceneId).sort()).toEqual([first, second].sort())
    for (const id of [first, second]) {
      const c = repo.getScene(db, id).card
      expect([c.povId, c.locationId, c.when, c.mood]).toEqual([wren, tower, 'Day 1, dawn', 'Hushed'])
    }
    expect(repo.getSceneMeta(db, first).updatedAt > was).toBe(true)
    // Nothing changed the second time: no scene is written.
    expect(repo.saveChapterCard(db, ch, card({ povId: wren, locationId: tower, when: 'Day 1, dawn', mood: 'Hushed' })).updated).toEqual([])
  })

  it('starts a new scene with the chapter’s card, following it', () => {
    const { db, ch, odo, quay } = lighthouse()
    repo.saveChapterCard(db, ch, card({ presentIds: [odo], locationId: quay, targetWords: 2500, lengthSet: true }))
    const made = repo.getScene(db, repo.createScene(db, ch).id).card
    expect(made.presentIds).toEqual([odo])
    expect(made.locationId).toBe(quay)
    expect(made.targetWords).toBe(2500)
    expect(made.inherits?.location).toBe(true)
  })

  it('leaves what a scene already has as its own when a chapter gets its card, filling only what is empty', () => {
    const { db, ch, wren, odo, tower, quay } = lighthouse()
    const [first] = scenesOf(db, ch)
    // A scene card from before chapter cards: no marks.
    db.prepare('UPDATE scenes SET card_json = ? WHERE id = ?').run(JSON.stringify({ povId: odo, when: 'Day 7, noon' }), first)
    repo.saveChapterCard(db, ch, card({ povId: wren, locationId: tower, when: 'Day 1, dawn' }))
    let c = repo.getScene(db, first).card
    expect([c.povId, c.locationId, c.when]).toEqual([odo, tower, 'Day 7, noon'])
    // The location now follows the chapter; the point of view and When stay the scene's.
    repo.saveChapterCard(db, ch, card({ povId: wren, locationId: quay, when: 'Day 2, dawn' }))
    c = repo.getScene(db, first).card
    expect([c.povId, c.locationId, c.when]).toEqual([odo, quay, 'Day 7, noon'])
  })

  it('puts the chapter card and its scenes back with Undo, leaving the scenes’ other parts as they are now', () => {
    const { db, ch, wren, tower } = lighthouse()
    const [first] = scenesOf(db, ch)
    repo.saveChapterCard(db, ch, card({ povId: wren }))
    const before = repo.getChapterCard(db, ch)
    const saved = repo.saveChapterCard(db, ch, card({ povId: wren, locationId: tower, mood: 'Hushed' }))
    repo.updateSceneCard(db, first, { ...repo.getScene(db, first).card, goal: 'Reach the lamp room' })
    expect(repo.restoreChapterCard(db, ch, before, saved.updated)).toBe(1)
    const c = repo.getScene(db, first).card
    expect([c.povId, c.locationId, c.mood, c.goal]).toEqual([wren, null, '', 'Reach the lamp room'])
    expect(c.inherits?.location).toBe(true)
    expect(repo.getChapterCard(db, ch)).toEqual(before)
  })

  it('moves a scene’s followed parts to its new chapter’s card; its own parts go with it', () => {
    const { db, ch, wren, odo, tower, quay } = lighthouse()
    const other = repo.createChapter(db, repo.getChapter(db, ch).storyId, { title: 'The Quay' }).id
    repo.saveChapterCard(db, ch, card({ povId: wren, locationId: tower, when: 'Day 1, dawn' }))
    repo.saveChapterCard(db, other, card({ povId: odo, locationId: quay, when: 'Day 3, dusk' }))
    const [first] = scenesOf(db, ch)
    repo.updateSceneCard(db, first, { ...repo.getScene(db, first).card, when: 'Day 1, noon' })
    repo.moveScene(db, first, other, 0)
    const c = repo.getScene(db, first).card
    expect([c.povId, c.locationId, c.when]).toEqual([odo, quay, 'Day 1, noon'])
  })

  it('whole-card writers make a followed part the scene’s own only when they change it', () => {
    const { db, ch, wren, tower } = lighthouse()
    const [first] = scenesOf(db, ch)
    repo.saveChapterCard(db, ch, card({ povId: wren, locationId: tower, mood: 'Hushed' }))
    // The interview fills the empty parts, sending the whole card back: what it didn't change still follows.
    const now = repo.getScene(db, first).card
    let out = repo.updateSceneCard(db, first, { ...now, goal: 'Light the lamp', conflict: 'The oil is gone' })
    expect(out.inherits?.mood).toBe(true)
    // Ask the world changes the mood: from now on it is the scene's own.
    out = repo.updateSceneCard(db, first, { ...out, mood: 'Furious' })
    expect(out.inherits?.mood).toBe(false)
    repo.saveChapterCard(db, ch, card({ povId: wren, locationId: tower, mood: 'Grey' }))
    expect(repo.getScene(db, first).card.mood).toBe('Furious')
    // Its Undo writes the card from before: the same as the chapter's, so it follows again.
    out = repo.updateSceneCard(db, first, { ...out, mood: 'Grey', inherits: { ...out.inherits, mood: true } })
    expect(out.inherits?.mood).toBe(true)
  })

  it('stay with a chapter in Recently deleted, and go when it goes for good', () => {
    const { db, ch, wren } = lighthouse()
    const story = repo.getChapter(db, ch).storyId
    const other = repo.createChapter(db, story, { title: 'Spare' }).id
    repo.saveChapterCard(db, ch, card({ povId: wren }))
    repo.saveChapterCard(db, other, card({ povId: wren }))
    repo.setMeta(db, 'chapter_card:gone-for-good', JSON.stringify(card({ mood: 'x' })))
    repo.deleteChapter(db, other)
    const old = new Date(Date.now() - 40 * 86400000).toISOString()
    db.prepare('UPDATE chapters SET deleted_at = ? WHERE id = ?').run(old, other)
    db.prepare('UPDATE scenes SET deleted_at = ? WHERE chapter_id = ?').run(old, other)
    purgeTrash(db, 30)
    expect(repo.getMeta(db, `chapter_card:${other}`)).toBeNull()
    expect(repo.getMeta(db, 'chapter_card:gone-for-good')).toBeNull()
    expect(repo.getChapterCard(db, ch).povId).toBe(wren)
    // One deleted lately keeps its card for a restore.
    repo.deleteChapter(db, ch)
    purgeTrash(db, 30)
    repo.restoreDeleted(db, 'chapter', ch)
    expect(repo.getChapterCard(db, ch).povId).toBe(wren)
  })

  it('go back into a scene restored from Recently deleted: followed parts update, empty unsettled ones fill, its own stay', () => {
    const { db, ch, wren, odo, tower, quay } = lighthouse()
    const [first] = scenesOf(db, ch)
    repo.saveChapterCard(db, ch, card({ povId: wren, when: 'Day 1, dawn' }))
    // The point of view follows the chapter, the When is the scene's own, and the location and mood are unsettled
    // (no mark): the location has a value of the scene's, the mood is empty.
    db.prepare('UPDATE scenes SET card_json = ? WHERE id = ?').run(
      JSON.stringify({ povId: wren, when: 'Day 1, noon', locationId: tower, inherits: { pov: true, when: false } }),
      first
    )
    let c = repo.getScene(db, first).card
    expect([c.inherits?.pov, c.inherits?.when, c.inherits?.location, c.inherits?.mood]).toEqual([true, false, undefined, undefined])
    repo.deleteScene(db, first)
    // The chapter card changes while the scene is deleted: the deleted scene isn't written.
    const saved = repo.saveChapterCard(db, ch, card({ povId: odo, locationId: quay, when: 'Day 9, dusk', mood: 'Grey' }))
    expect(saved.updated.map((u) => u.sceneId)).not.toContain(first)
    const stored = db.prepare('SELECT card_json FROM scenes WHERE id = ?').get(first) as { card_json: string }
    expect(JSON.parse(stored.card_json).povId).toBe(wren)
    repo.restoreDeleted(db, 'scene', first)
    c = repo.getScene(db, first).card
    expect([c.povId, c.when, c.locationId, c.mood]).toEqual([odo, 'Day 1, noon', tower, 'Grey'])
    expect([c.inherits?.pov, c.inherits?.when, c.inherits?.location, c.inherits?.mood]).toEqual([true, false, undefined, true])
  })

  it('leave a restored scene alone when nothing changed while it was deleted', () => {
    const { db, ch, wren } = lighthouse()
    const [first] = scenesOf(db, ch)
    repo.saveChapterCard(db, ch, card({ povId: wren }))
    const before = repo.getScene(db, first)
    repo.deleteScene(db, first)
    repo.restoreDeleted(db, 'scene', first)
    const after = repo.getScene(db, first)
    expect(after.card).toEqual(before.card)
    expect(after.updatedAt).toBe(before.updatedAt)
  })

  it('are filled from a chapter plan’s names, only where empty, names it doesn’t know left out', () => {
    const { db, ch, wren, odo, tower } = lighthouse()
    repo.saveChapterCard(db, ch, card({ mood: 'Adam’s own mood' }))
    const out = fillChapterCard(db, ch, { pov: 'Wren', characters: ['Odo Fenn', 'Nobody Known'], location: 'the lamp tower', when: 'Day 2, morning', mood: 'Uneasy' })
    expect(out.filled).toEqual(['Point of view', 'Characters present', 'Location', 'When'])
    const c = repo.getChapterCard(db, ch)
    expect([c.povId, c.presentIds, c.locationId, c.when, c.mood]).toEqual([wren, [wren, odo], tower, 'Day 2, morning', 'Adam’s own mood'])
    expect(out.updated.length).toBe(1)
    // Its Undo.
    repo.restoreChapterCard(db, ch, out.before, out.updated)
    expect(repo.getChapterCard(db, ch)).toEqual(out.before)
  })
})
