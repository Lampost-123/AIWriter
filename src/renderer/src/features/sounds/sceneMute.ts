// "Mute sounds in this scene" (the reading bar's button): which scenes Adam muted, as the scene's sounds last said
// (SceneSounds.muted). Kept apart so the reading's sounds can ask without importing the reading itself.
import { create } from 'zustand'
import type { ID } from '@shared/types'

export const useSceneMute = create<{ muted: Record<ID, boolean> }>(() => ({ muted: {} }))

/** The scene's sounds are muted, as last heard. */
export const sceneMuted = (sceneId: ID): boolean => !!useSceneMute.getState().muted[sceneId]

/** What the scene's sounds say now (an answer that carries them, or the button pressed). */
export function noteSceneMuted(sceneId: ID, muted: boolean): void {
  if (sceneMuted(sceneId) === muted && sceneId in useSceneMute.getState().muted) return
  useSceneMute.setState((s) => ({ muted: { ...s.muted, [sceneId]: muted } }))
}
