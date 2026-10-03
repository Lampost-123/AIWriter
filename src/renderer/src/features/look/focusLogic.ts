// Focus mode's decisions (milestone 6), kept pure so they are unit-tested: when it can start, when it must end,
// what an Esc means, and what to put back in the saved layout when it ends. focusMode.ts acts on them.

import type { Settings } from '@shared/types'

/** The panels as they were when focus mode began: what leaving it puts back. */
export type PanelLayout = Pick<Settings['layout'], 'binderOpen' | 'binderWidth' | 'inspectorOpen' | 'inspectorWidth'>

export const PANEL_KEYS = ['binderOpen', 'binderWidth', 'inspectorOpen', 'inspectorWidth'] as const

/** The panels part of the saved layout. */
export const panelsOf = (layout: Settings['layout']): PanelLayout => ({
  binderOpen: layout.binderOpen,
  binderWidth: layout.binderWidth,
  inspectorOpen: layout.inspectorOpen,
  inspectorWidth: layout.inspectorWidth
})

/**
 * What to save so the panels are exactly as they were before focus mode (something in it may have changed them:
 * Ask the world or a name shown beside the page opens the scene panel, and it can be dragged wider there).
 * Null when nothing changed.
 */
export function layoutToRestore(before: PanelLayout | null, now: Settings['layout'] | null | undefined): Partial<PanelLayout> | null {
  if (!before || !now) return null
  const patch: Partial<PanelLayout> = {}
  for (const k of PANEL_KEYS) if (now[k] !== before[k]) (patch as Record<string, unknown>)[k] = before[k]
  return Object.keys(patch).length ? patch : null
}

/** Where Adam is, as far as focus mode cares. */
export interface Place {
  /** The page showing ('write', 'settings'...). */
  view: string
  sceneId: string | null
  hasWorld: boolean
}

/** Focus mode is for writing: a world with a scene open. */
export const canFocus = (p: Place): boolean => p.hasWorld && !!p.sceneId

/** Focus mode ends when the writing page goes (another page, no scene, the world closed). */
export const mustLeave = (p: Place): boolean => !canFocus(p) || p.view !== 'write'

/** An Esc press, as focus mode sees it. */
export interface EscPress {
  /** Something already used it (closed the selection bar, rejected the AI's change, a field's own Esc...). */
  handled: boolean
  /** Typed while composing (an accent, an IME). */
  composing: boolean
  /** Pressed in the page or with the keyboard nowhere in particular (not in a box, a panel or a card). */
  inPageOrNowhere: boolean
  /** A menu, list, dialog or card is open: Esc is theirs. */
  layerOpen: boolean
  /** A draft (or a beat) is being written or getting ready, or the AI's change waits: Esc stops or rejects it. */
  drafting: boolean
}

/**
 * True when Esc leaves focus mode. One Esc does one thing: closing a menu, stopping a draft or rejecting the AI's
 * change comes first, and the next Esc leaves.
 */
export const escLeaves = (e: EscPress): boolean => !e.handled && !e.composing && e.inPageOrNowhere && !e.layerOpen && !e.drafting
