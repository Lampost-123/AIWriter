// Milestone 4: the handlers for src/shared/contracts/dictation.ts (one part owns both files). See
// docs/ARCHITECTURE.md, "Milestone 4". The recording is passed straight to the speech server
// (src/main/dictation/transcribe.ts) and never saved.
import type { Handlers } from './index'
import type { DictationApi } from '@shared/contracts/dictation'
import { transcribe } from '../dictation/transcribe'

/** The recording as bytes, however it crossed from the window. */
function bytesOf(wav: unknown): Uint8Array {
  if (wav instanceof Uint8Array) return wav
  if (wav instanceof ArrayBuffer) return new Uint8Array(wav)
  return new Uint8Array(0)
}

export const dictationHandlers: Handlers<keyof DictationApi> = {
  transcribeDictation: async (wav) => ({ text: await transcribe(bytesOf(wav)) })
}
