// The start screen's handlers for src/shared/contracts/library.ts (the Start screen part). The logic is in
// src/main/library/ and the SQL in src/main/db/library.ts.
import type { Handlers } from './index'
import type { LibraryApi } from '@shared/contracts/library'
import * as library from '../library'

export const libraryHandlers: Handlers<keyof LibraryApi> = {
  getLibrary: () => library.getLibrary(),
  startScreenAtLaunch: () => library.startScreenAtLaunch(),
  renameWorldIn: (worldId, name) => library.renameWorldIn(worldId, name),
  renameStoryIn: (worldId, storyId, title) => library.renameStoryIn(worldId, storyId, title),
  deleteWorld: (worldId) => library.deleteWorld(worldId),
  restoreWorld: (trashId) => library.restoreWorld(trashId),
  emptyDeletedWorlds: (trashId) => library.emptyDeletedWorlds(trashId)
}
