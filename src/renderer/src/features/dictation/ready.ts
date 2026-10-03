// Whether dictation can be used now (milestone 4): the speech engine's own status (dictationReady, from
// getSpeechStatus and its 'speech:status' events), kept for the life of the window from the moment it
// starts, so a microphone button shows at once rather than popping in a moment later.
import { useEffect } from 'react'
import { create } from 'zustand'
import type { SpeechStatus } from '@shared/contracts/speech'
import { api, onEvent } from '@/lib/api'

const useStatus = create<{ status: SpeechStatus | null }>(() => ({ status: null }))

let watching = false

/** Starts keeping the speech engine's status, once. */
export function watchSpeechStatus(): void {
  if (watching || typeof window === 'undefined' || !window.aiwrite) return
  watching = true
  onEvent('speech:status', (status) => useStatus.setState({ status }))
  api
    .getSpeechStatus()
    // An event that came in meanwhile is newer.
    .then((status) => !useStatus.getState().status && useStatus.setState({ status }))
    .catch(() => undefined)
}

watchSpeechStatus()

/** True when dictation can be used now; null until the speech engine's status is known. */
export function useDictationReady(): boolean | null {
  useEffect(watchSpeechStatus, [])
  return useStatus((s) => (s.status ? s.status.dictationReady : null))
}

/** True when dictation can be used now. */
export const dictationReady = (): boolean => !!useStatus.getState().status?.dictationReady

/** The speech engine's status, kept for the life of the window (null until known). */
export const useSpeechEngine = (): SpeechStatus | null => useStatus((s) => s.status)

/** Why dictation can't be used now, in plain words with where to fix it. */
export function notReadyMessage(status: SpeechStatus | null): string {
  if (status?.server === 'starting') return 'The speech engine is still starting. Dictation can be used as soon as it is ready.'
  if (status?.server === 'connected')
    return "Dictation isn't set up yet: pick a dictation model (Parakeet or Whisper) in Settings › Read aloud and dictation."
  return "Dictation can't be used yet: the speech engine isn't running. Start it in Settings › Read aloud and dictation."
}

/** Why dictation can't be used now, from the status known now. */
export const notReadyNow = (): string => notReadyMessage(useStatus.getState().status)
