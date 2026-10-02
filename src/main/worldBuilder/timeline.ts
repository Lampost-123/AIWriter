// The timeline starts when a world is built: the story's opening scene is on "Day 1", so the events the
// build dates in the story's count of days ("Day 3, dusk") have a day to count from, and the Timeline
// page has something to show. Only while no scene of the story has a When: a When Adam set is never
// changed. No Electron imports.

import type Database from 'better-sqlite3'
import type { ID } from '@shared/types'
import * as repo from '../db/repo'
import * as acts from '../db/acts'

type DB = Database.Database

/** The first day of a story, in the count of days the World builder and the outline helper use. */
export const OPENING_WHEN = 'Day 1'

/**
 * The story a build lays the timeline out for: the one it was built for, else (built for the beginning
 * of the world) the first story on the shelf that starts there. Null when there is none.
 */
export function timelineStory(db: DB, storyId: ID | null): ID | null {
  const stories = repo.listStories(db)
  if (storyId) return stories.some((s) => s.id === storyId) ? storyId : null
  return (stories.find((s) => !s.startStoryId) ?? stories[0])?.id ?? null
}

/**
 * Puts the story's opening scene on "Day 1" when no scene in the story has a When yet. Says which
 * scene it dated, or null when it left the story as it was (a scene has a When, or there is none).
 */
export function startTimeline(db: DB, storyId: ID | null): ID | null {
  const id = timelineStory(db, storyId)
  if (!id) return null
  return db.transaction((): ID | null => {
    const first = repo.getOutline(db, id).scenes[0]
    if (!first) return null
    const cards = acts.storyCards(db, id)
    if ([...cards.values()].some((c) => c.when.trim())) return null
    const card = repo.getScene(db, first.id).card
    if (card.when.trim()) return null
    repo.updateSceneCard(db, first.id, { ...card, when: OPENING_WHEN })
    return first.id
  })()
}
