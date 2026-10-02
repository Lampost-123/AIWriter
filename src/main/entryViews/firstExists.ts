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
import * as views from '../db/entryViews'
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

type Place = Pick<FirstExistsInput, 'kind' | 'storyId' | 'sceneId'>

/** The same place: the beginning of the world, one scene, or one story's start of the same kind. */
const samePlace = (a: Place, b: Place): boolean =>
  a.kind === b.kind && (a.kind === 'scene' ? (a.sceneId ?? null) === (b.sceneId ?? null) : (a.storyId ?? null) === (b.storyId ?? null))

/**
 * Makes an entry's first-exists points exactly these. A scene's story is taken from the scene. A place
 * must still be in the world: a point the entry already has passes as it is, even on a scene or story
 * deleted since (so Adam can add another place and then remove that one), and so does a place in
 * Recently deleted (so Undo can put such a point back; the memory reads a point there as the place
 * just before it). Only a place gone for good is refused. The same place given twice counts once.
 */
export function setFirstExists(db: DB, entryId: ID, points: FirstExistsInput[]): FirstExists[] {
  repo.getEntry(db, entryId)
  if (!Array.isArray(points) || !points.length) throw new UserError('Choose at least one point where it first appears.')
  const shape = loadShape(db)
  const sceneStory = sceneStories(shape)
  const stories = new Set(shape.stories.map((s) => s.id))
  const had = mem.listExistsPoints(db, entryId)
  const clean: FirstExistsInput[] = []
  for (const p of points) {
    if (!KINDS.includes(p?.kind)) throw new UserError("That point in the story isn't known.")
    const byHand = !!p.byHand
    let next: FirstExistsInput
    if (p.kind === 'world') next = { kind: 'world', storyId: null, sceneId: null, byHand }
    else {
      const scene = p.kind === 'scene'
      const sceneId = scene ? (p.sceneId ?? null) : null
      const live = scene ? sceneStory.get(sceneId ?? '') : p.storyId && stories.has(p.storyId) ? p.storyId : undefined
      const kept = had.find((h) => samePlace(h, p))
      const story = live ?? (kept ? kept.storyId : views.storyOfPlace(db, { kind: p.kind, storyId: p.storyId ?? null, sceneId }))
      if (!story && !kept) throw new UserError(`That ${scene ? 'scene' : 'story'} no longer exists. Choose another point.`)
      next = { kind: p.kind, storyId: story ?? null, sceneId, byHand }
    }
    if (!clean.some((c) => samePlace(c, next))) clean.push(next)
  }
  views.replaceExistsPoints(db, entryId, clean)
  return listFirstExists(db, entryId)
}
