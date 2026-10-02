// Milestone 3's shared calls: portraits and the memory as of a point. The parts' own calls are in
// the other milestone 3 handler files (builder.ts, entryViews.ts, worldViews.ts ...).
import type { Handlers } from './index'
import * as repo from '../db/repo'
import * as world from '../world'
import { asOfStops, entryAsOf } from '../memory/asOf'
import { emit } from '../events'

type ViewsMethods = 'setEntryImage' | 'listAsOfStops' | 'getEntryAsOf'

export const viewsHandlers: Handlers<ViewsMethods> = {
  setEntryImage: (entryId, image) => {
    const db = world.db()
    const entry = repo.setEntryImage(db, entryId, image ? { bytes: image.bytes, type: image.type } : null)
    repo.touchWorld(db)
    // Every list, card and map showing it picks the new picture up.
    emit('memory:changed', { sceneId: null, entryIds: [entryId] })
    return entry
  },
  listAsOfStops: (storyId, entryId) => asOfStops(world.db(), storyId, entryId),
  getEntryAsOf: (entryId, at) => entryAsOf(world.db(), entryId, at)
}
