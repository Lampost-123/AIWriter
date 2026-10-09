// Where the codex (and the desk's World room) was when Adam left it, and putting it back there: the card at the top of the
// view, or the card he opened, at the same distance below the top. Moved out of CodexView.tsx so both pages share it.
import type { CodexAnchor } from './codexStore'

// Cards are measured by the list item around each: its box is there even while the card inside
// hasn't been drawn, so measuring it never makes the browser draw a card out of view.
export const itemOf = (el: HTMLElement, id: string): HTMLElement | null =>
  el.querySelector<HTMLElement>(`[data-codex-item="${CSS.escape(id)}"]`)

/** The first card at least partly in view under the toolbar, and how far below the top of the view it starts. */
export function firstInView(el: HTMLElement): CodexAnchor | null {
  const top = el.getBoundingClientRect().top
  const under = el.querySelector('[data-codex-toolbar]')?.getBoundingClientRect().bottom ?? top
  for (const item of el.querySelectorAll<HTMLElement>('[data-codex-item]')) {
    const r = item.getBoundingClientRect()
    if (r.bottom > under) return { id: item.dataset.codexItem!, top: r.top - top, opened: false }
  }
  return null
}

/** Cards on each side of the one put back that are drawn straight away: more than a tall window holds. */
const NEAR = 60

/**
 * Scrolls the codex so a card is `top` below the top of its view again. The cards around it are drawn
 * first, as they will be once they are in view: a card not drawn yet counts at a guessed height, which
 * would put the view out by the difference (most of all at the end of the list).
 */
export function putBack(el: HTMLElement, item: HTMLElement, top: number): void {
  const items = [...el.querySelectorAll<HTMLElement>('[data-codex-item]')]
  const i = items.indexOf(item)
  for (const near of items.slice(Math.max(0, i - NEAR), i + NEAR + 1)) near.style.contentVisibility = 'visible'
  el.scrollTop = item.getBoundingClientRect().top - el.getBoundingClientRect().top - top
}
