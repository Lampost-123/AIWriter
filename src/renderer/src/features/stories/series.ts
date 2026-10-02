// The world's series, for the New story dialog and story settings. Reloaded when the world changes and
// after a series is made or renamed; the last list stays on screen meanwhile.
import { useEffect } from 'react'
import { create } from 'zustand'
import type { Series } from '@shared/types'
import { api } from '@/lib/api'
import { useApp } from '@/lib/store'

interface SeriesState {
  series: Series[] | null
  load(): Promise<void>
}

let latest = 0

export const useSeries = create<SeriesState>((set) => ({
  series: null,
  async load() {
    const ticket = ++latest
    try {
      const series = await api.listSeries()
      if (ticket === latest) set({ series })
    } catch {
      // Kept as it was; the next change to the stories tries again.
    }
  }
}))

/** The series list, loading it when the world (or its stories) change. */
export function useSeriesList(): Series[] | null {
  const worldId = useApp((s) => s.world?.id ?? null)
  const stories = useApp((s) => s.stories)
  useEffect(() => {
    if (worldId) void useSeries.getState().load()
    else useSeries.setState({ series: null })
  }, [worldId, stories])
  return useSeries((s) => s.series)
}
