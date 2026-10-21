import { describe, expect, it } from 'vitest'
import * as repo from './repo'
import { liveSceneTexts, sceneTextsOf } from './retrieval'
import { memoryWorld } from '../../../tests/unit/helpers'

describe('the scenes the search reads', () => {
  it('leaves out scenes of a chapter or story in Recently deleted, and takes them back when restored', () => {
    const db = memoryWorld()
    const story = repo.createStory(db, { title: 'Second story' })
    const kept = repo.createChapter(db, story.id, { title: 'One' })
    const gone = repo.createChapter(db, story.id, { title: 'Two' })
    const a = repo.createScene(db, kept.id, { title: 'A' })
    const b = repo.createScene(db, gone.id, { title: 'B' })
    repo.saveSceneText(db, a.id, null, 'The gate was shut.')
    repo.saveSceneText(db, b.id, null, 'The lamp went out.')

    repo.deleteChapter(db, gone.id)
    expect(liveSceneTexts(db).has(a.id)).toBe(true)
    expect(liveSceneTexts(db).has(b.id)).toBe(false)
    expect([...sceneTextsOf(db, [a.id, b.id]).keys()]).toEqual([a.id])

    repo.deleteStory(db, story.id)
    expect(liveSceneTexts(db).has(a.id)).toBe(false)
    expect(sceneTextsOf(db, [a.id]).size).toBe(0)

    repo.restoreDeleted(db, 'story', story.id)
    expect(liveSceneTexts(db).get(a.id)).toBe('The gate was shut.')
  })
})
