// The voices the speech server offers (Breeze's own and Adam's clips), shared by Settings and the character
// pages, and asked for again whenever the speech engine's status changes (started, a download finished).
import { useEffect } from 'react'
import { create } from 'zustand'
import type { ReadAloudVoice } from '@shared/contracts/readAloud'
import { api, ApiError } from '@/lib/api'
import { useSpeechStatus } from '@/features/speech/useSpeechStatus'

interface VoicesState {
  /** Null until the server has answered once. */
  voices: ReadAloudVoice[] | null
  /** Why the list couldn't be had, in plain words; `code` 'speech-not-running' or 'voices-not-ready' when the fix is setting up the speech engine. */
  error: { message: string; code: string | undefined; engine: boolean } | null
  loading: boolean
}

const useVoicesState = create<VoicesState>(() => ({ voices: null, error: null, loading: false }))

let asking: Promise<void> | null = null

/** Asks the speech server for its voices (once at a time). */
export function loadVoices(): Promise<void> {
  asking ??= (async () => {
    useVoicesState.setState({ loading: true })
    try {
      const voices = await api.listReadAloudVoices()
      useVoicesState.setState({ voices, error: null, loading: false })
    } catch (e) {
      const code = e instanceof ApiError ? e.code : undefined
      useVoicesState.setState({
        error: {
          message: e instanceof Error && e.message ? e.message : "The voices couldn't be listed. Try again.",
          code,
          engine: code === 'speech-not-running' || code === 'voices-not-ready'
        },
        loading: false
      })
    }
  })().finally(() => {
    asking = null
  })
  return asking
}

/** The voice list, kept up to date while `enabled`. */
export function useVoices(enabled: boolean): VoicesState & { reload: () => void } {
  const state = useVoicesState()
  const status = useSpeechStatus()
  const key = status ? `${status.server}:${status.voicesReady}` : ''
  useEffect(() => {
    if (enabled) void loadVoices()
  }, [enabled, key])
  return { ...state, reload: () => void loadVoices() }
}
