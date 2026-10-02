// What the codex remembers while Adam goes back and forth between it and entry pages: its filters,
// sort and scroll position, and whether the entry page on screen was opened from it (for "Back to
// the codex"). Kept here rather than in the app store, and forgotten when another world opens.

import { create } from 'zustand'
import type { EntryKind } from '@shared/types'
import { useApp } from '@/lib/store'
import { NO_FILTERS, type CodexFilters, type CodexSort } from './codexLogic'

interface CodexState {
  filters: CodexFilters
  sort: CodexSort
  /** Where the codex was scrolled to when Adam left it. */
  scroll: number
  /** The kind of entry page opened from the codex, while Adam is still on it; null otherwise. */
  backTo: EntryKind | null
  setFilters(patch: Partial<CodexFilters>): void
  setSort(sort: CodexSort): void
}

export const useCodex = create<CodexState>((set) => ({
  filters: NO_FILTERS,
  sort: 'name',
  scroll: 0,
  backTo: null,
  setFilters: (patch) => set((s) => ({ filters: { ...s.filters, ...patch } })),
  setSort: (sort) => set({ sort })
}))

/** Opens an entry's page from the codex, so the page offers the way back. */
export function openFromCodex(e: { id: string; kind: EntryKind }, scroll: number): void {
  useCodex.setState({ backTo: e.kind, scroll })
  useApp.getState().navigate({ kind: 'entries', entryKind: e.kind, entryId: e.id })
}

// The way back lasts while Adam stays on that kind's pages (moving between its entries, or into the
// builder and back); going anywhere else forgets it. Another world starts with a fresh codex.
useApp.subscribe((s, prev) => {
  if (s.world?.id !== prev.world?.id) {
    useCodex.setState({ filters: NO_FILTERS, sort: 'name', scroll: 0, backTo: null })
    return
  }
  const back = useCodex.getState().backTo
  if (!back || s.view === prev.view) return
  const v = s.view
  const stays = v.kind === 'codex' || v.kind === 'builder' || (v.kind === 'entries' && v.entryKind === back)
  if (!stays || v.kind === 'codex') useCodex.setState({ backTo: null })
})
