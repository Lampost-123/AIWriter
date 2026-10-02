import { describe, expect, it } from 'vitest'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import { entryAsOf } from '../memory/asOf'
import { memoryWorld } from '../../../tests/unit/helpers'
import { listFirstExists, setFirstExists } from './firstExists'
import { editSince, keepEditFromStory, noteFor } from './keepEdit'

/** Book 1 (one scene) and Book 2 continuing after it (one scene), and Mara, made in Book 1. */
function world() {
  const db = memoryWorld()
  const b1 = repo.listStories(db)[0].id
  const s1 = repo.getOutline(db, b1).scenes[0].id
  const b2 = repo.createStory(db, { title: 'Book 2' }).id
  const s2 = repo.createScene(db, repo.createChapter(db, b2).id).id
  const mara = repo.createEntry(db, 'character', { name: 'Mara', fields: { eyes: 'blue' }, originStoryId: b1 }).id
  return { db, b1, b2, s1, s2, mara }
}

describe('where an entry first exists, from its page', () => {
  it('is said in plain words, with the story each point belongs to', () => {
    const { db, b1, b2, s2, mara } = world()
    expect(listFirstExists(db, mara).map((p) => [p.label, p.homeStoryId, p.byHand])).toEqual([['the beginning of the world', b1, false]])
    const points = setFirstExists(db, mara, [
      { kind: 'story-pre', storyId: b2, sceneId: null, byHand: true },
      { kind: 'scene', storyId: null, sceneId: s2, byHand: true }
    ])
    expect(points.map((p) => [p.label, p.homeStoryId, p.storyId])).toEqual([
      ['the start of Book 2', b2, b2],
      ['Book 2, Ch 1, Sc 1', b2, b2]
    ])
  })

  it('changes what the memory holds: before the new point the entry isn’t there yet', () => {
    const { db, b1, b2, s1, s2, mara } = world()
    setFirstExists(db, mara, [{ kind: 'scene', storyId: b2, sceneId: s2, byHand: true }])
    const before = entryAsOf(db, mara, { kind: 'scene', storyId: b1, sceneId: s1 })
    expect(before.state).toBeNull()
    expect(before.absent).toBe('Not in the story yet at this point')
    expect(entryAsOf(db, mara, { kind: 'scene', storyId: b2, sceneId: s2 }).state?.name).toBe('Mara')
  })

  it('keeps points that stay as they were, so the app’s default stays first and Adam’s are never worked out again', () => {
    const { db, b2, mara } = world()
    const [def] = listFirstExists(db, mara)
    const after = setFirstExists(db, mara, [
      { kind: 'world', storyId: null, sceneId: null, byHand: false },
      { kind: 'story-pre', storyId: b2, sceneId: null, byHand: true }
    ])
    expect(after[0].id).toBe(def.id)
    // Only Adam's point now: a story's kind or start changing leaves it alone.
    setFirstExists(db, mara, [{ kind: 'story-pre', storyId: b2, sceneId: null, byHand: true }])
    mem.refreshDefaultExistsPoints(db)
    expect(listFirstExists(db, mara).map((p) => [p.kind, p.storyId, p.byHand])).toEqual([['story-pre', b2, true]])
  })

  it('refuses no point at all, or a place that no longer exists, in plain words', () => {
    const { db, b2, s2, mara } = world()
    expect(() => setFirstExists(db, mara, [])).toThrow('Choose at least one place where it first appears.')
    repo.deleteScene(db, s2)
    expect(() => setFirstExists(db, mara, [{ kind: 'scene', storyId: b2, sceneId: s2, byHand: true }])).toThrow('That scene no longer exists')
    expect(() => setFirstExists(db, mara, [{ kind: 'story-pre', storyId: 'gone', sceneId: null, byHand: true }])).toThrow(
      'That story no longer exists'
    )
  })
})

describe('"Only from <story> on"', () => {
  it('turns an edit into a start-of-story change and puts the profile back, with who each field came from', () => {
    const { db, b1, b2, mara } = world()
    repo.updateEntry(db, mara, { fields: { eyes: 'green' }, summary: 'Older now' })
    expect(repo.getEntry(db, mara).fieldOrigins.eyes).toBe('adam')
    const { entry, change } = keepEditFromStory(db, mara, b2, { fields: { eyes: 'blue' }, summary: '', origins: { eyes: null, summary: null } })
    expect(entry.fields.eyes).toBe('blue')
    expect(entry.summary).toBe('')
    expect(entry.fieldOrigins.eyes).toBeUndefined()
    expect(change).toMatchObject({ anchor: 'story-start', storyId: b2, origin: 'adam', kind: 'update', where: 'the start of Book 2' })
    expect(change.kind === 'update' && change.payload).toEqual({ note: 'In short: Older now; Eyes: green', summary: 'Older now', fields: { eyes: 'green' } })
    expect(mem.changesForEntry(db, mara)).toHaveLength(1)
    // Book 1 keeps her blue eyes; from Book 2 on they are green.
    expect(entryAsOf(db, mara, { kind: 'end', storyId: b1 }).state?.fields.eyes).toBe('blue')
    expect(entryAsOf(db, mara, { kind: 'start', storyId: b2 }).state?.fields.eyes).toBe('green')
  })

  it('says so when nothing has changed, and refuses a story that is gone', () => {
    const { db, b2, mara } = world()
    expect(() => keepEditFromStory(db, mara, b2, { fields: { eyes: 'blue' }, origins: {} })).toThrow('Nothing has changed here since')
    repo.deleteStory(db, b2)
    expect(() => keepEditFromStory(db, mara, b2, { fields: { eyes: 'x' }, origins: {} })).toThrow('That story no longer exists')
  })

  it('describes the change the way entry pages do', () => {
    const { db, mara } = world()
    const e = repo.getEntry(db, mara)
    expect(editSince({ ...e, fields: { eyes: 'grey' } }, { fields: { eyes: 'blue', hair: '' }, origins: {} })).toEqual({ fields: { eyes: 'grey' } })
    expect(noteFor('character', { description: 'New', fields: { hair: '' } })).toBe('A new description; Hair left blank')
  })
})
