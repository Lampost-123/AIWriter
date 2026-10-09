// When the AI planning pages' drawings may move (UI overhaul, "the AI planning pages"). Their loops are slow and quiet,
// and they hold still while the window is hidden or another window has the focus, and while Adam types in any text box
// (a key in the last moment): nothing moves beside his words. It sets the same marks on <html> as the living art does
// (data-art-still, data-art-typing), so one rule stills every drawing in the app, whichever started watching first.
// With less motion (Windows: animation effects off) nothing moves at all: planning.css shows each drawing's resting frame.

let installed = false

/** How long after the last key the loops stay still. */
const TYPING_MS = 1500

/** Starts watching the window (once; every drawing calls it, so it needs no place of its own at launch). */
export function watchPlanArt(): void {
  if (installed || typeof document === 'undefined') return
  installed = true
  const root = document.documentElement
  let away = false
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
