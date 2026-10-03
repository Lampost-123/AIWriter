// Loading for the Consistency page without flashes.
import { useCallback, useEffect, useRef, useState } from 'react'
import { plainReason } from '@/lib/reason'

export interface Loaded<T> {
  data: T | null
  error: string | null
  retry: () => void
}

/**
 * Loads something for the Consistency page, and again whenever `deps` change. The last answer stays on
 * screen while the next one loads, so nothing flickers; nothing is asked until `enabled` (a tab not
 * opened yet waits). `initial`: an answer kept from before, shown at once and refreshed quietly.
 */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[], enabled = true, initial: T | null = null): Loaded<T> {
  const [state, setState] = useState<{ data: T | null; error: string | null }>({ data: initial, error: null })
  const [attempt, setAttempt] = useState(0)
  const ticket = useRef(0)
  const loader = useRef(load)
  loader.current = load
  useEffect(() => {
    if (!enabled) return
    const mine = ++ticket.current
    loader
      .current()
      .then((data) => mine === ticket.current && setState({ data, error: null }))
      .catch((e: unknown) => mine === ticket.current && setState((s) => ({ ...s, error: plainReason(e) })))
    // `deps` are the caller's: whatever the answer depends on.
  }, [enabled, attempt, ...deps])
  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  return { ...state, retry }
}
