// Milestone 4: the handlers for src/shared/contracts/readAloud.ts (one part owns both files). See
// docs/ARCHITECTURE.md, "Milestone 4". The work is done in src/main/readAloud/.
import type { Handlers } from './index'
import type { ReadAloudApi } from '@shared/contracts/readAloud'
import { onWorldClosing } from '../world'
import * as readAloud from '../readAloud'

// Closing a world stops its marking (the task runner stops the calls and finishes their records).
onWorldClosing(() => readAloud.readAloudWorldClosing())

export const readAloudHandlers: Handlers<keyof ReadAloudApi> = {
  listReadAloudVoices: () => readAloud.readAloudVoices(),
  planReading: (req) => readAloud.planReading(req),
  stopReadingMarks: (sceneId) => readAloud.stopMarks(sceneId),
  speakClip: (clip) => readAloud.speakClip(clip),
  sampleReading: (req) => readAloud.sampleReading(req),
  warmUpVoices: () => readAloud.warmUpVoices(),
  getEntryReadAloud: (entryId) => readAloud.getEntryVoice(entryId),
  setEntryReadAloud: (entryId, value) => readAloud.setEntryVoice(entryId, value),
  suggestCharacterVoice: (entryId, taskId) => readAloud.suggestCharacterVoice(entryId, taskId),
  getReadAloudCache: () => readAloud.cacheStats(),
  clearReadAloudCache: () => readAloud.clearCache()
}
