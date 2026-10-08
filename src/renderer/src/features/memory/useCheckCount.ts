import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { useApp } from '@/lib/store'

/** How long after the memory changes the count is read again (several changes in a row read it once). */
const SETTLE_MS = 400

/**
 * How many things the memory isn't sure about (World Memory Overhaul B3), for the count beside "What changed"; null
 * while not known or when there are none, so nothing shows then.
 */
export function useCheckCount(): number | null {
  const worldId = useApp((s) => s.world?.id ?? null)
  const memoryRev = useApp((s) => s.memoryRev)
  const entriesRev = useApp((s) => s.entriesRev)
  const [count, setCount] = useState<number | null>(null)
  useEffect(() => {
    if (!worldId) {
      setCount(null)
      return
    }
    let live = true
    const t = setTimeout(() => {
      api
        .listMemoryChecks()
        .then((list) => live && setCount(list.length || null))
        .catch(() => undefined)
    }, SETTLE_MS)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [worldId, memoryRev, entriesRev])
  return count
}
