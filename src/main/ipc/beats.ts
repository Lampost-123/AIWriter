// Milestone 4: the handlers for src/shared/contracts/beats.ts (one part owns both files). See
// docs/ARCHITECTURE.md, "Milestone 4". The work is done in src/main/beats/; this connects it to the
// window, and keeps a beat from starting while Generate is getting a draft of the same scene ready.
import type { Handlers } from './index'
import type { BeatsApi } from '@shared/contracts/beats'
import { emit } from '../events'
import { cancelBeatStart, startBeat } from '../beats'
import { isStartingDraft } from './ai'

export const beatsHandlers: Handlers<keyof BeatsApi> = {
  startBeat: (input) => startBeat(input, { emit, otherStarting: isStartingDraft }),
  cancelBeatStart: (sceneId) => cancelBeatStart(sceneId)
}
