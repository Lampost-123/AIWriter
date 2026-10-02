import type { ID } from '@shared/types'

// Lets "What changed" open a scene at the words a fact came from: the request waits until the
// scene is on screen, then the editor selects those words and scrolls them into view.

/** Marks the transaction that selects the words being shown, so the page doesn't offer to add them to memory. */
export const REVEALED = 'aiwriteRevealed'

let pending: { sceneId: ID; quote: string } | null = null
const listeners = new Set<() => void>()

export function requestReveal(sceneId: ID, quote: string): void {
  pending = { sceneId, quote }
  listeners.forEach((l) => l())
}

/** The words to show (once) if a reveal was requested for this scene. */
export function takeReveal(sceneId: ID | null): string | null {
  if (!sceneId || pending?.sceneId !== sceneId) return null
  const { quote } = pending
  pending = null
  return quote
}

export function onRevealRequest(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
