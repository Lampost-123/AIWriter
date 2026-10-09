import type { ID } from '@shared/types'

// Lets "What changed" (and, since World Memory Overhaul B2, every fact's source line) open a scene at the words a fact
// came from: the request waits until the scene is on screen, then the editor selects those words and scrolls them into
// view. With the paragraph they were read from, it looks there first, and shows that paragraph when the words were
// edited since.

/** Marks the transaction that selects the words being shown, so the page doesn't offer to add them to memory. */
export const REVEALED = 'aiwriteRevealed'

interface Reveal {
  quote: string
  wholeWord: boolean
  paragraphId: string | null
}

let pending: (Reveal & { sceneId: ID }) | null = null
const listeners = new Set<() => void>()

/**
 * `wholeWord`: never select the words inside a longer word (the Consistency page's repeated words). `paragraphId`: the
 * paragraph the words were read from (looked in first; shown itself when the words aren't there any more).
 */
export function requestReveal(sceneId: ID, quote: string, opts: { wholeWord?: boolean; paragraphId?: string | null } = {}): void {
  pending = { sceneId, quote, wholeWord: !!opts.wholeWord, paragraphId: opts.paragraphId ?? null }
  listeners.forEach((l) => l())
}

/** The words to show (once) if a reveal was requested for this scene. */
export function takeReveal(sceneId: ID | null): Reveal | null {
  if (!sceneId || pending?.sceneId !== sceneId) return null
  const { quote, wholeWord, paragraphId } = pending
  pending = null
  return { quote, wholeWord, paragraphId }
}

export function onRevealRequest(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
