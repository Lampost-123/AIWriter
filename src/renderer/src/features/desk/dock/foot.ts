// The foot of the desk's page (UI pass, 2026-10-19): what lies over the AI dock takes turns, so the director's line, the
// direction receipt and the next-beat chip never pile up over the words. One at a time, in this order: the director
// (while a directed draft writes, and its last line a moment after), then the receipt (after a draft written with a
// direction), then the next-beat chip. The dock says what it is doing, so a prompt with a button of its own (the chip's
// "mark it done?") waits while the AI writes or a change waits for Accept or Reject: one thing to press at a time.
import { create } from 'zustand'
import type { ID } from '@shared/types'

interface FootState {
  /** The scene whose direction receipt shows over the dock, if any. */
  receipt: ID | null
  /** What the dock is doing, by scene: 'idle', 'busy', 'review' or 'beats' (Dock's data-desk-dock). */
  dock: Record<ID, string>
}

export const useFoot = create<FootState>(() => ({ receipt: null, dock: {} }))

/** The receipt shows (or no longer shows) over the dock of `sceneId`. */
export function setReceiptShown(sceneId: ID, shown: boolean): void {
  const now = useFoot.getState().receipt
  if (shown && now !== sceneId) useFoot.setState({ receipt: sceneId })
  else if (!shown && now === sceneId) useFoot.setState({ receipt: null })
}

/** What the dock of `sceneId` is doing now. */
export function setDockKind(sceneId: ID, kind: string): void {
  if (useFoot.getState().dock[sceneId] === kind) return
  useFoot.setState((s) => ({ dock: { ...s.dock, [sceneId]: kind } }))
}

/** True while the dock of `sceneId` is idle (or not known yet): a prompt with its own button may show. */
export const dockIdle = (s: FootState, sceneId: ID): boolean => (s.dock[sceneId] ?? 'idle') === 'idle'
