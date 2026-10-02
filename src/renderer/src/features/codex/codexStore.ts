// What the codex remembers while Adam goes back and forth between it and entry pages: its filters,
// sort and place, and whether the entry page on screen was opened from it (for "Back to the codex").
// Kept here rather than in the app store, and forgotten when another world opens.

import { create } from 'zustand'
import type { EntryKind, ID } from '@shared/types'
import { useApp } from '@/lib/store'
import { NO_FILTERS, type CodexFilters, type CodexSort } from './codexLogic'

/** A card that was on screen when Adam left the codex, and how far below the top of its view. */
export interface CodexAnchor {
  id: ID
  top: number
  /** The card he opened (it gets the keyboard's place back), rather than the first one in view. */
  opened: boolean
}

interface CodexState {
  filters: CodexFilters
  sort: CodexSort
  /** Where the codex was scrolled to when Adam left it. */
  scroll: number
  /**
   * The card the codex is put back around when it shows again. Cards not drawn yet are counted at
   * a guessed height, so the scroll position alone can land several rows away from where Adam was.
   */
  anchor: CodexAnchor | null
  /** The kind of entry page opened from the codex, while Adam is still on it; null otherwise. */
  backTo: EntryKind | null
  setFilters(patch: Partial<CodexFilters>): void
  setSort(sort: CodexSort): void
}

export const useCodex = create<CodexState>((set) => ({
  filters: NO_FILTERS,
  sort: 'name',
  scroll: 0,
  anchor: null,
  backTo: null,
  setFilters: (patch) => set((s) => ({ filters: { ...s.filters, ...patch } })),
  setSort: (sort) => set({ sort })
}))

/** Opens an entry's page from the codex, so the page offers the way back. */
export function openFromCodex(e: { id: string; kind: EntryKind }, place: { scroll: number; top: number | null }): void {
  const anchor = place.top === null ? null : { id: e.id, top: place.top, opened: true }
  useCodex.setState({ backTo: e.kind, scroll: place.scroll, anchor })
  useApp.getState().navigate({ kind: 'entries', entryKind: e.kind, entryId: e.id })
}

// The way back lasts while Adam stays on that kind's pages (moving between its entries, or into the
// builder and back); going anywhere else forgets it. Another world starts with a fresh codex.
useApp.subscribe((s, prev) => {
  if (s.world?.id !== prev.world?.id) {
    useCodex.setState({ filters: NO_FILTERS, sort: 'name', scroll: 0, anchor: null, backTo: null })
    return
  }
  const back = useCodex.getState().backTo
  if (!back || s.view === prev.view) return
  const v = s.view
  const stays = v.kind === 'codex' || v.kind === 'builder' || (v.kind === 'entries' && v.entryKind === back)
  if (!stays || v.kind === 'codex') useCodex.setState({ backTo: null })
})
