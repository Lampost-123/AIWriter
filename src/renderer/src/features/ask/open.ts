// Opening Ask the world beside the page (from the top bar or the palette), with the keyboard in its box.
// Owned by the Ask the world part.
import { useApp } from '@/lib/store'
import { requestBoxFocus, setDraft, setQuote, useAsk } from './askStore'

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
 * question about them. Anything already typed there stays, after the quote. The words (and their paragraphs' ids)
 * also go with the question beside it, so the chat knows it has them (AskInput.selection).
 */
export function askAbout(words: string, pids: string[] = []): void {
  quoteInBox(words, pids, null)
}

/**
 * Edit this (words selected in the page): as Ask about this, with the box set to ask for a change to them (the
 * question goes with mode 'edit'), ready for Adam to say what to change.
 */
export function editAbout(words: string, pids: string[] = []): void {
  quoteInBox(words, pids, 'edit')
}

function quoteInBox(words: string, pids: string[], mode: 'edit' | null): void {
  const quote = words.replace(/\s+/g, ' ').trim().slice(0, 1500)
  if (!quote) return openAsk()
  // Typed words stay after the quote (an earlier quote's own "About this passage" line gives way to this one).
  const s = useAsk.getState()
  const typed = (s.quote ? s.draft.replace(`About this passage: “${s.quote.text}”`, '') : s.draft).trim()
  setDraft(`About this passage: “${quote}”\n\n${typed}`)
  setQuote({ text: quote, pids, mode })
  openAsk()
}
