// The story cards in the story menu: every story in reading order ("Shelf order is reading order", for
// display only) with its grey line ("Side story during Book 2, after Ch 5"), kept here so the menu opens
// with them already there. Reloads when the stories, their chapters or what they know change; the last
// ones stay meanwhile.
import { useEffect } from 'react'
import { create } from 'zustand'
import type { ID } from '@shared/types'
import { api } from '@/lib/api'
import { useApp } from '@/lib/store'

interface ShelfState {
  /** Story ids in reading order. */
  order: ID[]
  labels: Record<ID, string>
  load(): Promise<void>
}

let latest = 0

export const useStoryLabels = create<ShelfState>((set) => ({
  order: [],
  labels: {},
  async load() {
    const ticket = ++latest
    try {
      const shelf = await api.listShelf()
      if (ticket === latest) set({ order: shelf.order, labels: shelf.labels })
    } catch {
      // Not shown this time: the menu still lists every story.
    }
  }
}))

/** Keeps the shelf in step with the open world. */
export function useStoryLabelsLoader(): void {
  const stories = useApp((s) => s.stories)
  const outlineRev = useApp((s) => s.outlineRev)
  const memoryRev = useApp((s) => s.memoryRev)
  const worldId = useApp((s) => s.world?.id ?? null)
  useEffect(() => {
    if (worldId) void useStoryLabels.getState().load()
    else useStoryLabels.setState({ order: [], labels: {} })
  }, [stories, outlineRev, memoryRev, worldId])
}
