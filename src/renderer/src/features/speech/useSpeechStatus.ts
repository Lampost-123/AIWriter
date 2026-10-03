// The speech server's status, kept up to date (milestone 4). Owned by the Speech engine part.
//
// One copy for the whole window: asked for as the window opens (so Settings has it before it shows, and
// nothing jumps as it arrives), kept current by the 'speech:status' events, and asked again every few
// seconds while Settings shows (what the server holds in memory changes as models are let go). A download
// that finishes says so in a toast, wherever Adam is by then.
import { useEffect } from 'react'
import { create } from 'zustand'
import type { SpeechDownloadKind, SpeechStatus } from '@shared/contracts/speech'
import { toast } from '@/components/ui'
import { api, onEvent } from '@/lib/api'

const useStore = create<{ status: SpeechStatus | null }>(() => ({ status: null }))

const DONE: Record<SpeechDownloadKind, string> = {
  server: 'The speech engine is downloaded.',
  voices: 'The voices are downloaded.',
  parakeet: 'Parakeet is downloaded.',
  whisper: 'Whisper is downloaded.',
  sounds: 'The sound effects are downloaded.'
}

/** Keeps the newest status, and says when a download has just finished. */
function keep(status: SpeechStatus): void {
  const before = useStore.getState().status?.download
  const now = status.download
  if (before?.state === 'running') {
    // Done, or done and the next one already running (a failure or Cancel stops the ones waiting).
    if (now?.kind === before.kind && now.state === 'done') toast(DONE[now.kind], { tone: 'success' })
    else if (now && now.kind !== before.kind && now.state === 'running') toast(DONE[before.kind], { tone: 'success' })
  }
  useStore.setState({ status })
}

/** Counts the events heard, so an answer asked for before the latest event never replaces it. */
let heard = 0
let listening = false

function listen(): void {
  if (listening || typeof window === 'undefined' || !window.aiwrite) return
  listening = true
  onEvent('speech:status', (status) => {
    heard++
    keep(status)
  })
}

/** Keeps a status an action answered with (Check, a download started...). */
export function setSpeechStatus(status: SpeechStatus): void {
  heard++
  keep(status)
}

/** Asks the main process for the status now. */
export async function loadSpeechStatus(): Promise<void> {
  const before = heard
  const status = await api.getSpeechStatus()
  if (heard === before) keep(status)
}

/** The speech engine's status; null until it is known. `poll` asks again every few seconds while the window shows. */
export function useSpeechStatus(opts: { poll?: boolean } = {}): SpeechStatus | null {
  const poll = !!opts.poll
  useEffect(() => {
    listen()
    void loadSpeechStatus().catch(() => undefined)
    if (!poll) return
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void loadSpeechStatus().catch(() => undefined)
    }, 5000)
    return () => clearInterval(timer)
  }, [poll])
  return useStore((s) => s.status)
}

/** The status as known now, without asking again: for the parts of Settings inside the speech engine's own. */
export function useKnownSpeechStatus(): SpeechStatus | null {
  return useStore((s) => s.status)
}

// As the window opens (Settings imports this): the main process answers at once from what it knows.
if (typeof window !== 'undefined' && window.aiwrite) {
  listen()
  void loadSpeechStatus().catch(() => undefined)
}
