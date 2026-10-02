// Memory over time, summaries and briefing choices (milestone 2). The work is done in
// src/main/memory/* and src/main/db/memory.ts; this file connects it to the open world.
import type { Handlers } from './index'

type MemoryMethods =
  | 'setStoryPlacement'
  | 'listChanges' | 'createChange' | 'updateChange' | 'deleteChange' | 'restoreChange'
  | 'listFacts' | 'listExistsPoints' | 'listSceneChanges'
  | 'getSummary' | 'setSummary' | 'listStorySummaries'
  | 'setPin' | 'setBlockMode'

const notYet = (): never => {
  throw new Error('Not built yet')
}

export const memoryHandlers: Handlers<MemoryMethods> = {
  setStoryPlacement: notYet,
  listChanges: notYet,
  createChange: notYet,
  updateChange: notYet,
  deleteChange: notYet,
  restoreChange: notYet,
  listFacts: notYet,
  listExistsPoints: notYet,
  listSceneChanges: notYet,
  getSummary: notYet,
  setSummary: notYet,
  listStorySummaries: notYet,
  setPin: notYet,
  setBlockMode: notYet
}
