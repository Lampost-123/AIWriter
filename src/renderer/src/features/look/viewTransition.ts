// The New look: a new page crossfades in the centre of the window (and the side list, when the rail's area changes) with
// a View Transition, while the rest of the window stays live. It happens at once instead when the change came from the
// keyboard, when the system asks for less motion, in Classic, or where the browser has no View Transitions.
// Not React's <ViewTransition>: navigation is zustand state, which React always applies synchronously, so that component
// would never run. This calls the browser directly and flushes React inside it. styles.css says which parts take part
// (:root[data-vt]) and how they move.
import { flushSync } from 'react-dom'
import { clearExitGhosts } from './exitGhosts'
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

/** True when a change of page can be drawn as a View Transition at all (the New look, from the pointer, in view). */
function canTransition(): boolean {
  if (typeof document === 'undefined') return false
  const start = (document as unknown as { startViewTransition?: Start }).startViewTransition
  return (
    document.documentElement.dataset.look === 'new' &&
    document.visibilityState !== 'hidden' &&
    typeof start === 'function' &&
    !keyboardDriven() &&
    // The workspace's centre (with no world open there is none to crossfade).
    !!document.querySelector('[data-page]')
  )
}

/** True when a change of page shows its crossfade (else it is instant). */
export function pageMotion(): boolean {
  return canTransition() && !reducedMotion()
}

/**
 * The desk's World room (UI overhaul phase 4): a card flips into its entry's dossier (`from`: the card), or the dossier
 * flips back into its card (`to`: finds the card once the gallery is back). features/desk/world/dossier.css draws it.
 */
export type Flip = { from: HTMLElement } | { to: () => HTMLElement | null }

/**
 * Runs `update` (a store change that shows another page) inside a View Transition when motion is wanted, else at once.
 * `update` returns false when it turned out to have nothing to do (another change of page came first): the crossfade
 * is then dropped. `areaChanges`: the rail's area changes too, so the side list crossfades with the page.
 */
export function pageTransition(update: () => boolean | void, opts: { areaChanges?: boolean; flip?: Flip } = {}): void {
  if (opts.flip) return flipTransition(update, opts.flip)
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
    // A menu whose item changed the page is gone at once (features/look/exitGhosts.ts): the page is what Adam watches now.
    clearExitGhosts()
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

/** The dossier's box and the card's, as the flip's numbers: how far the card travels and how large it grows. */
function flipVars(card: DOMRect, dossier: DOMRect): Record<string, string> {
  const s = (0.36 * dossier.width) / Math.max(1, card.width)
  return {
    '--flip-dx': `${Math.round(dossier.left + dossier.width / 2 - (card.left + card.width / 2))}px`,
    '--flip-dy': `${Math.round(dossier.top + dossier.height / 2 - (card.top + card.height / 2))}px`,
    '--flip-s': s.toFixed(3),
    // The dossier starts edge-on at the size the card ends at.
    '--flip-sx': '0.36',
    '--flip-sy': Math.min(1, (card.height * s) / Math.max(1, dossier.height)).toFixed(3)
  }
}

/**
 * A card flipping into its dossier, or back: the card turns away on its axis while growing towards where the dossier sits
 * (260ms), then the dossier turns in from the other side (260ms); back, the dossier turns away (210ms) and the card turns
 * in (210ms). The room dims behind as the page crossfades. From the keyboard, at once; with less motion, a 150ms
 * crossfade of the page instead (done here, since the rule that stills animations doesn't reach a View Transition's).
 */
function flipTransition(update: () => boolean | void, flip: Flip): void {
  if (!canTransition()) {
    update()
    return
  }
  const root = document.documentElement
  const fade = reducedMotion()
  const opening = 'from' in flip
  const card = opening ? flip.from : null
  // Measured before the change: the card clicked, or the dossier going away.
  const cardBox = card?.getBoundingClientRect()
  const before = opening ? undefined : document.querySelector<HTMLElement>('[data-dossier]')?.getBoundingClientRect()
  root.dataset.vt = fade ? 'page flip-fade' : opening ? 'page flip' : 'page flip-back'
  if (card && !fade) card.style.viewTransitionName = 'vt-card'
  const token = ++latest
  const vars: string[] = []
  const setVars = (v: Record<string, string>): void => {
    for (const [k, x] of Object.entries(v)) {
      vars.push(k)
      root.style.setProperty(k, x)
    }
  }
  let named: HTMLElement | null = card
  const start = (document as unknown as { startViewTransition: Start }).startViewTransition
  let changed = true
  const vt = start.call(document, () => {
    clearExitGhosts()
    flushSync(() => {
      changed = update() !== false
    })
    if (fade || !changed) return
    if (card && cardBox) {
      // The card was captured as it was; in the new page it has stepped out (it became the dossier).
      card.style.viewTransitionName = ''
      const dossier = document.querySelector<HTMLElement>('[data-dossier]')?.getBoundingClientRect()
      if (dossier) setVars(flipVars(cardBox, dossier))
    } else if (!opening && before) {
      const back = flip.to()
      if (back) {
        back.style.viewTransitionName = 'vt-card'
        named = back
        setVars(flipVars(back.getBoundingClientRect(), before))
      }
    }
  })
  vt.ready.catch(() => undefined)
  vt.updateCallbackDone.then(
    () => {
      if (!changed) vt.skipTransition()
    },
    () => undefined
  )
  void vt.finished
    .catch(() => undefined)
    .finally(() => {
      if (named) named.style.viewTransitionName = ''
      for (const k of vars) root.style.removeProperty(k)
      if (token === latest) delete root.dataset.vt
    })
}
