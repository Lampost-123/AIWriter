// Milestone 3: the handlers for src/shared/contracts/stories.ts (one part owns both files). The rules are
// in src/main/stories/ and the SQL in src/main/db/stories.ts; this file connects them to the open world.
import type { Handlers } from './index'
import type { StoriesApi } from '@shared/contracts/stories'
import type { ID } from '@shared/types'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import * as stories from '../db/stories'
import * as world from '../world'
import { mightFollow, previewStory, suggestion } from '../stories/rules'
import { deleteNotes, previewMove } from '../stories/points'
import { emit } from '../events'
import { UserError } from '../util'

/** Wraps a write so the world's "last changed" time moves (backups watch it). */
function write<T>(fn: () => T): T {
  const db = world.db()
  const result = db.transaction(fn)()
  repo.touchWorld(db)
  return result
}

/** What counts everywhere may have changed: every view of the memory reloads, and the stories with it. */
const memoryChanged = (entryIds: ID[] = []): void => emit('memory:changed', { sceneId: null, entryIds: [...new Set(entryIds)] })

const shape = (): ReturnType<typeof mem.loadShape> => mem.loadShape(world.db())

export const storiesHandlers: Handlers<keyof StoriesApi> = {
  previewStory: (draft) => previewStory(shape(), draft),
  suggestStart: (input) => suggestion(shape(), { seriesId: input?.seriesId ?? null, newSeries: input?.newSeries, fromStoryId: input?.fromStoryId ?? null }),
  createStoryAs: (input) => {
    const made = write(() => stories.createStoryAs(world.db(), input))
    memoryChanged(made.entryIds)
    return { story: made.story, sceneId: made.sceneId, mightFollow: mightFollow(shape(), made.story.id) }
  },
  getStoryDetails: (storyId) => stories.storyDetails(world.db(), storyId),
  createSeries: (name) => write(() => stories.createSeries(world.db(), name)),
  updateSeries: (id, patch) => write(() => stories.updateSeries(world.db(), id, patch ?? {})),
  setLeadsIn: (storyId, on) => {
    write(() => stories.setLeadsIn(world.db(), storyId, !!on))
    // Which story steers towards the book's opening has changed.
    memoryChanged()
  },
  previewMove: (move) => {
    if (!move || (move.kind !== 'scene' && move.kind !== 'chapter')) throw new UserError('That can’t be moved.')
    return previewMove(shape(), move)
  },
  deleteNotes: (kind, id) => deleteNotes(shape(), kind, id)
}
