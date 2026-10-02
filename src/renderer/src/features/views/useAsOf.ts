// Loading the memory as of a point, for entry pages, the relationship map, hover cards and the Cast
// tab. The last answer stays on screen while a newer one loads, so sliding never flickers.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AsOf, AsOfStop, EntryAsOf, ID } from '@shared/types'
import { api } from '@/lib/api'
import { useApp } from '@/lib/store'

/** The stops of a story's as-of slider (null until loaded). Reloads when the outline or the memory changes. */
export function useAsOfStops(storyId: ID | null, entryId?: ID | null): AsOfStop[] | null {
  const outlineRev = useApp((s) => s.outlineRev)
  const memoryRev = useApp((s) => s.memoryRev)
  const entriesRev = useApp((s) => s.entriesRev)
  const [stops, setStops] = useState<AsOfStop[] | null>(null)
  useEffect(() => {
    if (!storyId) return setStops(null)
    let live = true
    api
      .listAsOfStops(storyId, entryId ?? null)
      .then((s) => live && setStops(s))
      .catch(() => live && setStops([]))
    return () => {
      live = false
    }
  }, [storyId, entryId, outlineRev, memoryRev, entriesRev])
  return stops
}

/** An entry as of a point (null until first loaded, or when `at` is null). Keeps the last answer while the next loads. */
export function useEntryAsOf(
  entryId: ID | null,
  at: AsOf | null
): { data: EntryAsOf | null; loading: boolean; error: string | null; reload: () => void } {
  const memoryRev = useApp((s) => s.memoryRev)
  const entriesRev = useApp((s) => s.entriesRev)
  const [state, setState] = useState<{ data: EntryAsOf | null; loading: boolean; error: string | null }>({ data: null, loading: false, error: null })
  const [tries, setTries] = useState(0)
  const reload = useCallback(() => setTries((n) => n + 1), [])
  const ticket = useRef(0)
  const key = at ? JSON.stringify(at) : null
  useEffect(() => {
    if (!entryId || !key) return setState({ data: null, loading: false, error: null })
    const mine = ++ticket.current
    setState((s) => ({ ...s, loading: true }))
    // A short pause, so dragging a slider asks only for where it settles.
    const timer = setTimeout(() => {
      api
        .getEntryAsOf(entryId, JSON.parse(key) as AsOf)
        .then((data) => mine === ticket.current && setState({ data, loading: false, error: null }))
        .catch((e: Error) => mine === ticket.current && setState((s) => ({ ...s, loading: false, error: e.message })))
    }, 60)
    return () => clearTimeout(timer)
  }, [entryId, key, memoryRev, entriesRev, tries])
  return { ...state, reload }
}
