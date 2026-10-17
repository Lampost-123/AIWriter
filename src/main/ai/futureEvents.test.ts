// The writer's brief and events still to come, from a world in the database (Adam, 2026-10-17): an event's date decides
// whether it has happened yet, never the scene an earlier build tied it to, as on the timeline (worldViews/eventPlace.ts).
// Invented story only.
import { describe, expect, it } from 'vitest'
import { defaultWritingPrefs, emptySceneCard } from '@shared/defaults'
import type { ID } from '@shared/types'
import * as repo from '../db/repo'
import { memoryWorld } from '../../../tests/unit/helpers'
import { gatherContextInput } from './gather'
import { selectEntries } from './context'

function world() {
  const db = memoryWorld()
  const [book] = repo.listStories(db)
  const outline = repo.getOutline(db, book.id)
  const scenes: ID[] = [outline.scenes[0].id, repo.createScene(db, outline.chapters[0].id, { afterId: outline.scenes[0].id }).id]
  const beats = ['The Storm breaks the pier.', 'The Fair goes on.', 'The Quarrel ends.']
  repo.updateSceneCard(db, scenes[0], { ...emptySceneCard(), when: 'Day 1' })
  repo.updateSceneCard(db, scenes[1], { ...emptySceneCard(), when: 'Day 2, dawn', beats })
  // All three tied to scene 1 by an earlier build.
  const tied = { origin: 'ai' as const, originStoryId: book.id, originSceneId: scenes[0] }
  const storm = repo.createEntry(db, 'event', { name: 'The Storm', fields: { when: 'Day 5' } }, tied)
  const fair = repo.createEntry(db, 'event', { name: 'The Fair', fields: { when: 'Day 1' } }, tied)
  const quarrel = repo.createEntry(db, 'event', { name: 'The Quarrel', fields: { when: 'Day 2, night' } }, tied)
  const chosen = (sceneId: ID): Set<ID> =>
    new Set(selectEntries(gatherContextInput(db, sceneId, undefined, { prefs: defaultWritingPrefs(), contextLength: 64000, creativity: 'balanced' })).chosen.keys())
  return { db, scenes, storm, fair, quarrel, chosen }
}

describe('the brief for a Day 2 scene', () => {
  it('never tells an event tied to scene 1 but dated Day 5 as past, and tells the Day 1 one', () => {
    const w = world()
    const here = w.chosen(w.scenes[1])
    expect(here.has(w.storm.id)).toBe(false)
    expect(here.has(w.fair.id)).toBe(true)
    // Later the same day, by the time both say: still to come at dawn.
    expect(here.has(w.quarrel.id)).toBe(false)
  })

  it('tells them all once the story reaches their day', () => {
    const w = world()
    repo.updateSceneCard(w.db, w.scenes[1], { ...repo.getScene(w.db, w.scenes[1]).card, when: 'Day 6' })
    const here = w.chosen(w.scenes[1])
    expect([w.storm.id, w.fair.id, w.quarrel.id].every((id) => here.has(id))).toBe(true)
  })
})
