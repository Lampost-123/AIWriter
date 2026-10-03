// Opening Ask the world beside the page (from the top bar or the palette), with the keyboard in its box.
// Owned by the Ask the world part.
import { useApp } from '@/lib/store'
import { requestBoxFocus, setDraft, useAsk } from './askStore'

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

/**
 * Ask about this (words selected in the page): opens Ask the world with the words quoted in its box, ready for Adam's
 * question about them. Anything already typed there stays, after the quote.
 */
export function askAbout(words: string): void {
  const quote = words.replace(/\s+/g, ' ').trim().slice(0, 1500)
  if (!quote) return openAsk()
  const typed = useAsk.getState().draft.trim()
  setDraft(`About this passage: “${quote}”\n\n${typed}`)
  openAsk()
}
