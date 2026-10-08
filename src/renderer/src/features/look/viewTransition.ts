// The New look: a new page crossfades in the centre of the window (and the side list, when the rail's area changes) with
// a View Transition, while the rest of the window stays live. It happens at once instead when the change came from the
// keyboard, when the system asks for less motion, in Classic, or where the browser has no View Transitions.
// Not React's <ViewTransition>: navigation is zustand state, which React always applies synchronously, so that component
// would never run. This calls the browser directly and flushes React inside it. styles.css says which parts take part
// (:root[data-vt]) and how they move.
import { flushSync } from 'react-dom'
import { keyboardDriven, reducedMotion } from './motion'

interface Transition {
  ready: Promise<void>
  updateCallbackDone: Promise<void>
  finished: Promise<void>
  skipTransition(): void
}
type Start = (update: () => void) => Transition

/** Which transition is the latest, so an older one finishing doesn't clear the newer one's marks. */
let latest = 0

/** Menus and dialogs still playing their way out: a page change ends that at once (styles.css). */
const CLOSING = '[data-radix-popper-content-wrapper] > [data-state="closed"], [role="dialog"][data-state="closed"], [data-dialog-overlay][data-state="closed"]'

/** True when a change of page shows its crossfade (else it is instant). */
export function pageMotion(): boolean {
  if (typeof document === 'undefined') return false
  const start = (document as unknown as { startViewTransition?: Start }).startViewTransition
  return (
    document.documentElement.dataset.look === 'new' &&
    document.visibilityState !== 'hidden' &&
    typeof start === 'function' &&
    !reducedMotion() &&
    !keyboardDriven() &&
    // The workspace's centre (with no world open there is none to crossfade).
    !!document.querySelector('[data-page]')
  )
}

/**
 * Runs `update` (a store change that shows another page) inside a View Transition when motion is wanted, else at once.
 * `update` returns false when it turned out to have nothing to do (another change of page came first): the crossfade
 * is then dropped. `areaChanges`: the rail's area changes too, so the side list crossfades with the page.
 */
export function pageTransition(update: () => boolean | void, opts: { areaChanges?: boolean } = {}): void {
  if (!pageMotion()) {
    update()
    return
  }
  const root = document.documentElement
  // The side list takes part only when it shows beside the page (not shut, nor floating over it, nor stepping aside).
  const list = document.querySelector<HTMLElement>('[data-area-list]')
  const listShows = !!list && (list.closest('aside')?.getBoundingClientRect().width ?? 0) > 1
  // styles.css names the page (and the side list) only while this mark is up.
  root.dataset.vt = opts.areaChanges && listShows ? 'page area' : 'page'
  const token = ++latest
  const start = (document as unknown as { startViewTransition: Start }).startViewTransition
  let changed = true
  const vt = start.call(document, () => {
    // A menu whose item changed the page is gone at once: the page's change is what Adam watches now.
    for (const el of document.querySelectorAll<HTMLElement>(CLOSING)) for (const a of el.getAnimations()) a.finish()
    flushSync(() => {
      changed = update() !== false
    })
  })
  // A transition that is skipped (another page came first) rejects these: that is expected.
  vt.ready.catch(() => undefined)
  vt.updateCallbackDone.then(() => {
    if (!changed) vt.skipTransition()
  }, () => undefined)
  void vt.finished
    .catch(() => undefined)
    .finally(() => {
      if (token === latest) delete root.dataset.vt
    })
}
