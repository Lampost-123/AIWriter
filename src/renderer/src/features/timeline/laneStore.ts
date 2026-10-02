// Which lanes Adam chose on the timeline, per world and per kind of lane, remembered on this computer.
// Until he chooses, the timeline shows the busiest few that fit. Browser storage can be unavailable;
// the timeline works without it, and only forgets his choice when the app closes.
import { create } from 'zustand'
import type { ID } from '@shared/types'
import type { LaneMode } from './timelineLogic'

const KEY = 'aiwrite.timeline.lanes'

interface Saved {
  /** By `${worldId}:${mode}`. */
  chosen: Record<string, ID[]>
  mode: LaneMode
}

function read(): Saved {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Saved> | null
    const chosen: Record<string, ID[]> = {}
    for (const [k, v] of Object.entries(raw?.chosen ?? {})) {
      if (Array.isArray(v)) chosen[k] = v.filter((x): x is ID => typeof x === 'string')
    }
    return { chosen, mode: raw?.mode === 'threads' ? 'threads' : 'characters' }
  } catch {
    return { chosen: {}, mode: 'characters' }
  }
}

function write(saved: Saved): void {
  try {
    // Keep the list from growing forever as worlds come and go.
    const keys = Object.keys(saved.chosen).slice(-100)
    localStorage.setItem(KEY, JSON.stringify({ mode: saved.mode, chosen: Object.fromEntries(keys.map((k) => [k, saved.chosen[k]])) }))
  } catch {
    // Not remembered this time; nothing else to do.
  }
}

interface LaneState extends Saved {
  choose: (key: string, ids: ID[] | null) => void
  setMode: (mode: LaneMode) => void
}

export const useLanes = create<LaneState>((set, get) => ({
  ...read(),
  choose: (key, ids) => {
    const chosen = { ...get().chosen }
    if (ids) chosen[key] = ids
    else delete chosen[key]
    set({ chosen })
    write({ chosen, mode: get().mode })
  },
  setMode: (mode) => {
    set({ mode })
    write({ chosen: get().chosen, mode })
  }
}))
