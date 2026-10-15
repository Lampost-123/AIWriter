// What a scene's words call its characters (long story memory fix 12), kept in the world's meta table.
import { describe, expect, it } from 'vitest'
import { memoryWorld } from '../../../tests/unit/helpers'
import * as repo from './repo'
import { calledIn, forgetCalled, keepCalled, MOST_CALLED } from './called'
import { purgeTrash } from './trash'

function world() {
  const db = memoryWorld()
  const story = repo.listStories(db)[0]
  const o = repo.getOutline(db, story.id)
  return { db, chapterId: o.chapters[0].id, sceneId: o.scenes[0].id }
}

describe('what a scene calls its characters', () => {
  it('none until the memory reads some; then kept per scene, the same words for someone else taking the old one’s place', () => {
    const { db, sceneId } = world()
    expect(calledIn(db, sceneId)).toEqual([])
    expect(calledIn(db, null)).toEqual([])
    keepCalled(db, sceneId, [
      { entryId: 'mara', words: 'the Captain' },
      { entryId: 'tobin', words: 'her brother' }
    ])
    keepCalled(db, sceneId, [{ entryId: 'kell', words: 'Her  Brother' }])
    expect(calledIn(db, sceneId)).toEqual([
      { entryId: 'mara', words: 'the Captain' },
      { entryId: 'kell', words: 'Her Brother' }
    ])
  })

  it('keeps the newest few, and forgets one on request', () => {
    const { db, sceneId } = world()
    keepCalled(
      db,
      sceneId,
      Array.from({ length: MOST_CALLED + 5 }, (_, i) => ({ entryId: `e${i}`, words: `the Name ${i}` }))
    )
    const kept = calledIn(db, sceneId)
    expect(kept).toHaveLength(MOST_CALLED)
    expect(kept.at(-1)).toEqual({ entryId: `e${MOST_CALLED + 4}`, words: `the Name ${MOST_CALLED + 4}` })
    forgetCalled(db, sceneId, `e${MOST_CALLED + 4}`, 'THE name 34')
    expect(calledIn(db, sceneId)).toHaveLength(MOST_CALLED - 1)
  })

  it('reads anything odd in the store as nothing, and never keeps words too long or too short', () => {
    const { db, sceneId } = world()
    repo.setMeta(db, `called:${sceneId}`, '{not json')
    expect(calledIn(db, sceneId)).toEqual([])
    keepCalled(db, sceneId, [
      { entryId: 'a', words: 'x' },
      { entryId: 'b', words: 'y'.repeat(61) },
      { entryId: '', words: 'the Captain' }
    ])
    expect(calledIn(db, sceneId)).toEqual([])
  })

  it('goes with its scene when the Trash is emptied', () => {
    const { db, chapterId, sceneId } = world()
    const other = repo.createScene(db, chapterId, { title: 'Two' }).id
    keepCalled(db, sceneId, [{ entryId: 'mara', words: 'the Captain' }])
    keepCalled(db, other, [{ entryId: 'mara', words: 'Red' }])
    repo.deleteScene(db, other)
    purgeTrash(db, 30, Date.now() + 40 * 24 * 3600 * 1000)
    expect(calledIn(db, other)).toEqual([])
    expect(calledIn(db, sceneId)).toHaveLength(1)
  })
})
