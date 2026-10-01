import { describe, expect, it } from 'vitest'
import * as repo from '../../src/main/db/repo'
import { UserError } from '../../src/main/util'
import { memoryWorld } from './helpers'

const firstStory = (db: ReturnType<typeof memoryWorld>) => repo.listStories(db)[0]

describe('initWorld', () => {
  it('sets up the world, a series, a first story, chapter and scene', () => {
    const db = memoryWorld('The Northern Reaches')
    expect(repo.getMeta(db, 'id')).toBe('world-1')
    expect(repo.getMeta(db, 'name')).toBe('The Northern Reaches')
    expect(repo.getMeta(db, 'created_at')).toBe(repo.getMeta(db, 'updated_at'))
    expect(repo.getWorldStyle(db).avoidPhrases).toEqual([])

    const series = repo.listSeries(db)
    expect(series).toHaveLength(1)
    const stories = repo.listStories(db)
    expect(stories.map((s) => s.title)).toEqual(['Book 1'])
    expect(stories[0].seriesId).toBe(series[0].id)
    expect(stories[0].startStoryId).toBeNull()

    const outline = repo.getOutline(db, stories[0].id)
    expect(outline.chapters.map((c) => c.title)).toEqual(['Chapter 1'])
    expect(outline.scenes.map((s) => s.title)).toEqual(['Scene 1'])
    expect(outline.scenes[0].status).toBe('planned')
    expect(outline.scenes[0].wordCount).toBe(0)
  })
})

describe('stories', () => {
  it('a new story continues after the last one by default', () => {
    const db = memoryWorld()
    const book1 = firstStory(db)
    const book2 = repo.createStory(db, { title: '  Book 2 ' })
    expect(book2.title).toBe('Book 2')
    expect(book2.startStoryId).toBe(book1.id)
    expect(book2.position).toBeGreaterThan(book1.position)
    expect(repo.createStory(db, { title: '', startStoryId: null }).title).toBe('Untitled story')
  })

  it('updates and deletes a story', () => {
    const db = memoryWorld()
    const s = firstStory(db)
    const updated = repo.updateStory(db, s.id, { premise: 'A long winter', style: { pov: 'First person' } })
    expect(updated.premise).toBe('A long winter')
    expect(updated.style).toEqual({ pov: 'First person' })
    repo.deleteStory(db, s.id)
    expect(repo.listStories(db)).toHaveLength(0)
    expect(() => repo.getStory(db, s.id)).toThrow(UserError)
    repo.restoreDeleted(db, 'story', s.id)
    expect(repo.listStories(db).map((x) => x.id)).toEqual([s.id])
  })
})

describe('outline ordering', () => {
  it('appends chapters and scenes, or inserts them after a given one', () => {
    const db = memoryWorld()
    const story = firstStory(db)
    const [ch1] = repo.getOutline(db, story.id).chapters
    const ch3 = repo.createChapter(db, story.id)
    expect(ch3.title).toBe('Chapter 2')
    const ch2 = repo.createChapter(db, story.id, { title: 'Middle', afterId: ch1.id })
    expect(repo.getOutline(db, story.id).chapters.map((c) => c.id)).toEqual([ch1.id, ch2.id, ch3.id])
    expect(repo.getOutline(db, story.id).chapters.map((c) => c.position)).toEqual([0, 1, 2])

    const [s1] = repo.getOutline(db, story.id).scenes
    const s3 = repo.createScene(db, ch1.id)
    const s2 = repo.createScene(db, ch1.id, { title: 'Between', afterId: s1.id })
    const sceneInCh2 = repo.createScene(db, ch2.id, { title: 'Later' })
    const outline = repo.getOutline(db, story.id)
    // Scenes come in reading order: chapter order first, then scene order.
    expect(outline.scenes.map((s) => s.id)).toEqual([s1.id, s2.id, s3.id, sceneInCh2.id])
    expect(outline.scenes.filter((s) => s.chapterId === ch1.id).map((s) => s.position)).toEqual([0, 1, 2])
  })

  it('moves chapters, clamping the index', () => {
    const db = memoryWorld()
    const story = firstStory(db)
    const [a] = repo.getOutline(db, story.id).chapters
    const b = repo.createChapter(db, story.id)
    const c = repo.createChapter(db, story.id)
    repo.moveChapter(db, c.id, 0)
    expect(repo.getOutline(db, story.id).chapters.map((x) => x.id)).toEqual([c.id, a.id, b.id])
    repo.moveChapter(db, c.id, 99)
    expect(repo.getOutline(db, story.id).chapters.map((x) => x.id)).toEqual([a.id, b.id, c.id])
    repo.moveChapter(db, a.id, -5)
    expect(repo.getOutline(db, story.id).chapters.map((x) => x.position)).toEqual([0, 1, 2])
  })

  it('moves scenes within a chapter and between chapters', () => {
    const db = memoryWorld()
    const story = firstStory(db)
    const [ch1] = repo.getOutline(db, story.id).chapters
    const ch2 = repo.createChapter(db, story.id)
    const [s1] = repo.getOutline(db, story.id).scenes
    const s2 = repo.createScene(db, ch1.id)
    const s3 = repo.createScene(db, ch1.id)
    const t1 = repo.createScene(db, ch2.id)

    repo.moveScene(db, s3.id, ch1.id, 0)
    expect(repo.getOutline(db, story.id).scenes.filter((s) => s.chapterId === ch1.id).map((s) => s.id)).toEqual([s3.id, s1.id, s2.id])

    repo.moveScene(db, s1.id, ch2.id, 1)
    const outline = repo.getOutline(db, story.id)
    const inCh1 = outline.scenes.filter((s) => s.chapterId === ch1.id)
    const inCh2 = outline.scenes.filter((s) => s.chapterId === ch2.id)
    expect(inCh1.map((s) => s.id)).toEqual([s3.id, s2.id])
    expect(inCh1.map((s) => s.position)).toEqual([0, 1])
    expect(inCh2.map((s) => s.id)).toEqual([t1.id, s1.id])
    expect(inCh2.map((s) => s.position)).toEqual([0, 1])
    expect(repo.getSceneMeta(db, s1.id).chapterId).toBe(ch2.id)
  })
})

