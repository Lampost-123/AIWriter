import { useCallback, useEffect, useRef, useState } from 'react'
import { useApp } from '@/lib/store'

export interface EntryData<T> {
  /** Null until first loaded. Kept on screen while a reload is on its way, and after a reload fails. */
  data: T | null
  /** Plain-words message when loading failed and there is nothing to show. */
  error: string | null
  reload(): void
  /** Shows a local change straight away, before the next load. */
  update(fn: (data: T) => T): void
}

/**
 * Something an entry page loads about its entry (its changes, where it first exists, the words its
 * facts came from). Reloads whenever the world's entries change (entriesRev, which also moves when
 * the memory keeper changes something), and only shows the newest answer. With `reloadOn`, it
 * reloads whenever that changes instead (for what an ordinary save of the entry can't change).
 */
export function useEntryData<T>(load: () => Promise<T>, key: string, enabled = true, reloadOn?: string | number): EntryData<T> {
  const entriesRev = useApp((s) => (reloadOn === undefined ? s.entriesRev : 0))
  const rev = reloadOn ?? entriesRev
  const [state, setState] = useState<{ key: string; data: T | null; error: string | null }>({ key, data: null, error: null })
  const loadRef = useRef(load)
  loadRef.current = load
  const seq = useRef(0)

  const run = useCallback(() => {
    const ticket = ++seq.current
    loadRef
      .current()
      .then((data) => {
        if (ticket === seq.current) setState({ key, data, error: null })
      })
      .catch((e: Error) => {
        if (ticket !== seq.current) return
        setState((s) => (s.key === key && s.data !== null ? s : { key, data: null, error: e.message || 'Something went wrong.' }))
      })
  }, [key])

  useEffect(() => {
    if (enabled) run()
  }, [run, rev, enabled])

  const update = useCallback((fn: (data: T) => T) => {
    // A load already on its way predates this change; let the next one win.
    seq.current++
    setState((s) => (s.data === null ? s : { ...s, data: fn(s.data) }))
  }, [])

  const current = state.key === key ? state : { data: null, error: null }
  return { data: current.data, error: current.error, reload: run, update }
}
