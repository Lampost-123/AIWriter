// Less motion when the system asks for it (milestone 6, "Look and feel"). styles.css stops every CSS transition
// and animation then; motion started from code (smooth scrolling, a glide written frame by frame) asks here.
// The New look's motion also asks whether Adam is using the keyboard: what he does from the keyboard happens at once.

/** True when the system asks for less motion (Windows: Settings › Accessibility › Visual effects › Animation effects off). */
export function reducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/** How to scroll something into place: smoothly, or in one step when the system asks for less motion. */
export const scrollBehavior = (): ScrollBehavior => (reducedMotion() ? 'auto' : 'smooth')

/** Whether the last thing Adam did was press a key (not a modifier on its own) or use the pointer. */
let lastInput: 'key' | 'pointer' = 'pointer'

/** Keys that only change another key or a click (Ctrl held for a Ctrl+click isn't using the keyboard). */
const MODIFIERS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'Fn'])

/**
 * Keeps track of whether Adam is using the keyboard or the pointer, so a change started from the keyboard (the palette,
 * Enter in the binder, a shortcut, Esc closing a menu) can happen at once, with no motion. It also marks
 * `<html data-input="key|pointer">`, so styles.css can close a menu or dialog at once when a key closed it. Returns the
 * clean-up. (`target` and `root` are only for tests.)
 */
export function installInputModality(
  target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> = window,
  root: { dataset: Record<string, string | undefined> } | null = document.documentElement
): () => void {
  const mark = (input: 'key' | 'pointer'): void => {
    lastInput = input
    // Written only when it changes, so typing never touches the page's styles.
    if (root && root.dataset.input !== input) root.dataset.input = input
  }
  const onKey = (e: Event): void => {
    const key = (e as KeyboardEvent).key
    if (key && MODIFIERS.has(key)) return
    mark('key')
  }
  const onPointer = (): void => mark('pointer')
  // First, before anything that acts on the key or the click (Esc closing a menu reads it).
  const first = { capture: true }
  mark(lastInput)
  target.addEventListener('keydown', onKey, first)
  target.addEventListener('pointerdown', onPointer, first)
  return () => {
    target.removeEventListener('keydown', onKey, first)
    target.removeEventListener('pointerdown', onPointer, first)
  }
}

/** True when the change under way came from the keyboard: it then happens at once. */
export const keyboardDriven = (): boolean => lastInput === 'key'
