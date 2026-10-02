// The open story's outline (chapters and scenes), shared by the binder and the
// scene header. Reloads when the story changes or store.outlineRev is bumped.
// The previous outline stays visible while the next one loads, so nothing flashes.

import { useEffect } from 'react'
import { create } from 'zustand'
import type { ID, Outline } from '@shared/types'
import { api } from '@/lib/api'
import { useApp } from '@/lib/store'

interface OutlineState {
  outline: Outline | null
  /** Plain-words message when the last load failed. */
  error: string | null
  /** The story + revision the outline was last requested for. */
  key: string | null
  load(storyId: ID, rev: number, force?: boolean): Promise<void>
  /** Optimistic change shown until the next reload. */
  patch(fn: (o: Outline) => Outline): void
  reset(): void
}

let latest = 0

export const useOutlineStore = create<OutlineState>((set, get) => ({
  outline: null,
  error: null,
  key: null,

  async load(storyId, rev, force) {
    const key = `${storyId}:${rev}`
    if (!force && get().key === key) return
    // An earlier failure (perhaps of another story) shouldn't show while this one loads.
    set({ key, error: null })
    const ticket = ++latest
    try {
      const outline = await api.getOutline(storyId)
      if (ticket === latest) set({ outline, error: null })
    } catch (e) {
      if (ticket === latest) set({ error: (e as Error).message, key: null })
    }
  },

  patch(fn) {
    const o = get().outline
    if (!o) return
    // A load already on its way predates this change; let the next one (after the bump) win.
    latest++
    set({ outline: fn(o) })
  },

  reset() {
    latest++
    set({ outline: null, error: null, key: null })
  }
}))

/** Keeps the outline in step with the open story. Safe to use in several components. */
export function useOutline(): { outline: Outline | null; error: string | null; retry: () => void } {
  const storyId = useApp((s) => s.storyId)
  const rev = useApp((s) => s.outlineRev)
  const worldId = useApp((s) => s.world?.id ?? null)
  const outline = useOutlineStore((s) => s.outline)
  const error = useOutlineStore((s) => s.error)

  useEffect(() => {
    if (storyId) void useOutlineStore.getState().load(storyId, rev)
    else useOutlineStore.getState().reset()
  }, [storyId, rev, worldId])

  // Only hand out an outline that belongs to the open story.
  const current = outline && outline.story.id === storyId ? outline : null
  return {
    outline: current,
    error,
    retry: () => {
      if (storyId) void useOutlineStore.getState().load(storyId, rev, true)
    }
  }
}
