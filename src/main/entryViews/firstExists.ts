// Where an entry first exists, as its page shows and changes it (spec, Multi-story rules: "shown and
// changed only on the entry page and in the prequel and first seen elsewhere questions"). A point
// Adam adds or changes is his (byHand), so it is never worked out again when a story's kind or start
// changes. No Electron imports.

import type Database from 'better-sqlite3'
import type { ExistsKind, ID } from '@shared/types'
import type { FirstExists, FirstExistsInput } from '@shared/contracts/entryViews'
import { labeler } from '../memory/line'
import { loadShape } from '../memory/scene'
import * as mem from '../db/memory'
import * as repo from '../db/repo'
import { replaceExistsPoints } from '../db/entryViews'
import { UserError } from '../util'
import { homeStory, sceneStories } from './codex'

type DB = Database.Database

const KINDS: ExistsKind[] = ['world', 'story-pre', 'story-post', 'scene']

/** An entry's first-exists points, each in plain words, with the story it belongs to. */
export function listFirstExists(db: DB, entryId: ID): FirstExists[] {
  repo.getEntry(db, entryId) // a plain-words error when it has been deleted
  const shape = loadShape(db)
  const label = labeler(shape)
  const sceneStory = sceneStories(shape)
  const first = mem.firstStoryId(db)
  const titles = new Map(shape.stories.map((s) => [s.id, s.title]))
  return mem.listExistsPoints(db, entryId).map((p) => ({
    ...p,
    label:
      p.kind === 'world'
        ? 'the beginning of the world'
        : p.kind === 'scene'
          ? label({ storyId: p.storyId, sceneId: p.sceneId })
          : titles.has(p.storyId ?? '')
            ? `the start of ${titles.get(p.storyId!)}`
            : 'the start of a story that was deleted',
    homeStoryId: homeStory(p, first, sceneStory)
  }))
}

/**
 * Makes an entry's first-exists points exactly these, after checking each one is somewhere that
 * still exists. A scene's story is taken from the scene. The same place given twice counts once.
 */
export function setFirstExists(db: DB, entryId: ID, points: FirstExistsInput[]): FirstExists[] {
  repo.getEntry(db, entryId)
  if (!Array.isArray(points) || !points.length) throw new UserError('Choose at least one place where it first appears.')
  const shape = loadShape(db)
  const sceneStory = sceneStories(shape)
  const stories = new Set(shape.stories.map((s) => s.id))
  const clean: FirstExistsInput[] = []
  for (const p of points) {
    if (!KINDS.includes(p?.kind)) throw new UserError("That place in the story isn't known.")
    let next: FirstExistsInput
    if (p.kind === 'world') next = { kind: 'world', storyId: null, sceneId: null, byHand: !!p.byHand }
    else if (p.kind === 'scene') {
      const story = p.sceneId ? sceneStory.get(p.sceneId) : undefined
      if (!story) throw new UserError('That scene no longer exists. Choose another place.')
      next = { kind: 'scene', storyId: story, sceneId: p.sceneId, byHand: !!p.byHand }
    } else {
      if (!p.storyId || !stories.has(p.storyId)) throw new UserError('That story no longer exists. Choose another place.')
      next = { kind: p.kind, storyId: p.storyId, sceneId: null, byHand: !!p.byHand }
    }
    if (!clean.some((c) => c.kind === next.kind && c.storyId === next.storyId && c.sceneId === next.sceneId)) clean.push(next)
  }
  replaceExistsPoints(db, entryId, clean)
  return listFirstExists(db, entryId)
}
