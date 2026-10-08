// The New look: menus, popovers and dialogs leave the way they came. Radix still removes a closing layer at once, as in
// Classic, so the keyboard goes straight back where it was, the shortcuts work, and nothing in it can be pressed by
// mistake. Then this puts back that very element, as it last looked, lifeless (inert and hidden from screen readers),
// for styles.css to play it out ([data-exit-ghost]: menus shrink back toward where they opened, dialogs and their dim
// fade), and removes it when that ends. A layer closed from the keyboard (Esc, Enter), with less motion, during a page
// change, or in Classic just goes. lib/layers.ts never counts a ghost as an open layer.
import { keyboardDriven, reducedMotion } from './motion'

/** What leaves this way: a menu, list or popover in its positioned wrapper, a dialog, a dialog's dim. */
const LAYER = '[data-radix-popper-content-wrapper], [data-dialog], [data-dialog-overlay]'

/** The longest a ghost may stay, should its animation never end. */
const AT_MOST = 400

function playOut(node: HTMLElement): void {
  // The part that moves: the menu or popover inside its wrapper, or the dialog (or its dim) itself.
  const part = node.matches('[data-radix-popper-content-wrapper]') ? node.firstElementChild : node
  if (!(part instanceof HTMLElement)) return
  node.dataset.exitGhost = ''
  node.inert = true
  node.setAttribute('aria-hidden', 'true')
  // Its ids belong to the layer that may open again meanwhile.
  for (const el of node.querySelectorAll('[id]')) el.removeAttribute('id')
  part.dataset.state = 'closed'
  document.body.append(node)
  let timer: ReturnType<typeof setTimeout> | undefined
  const gone = (): void => {
    clearTimeout(timer)
    part.removeEventListener('animationend', onEnd)
    part.removeEventListener('animationcancel', onEnd)
    node.remove()
  }
  const out = getComputedStyle(part).animationName
  if (out === 'none') return gone()
  // (Its opening animation, cut short when Radix removed it, reports in too: only the way out counts.)
  const onEnd = (e: AnimationEvent): void => {
    if (e.target === part && e.animationName === out) gone()
  }
  part.addEventListener('animationend', onEnd)
  part.addEventListener('animationcancel', onEnd)
  timer = setTimeout(gone, AT_MOST)
}

/** Watches for layers leaving and plays each out. Returns the clean-up. */
export function installExitGhosts(): () => void {
  const root = document.documentElement
  const mo = new MutationObserver((records) => {
    // (A page change takes Adam's eye: the layer just goes.)
    if (root.dataset.look !== 'new' || root.dataset.vt || keyboardDriven() || reducedMotion()) return
    for (const r of records) {
      for (const node of r.removedNodes) {
        if (node instanceof HTMLElement && !node.isConnected && node.matches(LAYER) && !node.hasAttribute('data-exit-ghost')) playOut(node)
      }
    }
  })
  // Radix puts every layer straight into <body>.
  mo.observe(document.body, { childList: true })
  return () => mo.disconnect()
}

/** Ends every exit still playing (a page change is about to start). */
export function clearExitGhosts(): void {
  for (const ghost of document.querySelectorAll('[data-exit-ghost]')) ghost.remove()
}
