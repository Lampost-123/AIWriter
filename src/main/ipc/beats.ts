// Milestone 4: the handlers for src/shared/contracts/beats.ts (one part owns both files). See
// docs/ARCHITECTURE.md, "Milestone 4". The work is done in src/main/beats/; this connects it to the
// window, and keeps a beat from starting while Generate is getting a draft of the same scene ready.
import type { Handlers } from './index'
import type { BeatsApi } from '@shared/contracts/beats'
import { emit } from '../events'
import { cancelBeatStart, startBeat } from '../beats'
import { getBeatMarks, saveBeatMarks } from '../beats/marks'
import { VARIANTS_WRITING, variantsBusy } from '../variants'
import { UserError } from '../util'
import * as world from '../world'
import { isStartingDraft } from './ai'

export const beatsHandlers: Handlers<keyof BeatsApi> = {
  startBeat: (input) => {
    // The scene's variants (getting ready, or being written) have it for now, as for Generate.
    if (variantsBusy(input.sceneId)) throw new UserError(VARIANTS_WRITING, 'busy')
    return startBeat(input, { emit, otherStarting: isStartingDraft })
  },
  cancelBeatStart: (sceneId) => cancelBeatStart(sceneId),
  getBeatMarks: (sceneId) => getBeatMarks(world.db(), sceneId),
  saveBeatMarks: (sceneId, marks) => saveBeatMarks(world.db(), sceneId, marks)
}
