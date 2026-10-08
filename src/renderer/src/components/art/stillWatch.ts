// When the desk's room drawings (components/art/RoomArt.tsx) keep still: while the window is hidden or another window
// has the focus (<html data-art-still>), and for a moment after each key typed in a text box (<html data-art-typing>), so
// nothing moves near Adam's words. roomArt.css pauses every loop under them; with less motion nothing loops at all.
// (The living art's own watcher, when it is there too, sets the very same two marks the same way.)
//
// The window counts as in front until it is first left: app tests run in a window that never takes the focus.

let watching = false

/** How long after the last key the drawings stay still. */
const TYPING_MS = 1500

/** Starts watching the window, once (each drawing calls it as it first shows). */
export function watchArtStill(): void {
  if (watching || typeof document === 'undefined') return
  watching = true
  let away = false
  const root = document.documentElement
  const update = (): void => {
    root.toggleAttribute('data-art-still', away || document.visibilityState === 'hidden')
  }
  window.addEventListener('blur', () => {
    away = true
    update()
  })
  window.addEventListener('focus', () => {
    away = false
    update()
  })
  document.addEventListener('visibilitychange', update)
  update()
  let quiet = 0
  window.addEventListener(
    'keydown',
    (e) => {
      const t = e.target
      if (!(t instanceof HTMLElement) || ['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return
      if (!t.isContentEditable && !(t instanceof HTMLTextAreaElement) && !(t instanceof HTMLInputElement)) return
      root.setAttribute('data-art-typing', '')
      clearTimeout(quiet)
      quiet = window.setTimeout(() => root.removeAttribute('data-art-typing'), TYPING_MS)
    },
    { capture: true }
  )
}
