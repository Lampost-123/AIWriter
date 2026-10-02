// The grey line on each story's card ("Side story during Book 2, after Ch 5"), kept for the story menu
// so it opens with every line already there. Reloads when the stories, their chapters or what they
// know change; the last lines stay meanwhile.
import { useEffect } from 'react'
import { create } from 'zustand'
import type { ID } from '@shared/types'
import { api } from '@/lib/api'
import { useApp } from '@/lib/store'

interface LabelState {
  labels: Record<ID, string>
  load(): Promise<void>
}

let latest = 0

export const useStoryLabels = create<LabelState>((set) => ({
  labels: {},
  async load() {
    const ticket = ++latest
    try {
      const labels = await api.listStoryLabels()
      if (ticket === latest) set({ labels })
    } catch {
      // Not shown this time: the menu still lists every story.
    }
  }
}))

/** Keeps the lines in step with the open world. */
export function useStoryLabelsLoader(): void {
  const stories = useApp((s) => s.stories)
  const outlineRev = useApp((s) => s.outlineRev)
  const memoryRev = useApp((s) => s.memoryRev)
  const worldId = useApp((s) => s.world?.id ?? null)
  useEffect(() => {
    if (worldId) void useStoryLabels.getState().load()
    else useStoryLabels.setState({ labels: {} })
  }, [stories, outlineRev, memoryRev, worldId])
}
