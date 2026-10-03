// The start screen's handlers for src/shared/contracts/library.ts (the Start screen part). Placeholder until built.
import type { Handlers } from './index'
import type { LibraryApi } from '@shared/contracts/library'
import { UserError } from '../util'

const notYet = (): never => {
  throw new UserError('Not ready yet.')
}

export const libraryHandlers: Handlers<keyof LibraryApi> = {
  getLibrary: notYet,
  startScreenAtLaunch: () => false,
  renameWorldIn: notYet,
  renameStoryIn: notYet,
  deleteWorld: notYet,
  restoreWorld: notYet,
  emptyDeletedWorlds: notYet
}
