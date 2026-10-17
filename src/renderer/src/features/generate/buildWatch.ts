// Writing during a build (2026-10-17): whether the World builder is building the cast of the story a draft is for, so
// Generate can say "Your cast is still being built" and offer to wait. Follows the World builder's own events, whichever
// page is showing (the World builder page's store follows them only once that page has opened), and asks the main
// process once per world for a build already running.
import { create } from 'zustand'
import type { WorldBuildProgress } from '@shared/contracts/worldBuilder'
import type { ID } from '@shared/types'
import { api, onEvent } from '@/lib/api'
import { useApp } from '@/lib/store'

export interface BuildWatch {
  /** The build running in the open world, if any, and the story it is for (null: the beginning of the world). */
  running: { buildId: ID; storyId: ID | null } | null
}

export const useBuildWatch = create<BuildWatch>(() => ({ running: null }))

/**
 * True when a build running now is making the cast a draft in `storyId` would be told about: that story's own build, or
 * one for the beginning of the world (which every story starts from).
 */
export function castBuilding(running: BuildWatch['running'], storyId: ID | null): boolean {
  return !!running && (running.storyId === null || running.storyId === storyId)
}

const runningOf = (p: Pick<WorldBuildProgress, 'buildId' | 'storyId'> | null): BuildWatch['running'] =>
  p ? { buildId: p.buildId, storyId: p.storyId } : null

let seq = 0
/** Reads the open world's build, if one is running (one started before this window was listening). */
function readRunning(): void {
  const ticket = ++seq
  const worldId = useApp.getState().world?.id ?? null
  if (!worldId) return useBuildWatch.setState({ running: null })
  Promise.resolve()
    .then(() => api.getWorldBuilder())
    .then((st) => {
      if (ticket === seq && useApp.getState().world?.id === worldId) useBuildWatch.setState({ running: runningOf(st.running) })
    })
    .catch(() => undefined)
}

let watching = false
/** Starts following builds, once, for as long as the window is open. */
export function watchBuilds(): void {
  if (watching) return
  watching = true
  onEvent('worldBuilder:progress', (p) => {
    seq++
    useBuildWatch.setState({ running: runningOf(p) })
  })
  onEvent('worldBuilder:done', (d) => {
    seq++
    const r = useBuildWatch.getState().running
    if (!r || r.buildId === d.buildId) useBuildWatch.setState({ running: null })
  })
  useApp.subscribe((a, prev) => {
    if (a.world?.id !== prev.world?.id) readRunning()
  })
  readRunning()
}
