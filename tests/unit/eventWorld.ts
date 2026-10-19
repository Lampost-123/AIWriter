// A story for the tests of where events sit (2026-10-19, src/main/worldViews/eventHomes.ts and every path that makes an
// event): three chapters, the second with three scenes, each scene on its own day, so "Ch 2, Sc 3" (The Wreck, Day 4) is
// the one an event planned or found there must follow on the timeline, not "Ch 1, Sc 1". All of it is invented.

import type Database from 'better-sqlite3'
import type { KeepItem, KeptItem } from '../../src/shared/contracts/outline'
import type { ID } from '../../src/shared/types'
import { memoryWorld } from './helpers'
import * as repo from '../../src/main/db/repo'
import { keepOutline } from '../../src/main/outline/structure'
import { timelineOf } from '../../src/main/worldViews/index'
import { newWriter, saveEntry } from '../../src/main/worldBuilder/save'

type DB = Database.Database

/** The story's outline as the outline helper keeps it: each scene's goal is its one line, and its When its day. */
export const EVENT_OUTLINE: KeepItem[] = [
  { key: 'c1', kind: 'chapter', title: 'Harbour', text: 'Mara comes home.' },
  { key: 's11', kind: 'scene', title: 'Arrival', text: 'Mara Venn steps off the ferry.', parent: { key: 'c1' }, when: 'Day 1' },
  { key: 'c2', kind: 'chapter', title: 'Reefs', text: 'Out past the light.' },
  { key: 's21', kind: 'scene', title: 'Departure', text: 'The boat leaves at dawn.', parent: { key: 'c2' }, when: 'Day 2' },
  { key: 's22', kind: 'scene', title: 'Fog', text: 'Fog comes down on the water.', parent: { key: 'c2' }, when: 'Day 3' },
  { key: 's23', kind: 'scene', title: 'The Wreck', text: 'The boat breaks up on the reef.', parent: { key: 'c2' }, when: 'Day 4' },
  { key: 'c3', kind: 'chapter', title: 'Ashore', text: 'Back on land.' },
  { key: 's31', kind: 'scene', title: 'Home', text: 'The quay is quiet.', parent: { key: 'c3' }, when: 'Day 6' }
]

export interface EventWorld {
  db: DB
  storyId: ID
  /** The scenes by place: Ch 1 Sc 1, Ch 2 Sc 1 to 3, Ch 3 Sc 1. */
  c1s1: ID
  c2s1: ID
  c2s2: ID
  c2s3: ID
  c3s1: ID
  kept: KeptItem[]
}

/** A world whose first story has the outline above, kept (so with nothing else yet: no events). */
export function eventWorld(outline: KeepItem[] = EVENT_OUTLINE): EventWorld {
  const db = memoryWorld()
  const storyId = repo.listStories(db)[0].id
  const kept = keepOutline(db, storyId, outline)
  const o = repo.getOutline(db, storyId)
  const at = (c: number, s: number): ID => o.scenes.filter((x) => x.chapterId === o.chapters[c - 1].id)[s - 1].id
  return { db, storyId, c1s1: at(1, 1), c2s1: at(2, 1), c2s2: at(2, 2), c2s3: at(2, 3), c3s1: at(3, 1), kept }
}

/** The scene the timeline shows just before this event (other events between them aside); null for none. */
export function sceneBefore(db: DB, storyId: ID, eventId: ID): ID | null {
  const points = timelineOf(db, storyId).points
  const i = points.findIndex((p) => p.id === eventId)
  if (i < 0) throw new Error('The event isn’t on the timeline')
  for (let j = i - 1; j >= 0; j--) if (points[j].kind === 'scene') return points[j].id
  return null
}

/**
 * An event as the World builder made one before 0.7.7 (and the Story builder still does before the outline has its
 * scenes): laid out for the story, with its line in What changed, and true from the story's start. `quote` is the
 * summary's words its line shows.
 */
export function oldBuiltEvent(db: DB, storyId: ID, name: string, o: { when?: string; quote?: string; summary?: string } = {}): ID {
  const w = newWriter(db, storyId, [])
  const made = saveEntry(w, {
    kind: 'event',
    planned: name,
    profile: { values: { name, summary: o.summary ?? `${name} happens.`, ...(o.when ? { when: o.when } : {}) }, his: [] },
    parentId: null,
    hardRule: false,
    involved: [],
    source: { fingerprint: `world-build:entry:event:${name.toLowerCase()}`, words: name, quote: o.quote ?? `${name} happens.` }
  })
  if (!made) throw new Error('The event wasn’t made')
  return made.entry.id
}
