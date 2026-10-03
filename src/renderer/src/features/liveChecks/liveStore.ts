// What the live checks found in the open scene, for the Issues tab's counts (liveFlags.ts). Set by the
// page after each check; nothing here re-renders while Adam types.
import { create } from 'zustand'
import type { ID } from '@shared/types'
import type { LiveFlagKind } from '@shared/liveChecks'

export type LiveCounts = Record<LiveFlagKind, number>

export const NO_FLAGS: LiveCounts = { phrase: 0, repetition: 0, spelling: 0, ai: 0 }

interface LiveStore {
  sceneId: ID | null
  counts: LiveCounts
}

export const useLiveStore = create<LiveStore>(() => ({ sceneId: null, counts: NO_FLAGS }))

/** The page's latest counts (only stored when they differ, so the store moves rarely). */
export function setLiveCounts(sceneId: ID | null, counts: LiveCounts): void {
  const cur = useLiveStore.getState()
  const same = (Object.keys(NO_FLAGS) as (keyof LiveCounts)[]).every((k) => cur.counts[k] === counts[k])
  if (cur.sceneId === sceneId && same) return
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

// A draft (Generate, Beat by beat, a picked version) has landed and been checked: how many of Adam's phrases to
// avoid and common AI phrases are underlined in it. The page's layer says so in a quiet toast.
/** How many of each a draft brought. */
export interface DraftCounts {
  phrase: number
  ai: number
}

/** The first one a draft brought (a phrase to avoid before a common AI phrase): its kind, key, and where it was when counted. */
export interface DraftFirst {
  kind: 'phrase' | 'ai'
  key: string
  from: number
}

const draftListeners = new Set<(counts: DraftCounts, first: DraftFirst) => void>()

export function noteDraftPhrases(counts: DraftCounts, first: DraftFirst): void {
  draftListeners.forEach((l) => l(counts, first))
}

export function onDraftPhrases(fn: (counts: DraftCounts, first: DraftFirst) => void): () => void {
  draftListeners.add(fn)
  return () => draftListeners.delete(fn)
}
