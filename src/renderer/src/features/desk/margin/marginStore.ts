// The margin's passing state (the desk, UI overhaul phase 3): the notes Adam has put away for this session, by scene
// (each note's × once there are notes that can go: the entity, check and memory notes of the next steps). Nothing here is
// saved: a restart shows every note again.
import { create } from 'zustand'
import type { ID } from '@shared/types'

interface MarginState {
  /** Note ids put away, by scene. */
  dismissed: Record<ID, string[]>
}

export const useMarginStore = create<MarginState>(() => ({ dismissed: {} }))

/** Puts a note away for the rest of the session. */
export function dismissSlip(sceneId: ID, id: string): void {
  useMarginStore.setState((s) => {
    const was = s.dismissed[sceneId] ?? []
    return was.includes(id) ? s : { dismissed: { ...s.dismissed, [sceneId]: [...was, id] } }
  })
}

const NONE: string[] = []

/** The notes put away in a scene (the same empty list each time when there are none, so a selector stays still). */
export const dismissedIn = (s: MarginState, sceneId: ID): string[] => s.dismissed[sceneId] ?? NONE
