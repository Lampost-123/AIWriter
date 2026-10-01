import type { ID } from '@shared/types'

// Lets the binder ask the editor to take keyboard focus once a scene is open
// (Enter on a scene in the binder opens it and puts the cursor in the page).

let pending: ID | null = null
const listeners = new Set<() => void>()

export function requestEditorFocus(sceneId: ID): void {
  pending = sceneId
  listeners.forEach((l) => l())
}

/** True (once) if focus was requested for this scene. */
export function takeFocusRequest(sceneId: ID | null): boolean {
  if (!sceneId || pending !== sceneId) return false
  pending = null
  return true
}

export function onFocusRequest(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
