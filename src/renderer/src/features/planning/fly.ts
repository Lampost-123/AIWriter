// A suggestion flying to where it lands (UI overhaul, "the AI planning pages"): kept, a copy of its card lifts off the
// page and flies, shrinking, to its place in the story (its row in the story's spine, or the spine itself), while the
// card stays behind marked Kept; Undo flies it back. Kept on the desk only, and never from the keyboard or with less
// motion (it simply happens). A copy flies, not the card itself, so nothing on the page moves or reflows.
import { keyboardDriven, reducedMotion } from '@/features/look/motion'

/** How long the flight takes. */
export const FLY_MS = 560

const desk = (): boolean => typeof document !== 'undefined' && document.documentElement.dataset.arrangement === 'desk' && document.documentElement.dataset.look === 'new'

/** Whether flights play now. */
export const mayFly = (): boolean => desk() && !reducedMotion() && !keyboardDriven()

/** Where something kept lands: its row in the story's spine when that shows, else the spine (slim or full), else null. */
export function landingOf(id: string | null): DOMRect | null {
  if (typeof document === 'undefined') return null
  const spine = document.querySelector<HTMLElement>('[data-desk-spine]')
  if (!spine) return null
  if (id) {
    const row = spine.querySelector<HTMLElement>(`[data-row][data-id="${CSS.escape(id)}"]`)
    const r = row?.getBoundingClientRect()
    if (r && r.width > 0 && r.height > 0) return r
  }
  const r = spine.getBoundingClientRect()
  return r.width > 0 ? new DOMRect(r.left + 12, r.top + Math.min(r.height / 2, 160), Math.min(r.width - 24, 220), 28) : null
}

/** Waits a few frames for something to show (a row added to the spine once the outline is read again). */
export async function landingSoon(id: string | null, frames = 18): Promise<DOMRect | null> {
  for (let i = 0; i < frames; i++) {
    const spine = document.querySelector<HTMLElement>('[data-desk-spine]')
    const row = id ? spine?.querySelector<HTMLElement>(`[data-row][data-id="${CSS.escape(id)}"]`) : null
    if (row && row.getBoundingClientRect().height > 0) return row.getBoundingClientRect()
    await new Promise((r) => requestAnimationFrame(() => r(null)))
  }
  return landingOf(id)
}

/**
 * Flies a copy of `card` (as it looks now: pass its rectangle taken before anything changed) to `to`, or from `to` back
 * to it (`back`). Returns when it has landed (at once when flights don't play).
 */
export function flyCard(card: HTMLElement, from: DOMRect, to: DOMRect | null, back = false): Promise<void> {
  if (!to || !mayFly()) return Promise.resolve()
  const ghost = card.cloneNode(true) as HTMLElement
  ghost.removeAttribute('id')
  ghost.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'))
  ghost.setAttribute('aria-hidden', 'true')
  ghost.setAttribute('inert', '')
  ghost.classList.add('plan-ghost')
  Object.assign(ghost.style, {
    position: 'fixed',
    left: `${from.left}px`,
    top: `${from.top}px`,
    width: `${from.width}px`,
    height: `${from.height}px`,
    margin: '0',
    zIndex: '80',
    pointerEvents: 'none',
    transformOrigin: 'top left'
  })
  document.body.appendChild(ghost)
  const s = Math.max(0.12, Math.min(1, to.width / from.width))
  const dx = to.left - from.left
  const dy = to.top + to.height / 2 - (from.top + (from.height * s) / 2)
  const away: Keyframe = { transform: `translate(${dx}px, ${dy}px) scale(${s}) rotate(-2deg)`, opacity: 0 }
  const here: Keyframe = { transform: 'translate(0, 0) scale(1) rotate(0deg)', opacity: 1 }
  const lift: Keyframe = { transform: 'translate(0, -6px) scale(1.02) rotate(1deg)', opacity: 1, offset: 0.16 }
  // Most of the way there it is still clearly a card; it fades only as it reaches its place.
  const near = (k: number): Keyframe => ({ transform: `translate(${dx * k}px, ${dy * k}px) scale(${1 - (1 - s) * k}) rotate(${-2 * k}deg)`, opacity: 0.92 })
  const frames = back
    ? [away, { ...near(0.8), offset: 0.22 }, { ...lift, offset: 0.84 }, here]
    : [here, lift, { ...near(0.8), offset: 0.78 }, away]
  const run = ghost.animate(frames, { duration: FLY_MS, easing: 'cubic-bezier(0.32, 0.72, 0, 1)', fill: 'forwards' })
  return run.finished.then(
    () => ghost.remove(),
    () => ghost.remove()
  )
}
