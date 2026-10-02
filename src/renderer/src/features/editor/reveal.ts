import type { ID } from '@shared/types'

// Lets "What changed" open a scene at the words a fact came from: the request waits until the
// scene is on screen, then the editor selects those words and scrolls them into view.

/** Marks the transaction that selects the words being shown, so the page doesn't offer to add them to memory. */
export const REVEALED = 'aiwriteRevealed'

let pending: { sceneId: ID; quote: string; wholeWord: boolean } | null = null
const listeners = new Set<() => void>()

/** `wholeWord`: never select the words inside a longer word (the Consistency page's repeated words). */
export function requestReveal(sceneId: ID, quote: string, opts: { wholeWord?: boolean } = {}): void {
  pending = { sceneId, quote, wholeWord: !!opts.wholeWord }
  listeners.forEach((l) => l())
}

/** The words to show (once) if a reveal was requested for this scene. */
export function takeReveal(sceneId: ID | null): { quote: string; wholeWord: boolean } | null {
  if (!sceneId || pending?.sceneId !== sceneId) return null
  const { quote, wholeWord } = pending
  pending = null
  return { quote, wholeWord }
}

export function onRevealRequest(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
