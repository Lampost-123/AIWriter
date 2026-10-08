// The living art's one switch (UI overhaul, "living art"): the drawings that move on their own (the start screen's
// harbour, the empty pages' pictures, the story home's cover, a drawing idling in the dossier) are still while the
// window is hidden or another window has the focus, and start again where they were when AI Write is back in front.
// It sets <html data-art-still>; living.css pauses every ambient loop and entrance under it. While Adam is typing in any
// text box (a key in the last moment), <html data-art-typing> stills the loops too: nothing moves near his words. With
// less motion (Windows: animation effects off) nothing moves at all: each picture shows its resting frame (living.css).
//
// The window counts as in front until it is first left: app tests on Adam's PC run in a window that never takes the
// focus, so waiting for a first focus would keep the art still there for good.

let installed = false

/** How long after the last key the loops stay still. */
const TYPING_MS = 1500

/** Starts watching the window (once; every living picture calls it, so it needs no place of its own at launch). */
export function watchWindowForArt(): void {
  if (installed || typeof document === 'undefined') return
  installed = true
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
  // Typing: a key (not a lone modifier) in a text box keeps the loops still until a moment after the last one.
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
