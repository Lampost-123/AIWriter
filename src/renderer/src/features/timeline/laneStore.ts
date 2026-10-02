// Which lanes Adam chose on the timeline, per world and per kind of lane, kept while the app is open.
// Until he chooses, the timeline shows the busiest few.
import { create } from 'zustand'
import type { ID } from '@shared/types'
import type { LaneMode } from './timelineLogic'

interface LaneState {
  /** By `${worldId}:${mode}`. */
  chosen: Record<string, ID[]>
  mode: LaneMode
  choose: (key: string, ids: ID[] | null) => void
  setMode: (mode: LaneMode) => void
}

export const useLanes = create<LaneState>((set, get) => ({
  chosen: {},
  mode: 'characters',
  choose: (key, ids) => {
    const next = { ...get().chosen }
    if (ids) next[key] = ids
    else delete next[key]
    set({ chosen: next })
  },
  setMode: (mode) => set({ mode })
}))
