// What the live checks found in the open scene, for the Issues tab's counts (liveFlags.ts). Set by the
// page after each check; nothing here re-renders while Adam types.
import { create } from 'zustand'
import type { ID } from '@shared/types'
import type { LiveKind } from '@shared/liveChecks'

export type LiveCounts = Record<LiveKind, number>

export const NO_FLAGS: LiveCounts = { phrase: 0, repetition: 0, spelling: 0 }

interface LiveStore {
  sceneId: ID | null
  counts: LiveCounts
}

export const useLiveStore = create<LiveStore>(() => ({ sceneId: null, counts: NO_FLAGS }))

/** The page's latest counts (only stored when they differ, so the store moves rarely). */
export function setLiveCounts(sceneId: ID | null, counts: LiveCounts): void {
  const cur = useLiveStore.getState()
  if (cur.sceneId === sceneId && cur.counts.phrase === counts.phrase && cur.counts.repetition === counts.repetition && cur.counts.spelling === counts.spelling)
    return
  useLiveStore.setState({ sceneId, counts })
}

// Showing the card for a flag from elsewhere (revealLiveFlag): the page's layer listens.
const cardListeners = new Set<(pos: number) => void>()

export function requestLiveCard(pos: number): void {
  cardListeners.forEach((l) => l(pos))
}

export function onLiveCardRequest(fn: (pos: number) => void): () => void {
  cardListeners.add(fn)
  return () => cardListeners.delete(fn)
}
