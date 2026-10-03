// Opening Ask the world beside the page (from the top bar or the palette), with the keyboard in its box.
// Owned by the Ask the world part.
import { useApp } from '@/lib/store'
import { requestBoxFocus } from './askStore'

export function openAsk(): void {
  const a = useApp.getState()
  if (a.view.kind !== 'write') a.navigate({ kind: 'write' })
  a.setAskOpen(true)
  requestBoxFocus()
}

/** Closes Ask the world: the scene panel's tabs show again (not an entry shown from an answer). */
export function closeAsk(): void {
  const a = useApp.getState()
  if (a.peekEntryId) a.peekEntry(null)
  a.setAskOpen(false)
}
