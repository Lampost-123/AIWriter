// Accepting scenes and the memory keeper (milestone 2). The work is done in src/main/keeper/*;
// this file connects it to the open world and the window.
import type { Handlers } from './index'

type KeeperMethods = 'acceptScene' | 'reopenScene' | 'getMemoryStatus' | 'listMemoryLog' | 'undoMemoryItem' | 'updateMemoryNow'

const notYet = (): never => {
  throw new Error('Not built yet')
}

export const keeperHandlers: Handlers<KeeperMethods> = {
  acceptScene: notYet,
  reopenScene: notYet,
  getMemoryStatus: notYet,
  listMemoryLog: notYet,
  undoMemoryItem: notYet,
  updateMemoryNow: notYet
}
