// "Is a layer open?" asked from anywhere: a menu, a list, a popover or a dialog over the page keeps its own keys (Esc,
// Ctrl+G, Ctrl+Enter ...). In the New look a menu or dialog closed with the pointer leaves a lifeless copy of itself
// behind for a moment while it plays its way out (features/look/exitGhosts.ts, marked data-state="closed"): that never
// counts as open, so a shortcut pressed straight after works at once.

/** A menu, list or popover (Radix puts each in a positioned wrapper) that is open, not one on its way out. */
export const OPEN_POPPER = '[data-radix-popper-content-wrapper]:not(:has(> [data-state="closed"]))'
/** A menu that is open (Radix's or our own), not one on its way out. */
export const OPEN_MENU = '[role="menu"]:not([data-state="closed"])'
/** A dialog that is open. */
export const OPEN_DIALOG = '[role="dialog"][data-state="open"]'

/** Something else (a menu, a dialog, a popover) is open and keeps its own keys. */
export const layerOpen = (): boolean => !!document.querySelector(`${OPEN_POPPER}, ${OPEN_DIALOG}`)
