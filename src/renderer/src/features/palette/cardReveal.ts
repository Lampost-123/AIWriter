// Opening a search result found on a scene's card (its notes for the AI, its summary, a beat...)
// shows that part of the card: once the scene is open with its card in the scene panel, the part is
// scrolled into view, so Adam sees what he searched for without hunting down the panel. The card
// belongs to the scene panel (features/inspector/); a part it marks with data-card-part is found
// by that, otherwise by its label on the card.

import type { CardPart } from '@shared/contracts/search'
import type { ID } from '@shared/types'
import { useApp } from '@/lib/store'

/** Each part's label on the card (features/inspector/SceneCardPanel.tsx); the summary's is its section heading. */
const LABELS: Record<CardPart, string> = {
  goal: 'Goal',
  conflict: 'Conflict',
  outcome: 'Outcome',
  mood: 'Mood or tone',
  when: 'When',
  beats: 'Beats',
  notes: 'Notes for the AI',
  summary: 'Summary'
}

/** How long the scene and its card may take to show before this gives up (usually a few frames). */
const WAIT_MS = 3000

const textOf = (el: Element): string => el.textContent?.trim() ?? ''

/** The scene card in the scene panel, when it is the tab on show. */
function cardPanel(): HTMLElement | null {
  for (const tab of document.querySelectorAll<HTMLElement>('[role="tab"][aria-selected="true"]')) {
    // By the tab's value (Radix names its panel "…-content-card"): its label reads "Card" in a narrow panel.
    const controls = tab.getAttribute('aria-controls')
    const id = controls?.endsWith('-content-card') ? controls : null
    if (id) return document.getElementById(id)
  }
  return null
}

/** The part on the card: marked by the card itself, else its field's label (or the summary's heading). */
function findPart(panel: HTMLElement, part: CardPart): HTMLElement | null {
  const marked = panel.querySelector<HTMLElement>(`[data-card-part="${part}"]`)
  if (marked) return marked
  if (part === 'summary') return [...panel.querySelectorAll('h3')].find((h) => textOf(h) === LABELS.summary)?.closest('section') ?? null
  return [...panel.querySelectorAll('label')].find((l) => textOf(l) === LABELS[part])?.parentElement ?? null
}

/**
 * Scrolls a part of a scene's card into view once the scene and its card are on screen. Gives up
 * quietly if Adam goes to another scene, page or tab first, or the panel can't be shown.
 */
export function revealCardPart(sceneId: ID, part: CardPart): void {
  const until = performance.now() + WAIT_MS
  let frames = 0
  const look = (): void => {
    const a = useApp.getState()
    if (a.sceneId !== sceneId || a.view.kind !== 'write' || a.inspectorTab !== 'card' || performance.now() > until) return
    // Not in the first frames, while the card on show may still be the last scene's.
    const panel = ++frames > 2 ? cardPanel() : null
    const el = panel ? findPart(panel, part) : null
    if (el) el.scrollIntoView({ block: 'center' })
    else requestAnimationFrame(look)
  }
  requestAnimationFrame(look)
}
