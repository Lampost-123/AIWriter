// The scenes before the previous one, for the writer to have word for word where there is room (2026-10-15). On the
// built-in sample world: one story, two chapters, four scenes.
import { describe, expect, it } from 'vitest'
import { memoryWorld } from '../../../tests/unit/helpers'
import * as repo from '../db/repo'
import { fillSampleWorld } from '../setup/sampleWorld'
import { EARLIER_SCENES, sceneMemory } from './scene'

describe('the scenes before, for the writer', () => {
  const db = memoryWorld('Untitled')
  fillSampleWorld(db)
  const story = repo.listStories(db)[0]
  const scenes = repo.getOutline(db, story.id).scenes.map((s) => s.id)

  it('are the scenes before the previous one, oldest first, with their words, across chapters', () => {
    const m = sceneMemory(db, scenes[3], { forWriter: true })
    expect(m.previous?.sceneId).toBe(scenes[2])
    expect(m.previous?.label).toMatch(/Ch 2, Sc 1$/)
    expect(EARLIER_SCENES).toBe(2)
    expect(m.earlier?.map((x) => x.sceneId)).toEqual([scenes[0], scenes[1]])
    for (const x of m.earlier ?? []) {
      expect(x.text).toBe(repo.getScene(db, x.sceneId).text)
      expect(x.label).toMatch(/Ch 1, Sc \d$/)
    }
  })

  it('are fewer near the start, none for the second scene, and only for the writer', () => {
    expect(sceneMemory(db, scenes[2], { forWriter: true }).earlier?.map((x) => x.sceneId)).toEqual([scenes[0]])
    expect(sceneMemory(db, scenes[1], { forWriter: true }).earlier).toBeUndefined()
    expect(sceneMemory(db, scenes[3]).earlier).toBeUndefined()
  })
})
