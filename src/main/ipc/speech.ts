// Milestone 4: the handlers for src/shared/contracts/speech.ts (the Speech engine part owns both files).
// The work is done in src/main/speech/*; this file connects it to the settings and the window.
import type { Handlers } from './index'
import type { SpeechApi } from '@shared/contracts/speech'

export const speechHandlers: Handlers<keyof SpeechApi> = {
  // Groundwork stand-in until the Speech engine part runs the server: nothing is running.
  getSpeechStatus: () => ({ server: 'not-running', voicesReady: false, dictationReady: false })
}
