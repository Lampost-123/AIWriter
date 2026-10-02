import type { ID } from '@shared/types'

// Lets a draft's record (or the message after a replace) put back the scene text that draft
// replaced: the request waits until the scene is on screen, then the editor puts the text back
// as one step Ctrl+Z can take back.

export interface PutBackRequest {
  sceneId: ID
  /** The page as it was, stored like a scene's text. */
  doc: unknown
  text: string
}

let pending: PutBackRequest | null = null
const listeners = new Set<() => void>()

export function requestPutBack(req: PutBackRequest): void {
  pending = req
  listeners.forEach((l) => l())
}

/** The text to put back (once) if that was asked for this scene. */
export function takePutBack(sceneId: ID | null): PutBackRequest | null {
  if (!sceneId || pending?.sceneId !== sceneId) return null
  const req = pending
  pending = null
  return req
}

export function onPutBackRequest(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
