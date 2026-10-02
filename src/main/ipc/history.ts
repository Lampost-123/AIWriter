// Milestone 4: the handlers for src/shared/contracts/history.ts (the History part owns both files).
// The work is done in src/main/history/*; this file connects it to the open world and the window.
import type { Handlers } from './index'
import type { HistoryApi } from '@shared/contracts/history'

export const historyHandlers: Handlers<keyof HistoryApi> = {
  // Groundwork stand-in until the History part keeps snapshots in history.db: nothing is kept yet.
  takeSnapshot: () => null
}
