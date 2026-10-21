// Something a screen reads from the main process, again whenever `deps` change (review #18, 2026-10-21): the last value
// stays while the next loads (nothing flashes away), `failed` says the latest read didn't work, and `retry` reads again.
// Screens show a quiet "Couldn't load. Try again" line where the part would be (LoadFailed), rather than nothing.
import { useCallback, useEffect, useState } from 'react'

export interface Loaded<T> {
  /** The latest value read; null until one arrives. */
  value: T | null
  /** The latest read failed (a value from before may still show). */
  failed: boolean
  /** Reads it again. */
  retry: () => void
}

/** `load` returns null when there is nothing to read yet (no story open, say). */
export function useLoaded<T>(load: () => Promise<T> | null, deps: unknown[]): Loaded<T> {
  const [value, setValue] = useState<T | null>(null)
  const [failed, setFailed] = useState(false)
  const [tries, setTries] = useState(0)
  const key = JSON.stringify(deps)
  useEffect(() => {
    let live = true
    const p = load()
    if (!p) return
    p.then(
      (v) => {
        if (!live) return
        setValue(v)
        setFailed(false)
      },
      (e: unknown) => {
        if (!live) return
        console.warn('Could not load part of the page', e)
        setFailed(true)
      }
    )
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tries])
  const retry = useCallback(() => setTries((n) => n + 1), [])
  return { value, failed, retry }
}

/** The quiet line shown where a part that failed to load would be. */
export function LoadFailed({ onRetry, className }: { onRetry: () => void; className?: string }): React.JSX.Element {
  return (
    <p className={`text-[12.5px] text-muted ${className ?? ''}`} role="status">
      Couldn’t load.{' '}
      <button type="button" className="font-medium text-accent hover:underline" onClick={onRetry}>
        Try again
      </button>
    </p>
  )
}
