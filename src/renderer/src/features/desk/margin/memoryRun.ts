// The memory's latest run on the open scene, for the desk's margin note (UI overhaul, phase 3): when the memory says it
// changed something for this scene ('memory:changed'), its log for the scene is read and the newest run's lines are
// kept for 15 seconds (or until another scene opens). Lines that failed or were undone don't count.
import { useEffect, useState } from 'react'
import type { ID, MemoryLogItem } from '@shared/types'
import { api, onEvent } from '@/lib/api'

/** How long the note stays. */
export const MEMORY_NOTE_MS = 15_000

export interface MemoryRun {
  runId: ID
  count: number
  /** Its lines in plain words, newest run only. */
  lines: string[]
  /** The words in the scene each line came from, in the same order. */
  quotes: string[]
}

/** The newest run's lines in a scene's log (newest first or not), as the note shows them; null when it changed nothing. */
export function latestRun(items: readonly MemoryLogItem[]): MemoryRun | null {
  const live = items.filter((i) => !i.undone && i.action !== 'failed')
  if (!live.length) return null
  const newest = live.reduce((a, b) => (b.createdAt > a.createdAt ? b : a))
  const run = live.filter((i) => i.runId === newest.runId)
  return {
    runId: newest.runId,
    count: run.length,
    lines: run.map((i) => (i.entryName && i.what !== 'scene' && i.what !== 'summary' ? `${i.entryName}: ${i.text}` : i.text)),
    quotes: run.map((i) => i.quote)
  }
}

/** The memory's latest run on this scene while it is new (null otherwise). */
export function useMemoryRun(sceneId: ID): MemoryRun | null {
  const [run, setRun] = useState<{ sceneId: ID; run: MemoryRun } | null>(null)
  useEffect(() => {
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = onEvent('memory:changed', (change) => {
      if (change.sceneId !== sceneId) return
      api
        .listMemoryLog({ sceneId, limit: 20 })
        .then((items) => {
          if (!live) return
          const latest = latestRun(items)
          if (!latest) return
          setRun({ sceneId, run: latest })
          clearTimeout(timer)
          timer = setTimeout(() => live && setRun(null), MEMORY_NOTE_MS)
        })
        .catch(() => undefined)
    })
    return () => {
      live = false
      off()
      clearTimeout(timer)
      setRun(null)
    }
  }, [sceneId])
  return run && run.sceneId === sceneId ? run.run : null
}
