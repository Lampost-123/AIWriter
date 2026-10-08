// Opening an entry's dossier from its card in the desk's World room, and going back to the card (UI overhaul phase 4,
// D4.3). The dossier is the entries page with the entry chosen; the gallery stays under it. A click flips the card into
// the dossier (a View Transition, features/look/viewTransition.ts); Back or a click on the dimmed room flips it back.
// From the keyboard (Enter on a card, Esc in the dossier) it happens at once; with less motion it is a short crossfade.
// Going back lands on the gallery's tab as it was, with the keyboard on the card.
import type { EntryKind, ID } from '@shared/types'
import { useApp } from '@/lib/store'
import { useCodex } from '@/features/codex/codexStore'

/** The card for an entry in the gallery, if it shows. */
export const cardOf = (id: ID): HTMLElement | null =>
  document.querySelector<HTMLElement>(`[data-world-gallery] [data-gallery-card="${CSS.escape(id)}"]`)

/** Opens an entry's dossier over the gallery: flipped from its card when one was clicked. */
export function openDossier(e: { id: ID; kind: EntryKind }, from?: HTMLElement | null): void {
  useApp.getState().navigate({ kind: 'entries', entryKind: e.kind, entryId: e.id }, from ? { flip: { from } } : undefined)
}

/** Back from a dossier to the gallery as it was (the same tab), the keyboard on the entry's card. */
export function closeDossier(id: ID, how: 'keyboard' | 'pointer' = 'keyboard'): void {
  const kind = useCodex.getState().filters.kind
  const view = kind ? ({ kind: 'entries', entryKind: kind, entryId: null } as const) : ({ kind: 'codex' } as const)
  useApp.getState().navigate(view, how === 'pointer' ? { flip: { to: () => cardOf(id) } } : undefined)
  // (WorldRoom gives the card the keyboard once the gallery is back in reach.)
}

/** Gives the keyboard to an entry's card (when it shows), without scrolling the gallery. */
export function focusCard(id: ID): void {
  const card = cardOf(id)
  if (card) card.focus({ preventScroll: true })
}
