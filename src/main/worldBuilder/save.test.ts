// Saving a build's events: an event of the story's plan dated "Day N" with no scene given goes at the first scene
// dated that day or later (2026-10-17). Invented story only.
import { describe, expect, it } from 'vitest'
import { emptySceneCard } from '@shared/defaults'
import type { ID } from '@shared/types'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import { memoryWorld } from '../../../tests/unit/helpers'
import { newWriter, saveEntry, type NewEntry } from './save'

/** The world's first story, its scenes dated as given, and Mara, who takes part in what the build makes. */
function dated(whens: string[]) {
  const db = memoryWorld()
  const [story] = repo.listStories(db)
  const outline = repo.getOutline(db, story.id)
  const scenes: ID[] = [outline.scenes[0].id]
  for (let i = 1; i < whens.length; i++) scenes.push(repo.createScene(db, outline.chapters[0].id, { title: `Scene ${i + 1}`, afterId: scenes[i - 1] }).id)
  whens.forEach((when, i) => repo.updateSceneCard(db, scenes[i], { ...emptySceneCard(), when }))
  const mara = repo.createEntry(db, 'character', { name: 'Mara Venn' })
  return { db, story, scenes, mara }
}

const storm = (when: string, involved: ID[], sceneId?: ID): NewEntry => ({
  kind: 'event',
  planned: 'The Storm',
  profile: { values: { name: 'The Storm', when }, his: [] },
  parentId: null,
  hardRule: false,
  involved,
  sceneId,
  source: { fingerprint: 'storm', words: 'The Storm', quote: '' }
})

describe('an event of the story’s plan dated by its day, with no scene given', () => {
  it('first exists at the first scene dated that day or later, and those in it are involved from there', () => {
    const { db, story, scenes, mara } = dated(['Day 1', 'Day 4', 'Day 6'])
    const w = newWriter(db, story.id, scenes)
    const e = saveEntry(w, storm('Day 3, night', [mara.id]))!.entry
    expect(e.originSceneId).toBe(scenes[1])
    expect(mem.listExistsPoints(db, e.id)).toEqual([expect.objectContaining({ kind: 'scene', sceneId: scenes[1] })])
    const involved = mem.changesForEntry(db, mara.id).filter((c) => c.kind === 'relationship' && c.payload.otherId === e.id)
    expect(involved).toEqual([expect.objectContaining({ anchor: 'scene', sceneId: scenes[1], storyId: story.id })])
  })

  it('counts the day from the first date of a story dated by the calendar', () => {
    const { db, story, scenes, mara } = dated(['12 March 1842', '13 March 1842', '15 March 1842'])
    const e = saveEntry(newWriter(db, story.id, scenes), storm('Day 3', [mara.id]))!.entry
    expect(e.originSceneId).toBe(scenes[2])
  })

  it('stays where the build is true when no scene is dated that late, or the day can’t be read', () => {
    for (const when of ['Day 9', 'Year 3', 'after the wedding', '']) {
      const { db, story, scenes, mara } = dated(['Day 1', 'Day 4'])
      const e = saveEntry(newWriter(db, story.id, scenes), storm(when, [mara.id]))!.entry
      expect(e.originSceneId).toBeNull()
      expect(mem.listExistsPoints(db, e.id)).toEqual([expect.objectContaining({ kind: 'world' })])
      const involved = mem.changesForEntry(db, mara.id).filter((c) => c.kind === 'relationship' && c.payload.otherId === e.id)
      expect(involved).toEqual([expect.objectContaining({ anchor: 'story-start', sceneId: null })])
    }
  })

  it('keeps the scene the plan gives, and leaves Adam’s own summary’s events where the build is true', () => {
    const { db, story, scenes, mara } = dated(['Day 1', 'Day 4', 'Day 6'])
    expect(saveEntry(newWriter(db, story.id, scenes), storm('Day 3', [mara.id], scenes[2]))!.entry.originSceneId).toBe(scenes[2])
    expect(saveEntry(newWriter(db, story.id), storm('Day 3', [mara.id]))!.entry.originSceneId).toBeNull()
  })
})