describe('deleting and restoring', () => {
  it('a deleted scene leaves the outline and comes back on restore', () => {
    const db = memoryWorld()
    const story = firstStory(db)
    const [s1] = repo.getOutline(db, story.id).scenes
    repo.deleteScene(db, s1.id)
    expect(repo.getOutline(db, story.id).scenes).toHaveLength(0)
    expect(() => repo.getScene(db, s1.id)).toThrow('That scene no longer exists.')
    repo.restoreDeleted(db, 'scene', s1.id)
    expect(repo.getOutline(db, story.id).scenes.map((s) => s.id)).toEqual([s1.id])
  })

  it('a deleted chapter takes its scenes, and restoring brings back only those deleted with it', async () => {
    const db = memoryWorld()
    const story = firstStory(db)
    const [ch1] = repo.getOutline(db, story.id).chapters
    const [s1] = repo.getOutline(db, story.id).scenes
    const s2 = repo.createScene(db, ch1.id)
    repo.deleteScene(db, s2.id) // deleted earlier, on its own
    await new Promise((r) => setTimeout(r, 5)) // a later deleted_at
    repo.deleteChapter(db, ch1.id)
    expect(repo.getOutline(db, story.id).chapters).toHaveLength(0)
    expect(repo.getOutline(db, story.id).scenes).toHaveLength(0)

    repo.restoreDeleted(db, 'chapter', ch1.id)
    const outline = repo.getOutline(db, story.id)
    expect(outline.chapters.map((c) => c.id)).toEqual([ch1.id])
    expect(outline.scenes.map((s) => s.id)).toEqual([s1.id])
  })

  it('restoring something that never existed is a plain error', () => {
    const db = memoryWorld()
    expect(() => repo.restoreDeleted(db, 'entry', 'nope')).toThrow('That item could not be found to restore.')
  })
})

describe('previousScene', () => {
  it('is the scene before in this story, or the last scene of the story this one continues', () => {
    const db = memoryWorld()
    const book1 = firstStory(db)
    const [b1ch1] = repo.getOutline(db, book1.id).chapters
    const [b1s1] = repo.getOutline(db, book1.id).scenes
    const b1ch2 = repo.createChapter(db, book1.id)
    const b1s2 = repo.createScene(db, b1ch2.id)

    expect(repo.previousScene(db, b1s1.id)).toBeNull()
    expect(repo.previousScene(db, b1s2.id)?.id).toBe(b1s1.id)

    const book2 = repo.createStory(db, { title: 'Book 2' })
    const b2ch1 = repo.createChapter(db, book2.id)
    const b2s1 = repo.createScene(db, b2ch1.id)
    const b2s2 = repo.createScene(db, b2ch1.id)
    expect(repo.previousScene(db, b2s1.id)?.id).toBe(b1s2.id)
    expect(repo.previousScene(db, b2s2.id)?.id).toBe(b2s1.id)
    expect(b1ch1.storyId).toBe(book1.id)
  })

  it('skips an empty story in between and ignores deleted scenes', () => {
    const db = memoryWorld()
    const book1 = firstStory(db)
    const [b1s1] = repo.getOutline(db, book1.id).scenes
    const book2 = repo.createStory(db, { title: 'Book 2' }) // no chapters
    const book3 = repo.createStory(db, { title: 'Book 3', startStoryId: book2.id })
    const ch = repo.createChapter(db, book3.id)
    const first = repo.createScene(db, ch.id)
    expect(repo.previousScene(db, first.id)?.id).toBe(b1s1.id)

    repo.deleteScene(db, b1s1.id)
    expect(repo.previousScene(db, first.id)).toBeNull()
  })
})

