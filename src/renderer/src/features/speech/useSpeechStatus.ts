// The speech server's status, kept up to date (milestone 4). Owned by the Speech engine part.
import { useEffect, useState } from 'react'
import type { SpeechStatus } from '@shared/contracts/speech'
import { api, onEvent } from '@/lib/api'

export function useSpeechStatus(): SpeechStatus | null {
  const [status, setStatus] = useState<SpeechStatus | null>(null)
  useEffect(() => {
    let live = true
    api
      .getSpeechStatus()
      .then((s) => live && setStatus(s))
      .catch(() => undefined)
    const off = onEvent('speech:status', (s) => setStatus(s))
    return () => {
      live = false
      off()
    }
  }, [])
  return status
}
