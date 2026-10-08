// Opening an entry's dossier from its card in the desk's World room, and going back to the card (UI overhaul phase 4).
// The dossier is the entries page with the entry chosen; the gallery stays under it. Going back lands on the gallery's
// tab as it was, with the keyboard on the card.
import type { EntryKind, ID } from '@shared/types'
import { useApp } from '@/lib/store'
import { useCodex } from '@/features/codex/codexStore'

/** The card for an entry in the gallery, if it shows. */
export const cardOf = (id: ID): HTMLElement | null =>
  document.querySelector<HTMLElement>(`[data-world-gallery] [data-gallery-card="${CSS.escape(id)}"]`)

/** Opens an entry's dossier over the gallery. */
export function openDossier(e: { id: ID; kind: EntryKind }): void {
  useApp.getState().navigate({ kind: 'entries', entryKind: e.kind, entryId: e.id })
}

/** Back from a dossier to the gallery as it was (the same tab), the keyboard on the entry's card. */
export function closeDossier(id: ID): void {
  const kind = useCodex.getState().filters.kind
  useApp.getState().navigate(kind ? { kind: 'entries', entryKind: kind, entryId: null } : { kind: 'codex' })
  // Once the gallery is back in the keyboard's reach (it is out of it under the dossier).
  setTimeout(() => focusCard(id), 0)
}

/** Gives the keyboard to an entry's card (when it shows), without scrolling the gallery. */
export function focusCard(id: ID): void {
  const card = cardOf(id)
  if (card) card.focus({ preventScroll: true })
}
