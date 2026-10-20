// Keeping the story index current: changes gathered for a moment, then taken in a story at a time in the background; a
// scene's rows follow its words, card and where things stand; every story looked at when a world opens or scenes are
// deleted, the stories gone dropped; never a throw into the caller. Worlds made in memory with invented words.
import { describe, expect, it, vi } from 'vitest'
import { memoryWorld } from '../../../tests/unit/helpers'
import { keepStages, person, setCard, stage } from '../../../tests/unit/storyIndexWorld'
import * as repo from '../db/repo'
import * as sidx from '../db/storyIndex'
import { IndexUpkeep, refreshSceneSafely, syncWorldIndex } from './upkeep'

function world() {
  const db = memoryWorld()
  const book = repo.listStories(db)[0].id
  const o = repo.getOutline(db, book)
  const s1 = o.scenes[0].id
  const s2 = repo.createScene(db, o.chapters[0].id, { title: 'Two' }).id
  const mara = repo.createEntry(db, 'character', { name: 'Mara' }).id
  const inn = repo.createEntry(db, 'place', { name: 'The Swan' }).id
  repo.saveSceneText(db, s1, null, 'Mara set the lantern on the table.')
  repo.saveSceneText(db, s2, null, 'Mara slept badly.')
  return { db, book, s1, s2, mara, inn }
}

describe('the story index upkeep', () => {
  it('builds every story when asked for all, and drops a story gone', async () => {
    const w = world()
    const other = repo.createStory(w.db, { title: 'Book 2' }).id
    const s3 = repo.createScene(w.db, repo.createChapter(w.db, other).id).id
    repo.saveSceneText(w.db, s3, null, 'Mara came back.')
    const u = new IndexUpkeep({ db: w.db, delayMs: 1 })
    u.stories()
    await u.whenIdle()
    expect(sidx.indexScenes(w.db, w.book).map((s) => s.sceneId)).toEqual([w.s1, w.s2])
    expect(sidx.indexScenes(w.db, other).map((s) => s.sceneId)).toEqual([s3])
    repo.deleteStory(w.db, other)
    u.stories()
    await u.whenIdle()
    expect(sidx.indexScenes(w.db, other)).toEqual([])
  })

  it('gathers a burst of changes into one refresh, a little later, and takes in a card and where things stand', async () => {
    const w = world()
    syncWorldIndex(w.db)
    const u = new IndexUpkeep({ db: w.db, delayMs: 20 })
    setCard(w.db, w.s2, { povId: w.mara, locationId: w.inn })
    keepStages(w.db, { [w.s2]: stage(w.s2, [person('Mara', { holding: 'the lantern' })], { 'mara|holding': 'Mara slept' }) })
    u.scene(w.s2)
    u.scene(w.s2)
    // Nothing yet: the caller is never held up.
    expect(sidx.indexScene(w.db, w.s2)?.placeEntryId).toBeNull()
    await u.whenIdle()
    const row = sidx.indexScene(w.db, w.s2)!
    expect(row.placeEntryId).toBe(w.inn)
    expect(row.filled).toBe('ai')
  })

  it('takes a deleted scene out, and puts it back when it is brought back', async () => {
    const w = world()
    syncWorldIndex(w.db)
    const u = new IndexUpkeep({ db: w.db, delayMs: 1 })
    repo.deleteScene(w.db, w.s2)
    u.stories()
    await u.whenIdle()
    expect(sidx.indexScene(w.db, w.s2)).toBeNull()
    repo.restoreDeleted(w.db, 'scene', w.s2)
    u.stories()
    await u.whenIdle()
    expect(sidx.indexScene(w.db, w.s2)?.label).toBe('Ch 1, Sc 2')
  })

  it('never throws into the caller, and does nothing once stopped', async () => {
    const w = world()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    w.db.prepare('DROP TABLE index_facts').run()
    expect(refreshSceneSafely(w.db, w.s1)).toBeNull()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
    const fresh = world()
    const u = new IndexUpkeep({ db: fresh.db, delayMs: 1 })
    u.stop()
    u.stories()
    await u.whenIdle()
    expect(sidx.indexScenes(fresh.db, fresh.book)).toEqual([])
  })
})
