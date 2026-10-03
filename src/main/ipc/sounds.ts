// AI sound effects under Read aloud: the handlers for src/shared/contracts/sounds.ts. The work is done in
// src/main/sounds/.
import type { Handlers } from './index'
import type { SoundsApi } from '@shared/contracts/sounds'
import { UserError } from '../util'

const notYet = (): never => {
  throw new UserError('Sound effects are still being built.')
}

export const soundsHandlers: Handlers<keyof SoundsApi> = {
  getSoundsStatus: notYet,
  getSceneSounds: notYet,
  markSceneSounds: notYet,
  editSoundCue: notYet,
  restoreSoundEdits: notYet,
  soundAudio: notYet,
  makeSoundNow: notYet,
  soundCueTimes: notYet,
  listSoundLibrary: notYet,
  clearSoundLibrary: notYet,
  undoClearSoundLibrary: notYet
}
