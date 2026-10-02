// Milestone 3: the handlers for src/shared/contracts/entryViews.ts (one part owns both files).
// The work is done in src/main/entryViews/* and src/main/db/entryViews.ts.
import type { Handlers } from './index'
import type { EntryViewsApi } from '@shared/contracts/entryViews'
import type { ID } from '@shared/types'
import * as repo from '../db/repo'
import * as world from '../world'
import { emit } from '../events'
import { appearancesOf } from '../entryViews/appearances'
import { codexCards } from '../entryViews/codex'
import { listFirstExists, setFirstExists } from '../entryViews/firstExists'
import { keepEditFromStory } from '../entryViews/keepEdit'

/** Wraps a write so the world's "last changed" time moves (backups watch it). */
function write<T>(fn: () => T): T {
  const db = world.db()
  const result = db.transaction(fn)()
  repo.touchWorld(db)
  return result
}

/** Every view of the memory reloads: what exists where (or an entry's profile) changed. */
const changed = (entryIds: ID[]): void => emit('memory:changed', { sceneId: null, entryIds })

export const entryViewsHandlers: Handlers<keyof EntryViewsApi> = {
  listCodex: () => codexCards(world.db()),
  listAppearances: (entryId) => {
    const db = world.db()
    return appearancesOf(db, repo.getEntry(db, entryId), repo.listEntries(db))
  },
  listFirstExists: (entryId) => listFirstExists(world.db(), entryId),
  setFirstExists: (entryId, points) => {
    const result = write(() => setFirstExists(world.db(), entryId, points))
    changed([entryId])
    return result
  },
  keepEditFromStory: (entryId, storyId, before) => {
    const result = write(() => keepEditFromStory(world.db(), entryId, storyId, before))
    changed([entryId])
    return result
  }
}
