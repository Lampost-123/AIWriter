// What the command palette opens: itself, the keyboard shortcuts list, and the top bar's world menu,
// New world dialog and world name box (so the palette can reach those too). Kept here rather than
// in the app store, which belongs to every part.

import { create } from 'zustand'

/** Where the world menu or the world name box was opened from: the top bar itself, or the palette. */
export type OpenedFrom = 'bar' | 'palette'

interface PaletteState {
  /** The command palette (Ctrl+K). */
  open: boolean
  /** The keyboard shortcuts list (?). */
  shortcuts: boolean
  /** The top bar's list of worlds. */
  worldMenu: OpenedFrom | false
  /** The New world dialog. */
  newWorld: boolean
  /** The world's name is being edited in the top bar. */
  renamingWorld: OpenedFrom | false
}

export const usePalette = create<PaletteState>(() => ({
  open: false,
  shortcuts: false,
  worldMenu: false,
  newWorld: false,
  renamingWorld: false
}))

/** Marks the palette and the shortcuts list, so focus inside them is never the place to go back to. */
export const PALETTE_LAYER = 'data-palette-layer'

// Where keyboard focus was when the palette or the shortcuts list opened (or the world menu or name
// box, opened from the palette). Remembered at the moment they are asked for, before they take
// focus, so closing them puts the caret back where Adam was. In the page the caret's place is kept
// too: focusing the page again on its own would put the caret at the very start.
let returnTo: { el: HTMLElement; caret: Range | null } | null = null

function rememberFocus(): void {
  const el = document.activeElement
  // Going from the palette to the shortcuts list keeps the place from before the palette.
  if (el instanceof HTMLElement && el.closest(`[${PALETTE_LAYER}]`)) return
  if (!(el instanceof HTMLElement) || el === document.body) {
    returnTo = null
    return
  }
  const sel = document.getSelection()
  const caret = el.isContentEditable && sel?.rangeCount && el.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null
  returnTo = { el, caret }
}

/** Puts keyboard focus back where it was before the palette or the list opened, if that is still there. */
export function giveFocusBack(): void {
  const to = returnTo
  returnTo = null
  if (!to || !to.el.isConnected || to.el.closest('[inert]')) return
  to.el.focus({ preventScroll: true })
  if (to.caret && to.el.contains(to.caret.startContainer)) {
    const sel = document.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(to.caret)
  }
}

export function openPalette(): void {
  rememberFocus()
  usePalette.setState({ open: true, shortcuts: false })
}

export function openShortcuts(): void {
  rememberFocus()
  usePalette.setState({ shortcuts: true, open: false })
}

/** Opens the top bar's list of worlds from the palette; closing it puts the caret back where it was. */
export function openWorldMenu(): void {
  rememberFocus()
  usePalette.setState({ worldMenu: 'palette' })
}

/** Starts renaming the world from the palette; once the name is in, the caret goes back where it was. */
export function startRenamingWorld(): void {
  rememberFocus()
  usePalette.setState({ renamingWorld: 'palette' })
}