describe('scene text', () => {
  it('counts words and moves a planned scene to drafted', () => {
    const db = memoryWorld()
    const [s] = repo.getOutline(db, firstStory(db).id).scenes
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] }
    const res = repo.saveSceneText(db, s.id, doc, "Mara didn't flinch.\n\nThe Duke's well-kept hall was cold, 12 degrees.")
    expect(res.wordCount).toBe(11)
    const scene = repo.getScene(db, s.id)
    expect(scene.status).toBe('drafted')
    expect(scene.wordCount).toBe(11)
    expect(scene.doc).toEqual(doc)
    expect(scene.updatedAt).toBe(res.updatedAt)
  })

  it('leaves a planned scene planned while empty, and never moves a revised scene back', () => {
    const db = memoryWorld()
    const [s] = repo.getOutline(db, firstStory(db).id).scenes
    repo.saveSceneText(db, s.id, null, '   ')
    expect(repo.getScene(db, s.id).status).toBe('planned')
    expect(repo.getScene(db, s.id).doc).toBeNull()
    repo.updateScene(db, s.id, { status: 'revised' })
    repo.saveSceneText(db, s.id, null, 'More words here')
    expect(repo.getScene(db, s.id).status).toBe('revised')
  })

  it('keeps the scene card with defaults filled in', () => {
    const db = memoryWorld()
    const [s] = repo.getOutline(db, firstStory(db).id).scenes
    const card = repo.updateSceneCard(db, s.id, { ...repo.getScene(db, s.id).card, goal: 'Escape', beats: ['Door', 'Run'] })
    expect(card.goal).toBe('Escape')
    expect(repo.getScene(db, s.id).card.beats).toEqual(['Door', 'Run'])
    expect(repo.getScene(db, s.id).card.targetWords).toBe(1500)
  })
})

describe('entries', () => {
  it('creates, lists by kind in name order, updates and deletes', () => {
    const db = memoryWorld()
    const mara = repo.createEntry(db, 'character', { name: 'Mara', aliases: ['The Hand'], fields: { appearance: 'Lost her left hand' } })
    repo.createEntry(db, 'character', { name: 'aldric' })
    const keep = repo.createEntry(db, 'place', { name: 'Keep' })
    const room = repo.createEntry(db, 'place', { name: 'Great hall', parentId: keep.id })
    const rule = repo.createEntry(db, 'lore', { name: 'Iron burns fae', hardRule: true })

    expect(repo.listEntries(db, 'character').map((e) => e.name)).toEqual(['aldric', 'Mara'])
    expect(repo.listEntries(db)).toHaveLength(5)
    expect(repo.getEntry(db, room.id).parentId).toBe(keep.id)
    expect(repo.getEntry(db, rule.id).hardRule).toBe(true)
    expect(repo.getEntry(db, mara.id).aliases).toEqual(['The Hand'])
    expect(repo.createEntry(db, 'item', { name: '   ' }).name).toBe('Unnamed')

    const updated = repo.updateEntry(db, mara.id, { summary: 'A soldier', parentId: mara.id })
    expect(updated.summary).toBe('A soldier')
    expect(updated.parentId).toBeNull() // never its own parent
    expect(updated.fields).toEqual({ appearance: 'Lost her left hand' })

    expect(repo.getEntries(db, [mara.id, 'missing', keep.id]).map((e) => e.name)).toEqual(['Mara', 'Keep'])

    repo.deleteEntry(db, mara.id)
    expect(repo.listEntries(db, 'character').map((e) => e.name)).toEqual(['aldric'])
    expect(() => repo.getEntry(db, mara.id)).toThrow(UserError)
    repo.restoreDeleted(db, 'entry', mara.id)
    expect(repo.getEntry(db, mara.id).name).toBe('Mara')
  })
})
