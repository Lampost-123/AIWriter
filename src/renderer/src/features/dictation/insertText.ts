// Putting dictated words in where the cursor is (milestone 4): they replace any selection, get a space in
// front when the word before needs one (and after, before a word that follows), and go in as typing
// does, so one Ctrl+Z takes them out and React-controlled boxes hear about them. Owned by the Dictation part.
import { BOX_GONE, offerWords } from './offer'

/** Text before the cursor that dictated words follow straight on from: a space, an opening quote or bracket, a joining dash. */
const FOLLOWS_ON = /[\s“‘([{—/-]$/
/** Dictated words that start like this join the word before them. */
const JOINS_BEFORE = /^[,.;:!?…)\]}”’]/
/** Text after the cursor that needs a space before it: a word, an opening quote or bracket, a spaced dash. */
const NEEDS_SPACE = /^[\p{L}\p{N}“‘([{–]/u

/** True when the text before the cursor ends with a straight quote that opens a quotation ('He said "'). */
const opensQuote = (before: string): boolean => /(?:^|[\s([{—])["']$/.test(before)

/**
 * The words as they go in between `before` and `after` (the text either side of the cursor or selection):
 * `text` is what to type, with `lead` spaces in front of `words`.
 */
export function spaced(before: string, after: string, spoken: string): { text: string; lead: number; words: string } {
  const words = spoken.replace(/\s+/g, ' ').trim()
  if (!words) return { text: '', lead: 0, words: '' }
  const lead = before && !FOLLOWS_ON.test(before) && !opensQuote(before) && !JOINS_BEFORE.test(words) ? 1 : 0
  const quoteNext = after.startsWith('"') && /^"[\p{L}\p{N}]/u.test(after)
  const trail = after && (NEEDS_SPACE.test(after) || quoteNext) && !/[“‘([{—-]$/.test(words) ? ' ' : ''
  return { text: (lead ? ' ' : '') + words + trail, lead, words }
}

/** The box's new text with `spoken` at the cursor (or in place of the selection), and where the cursor goes. */
export function insertSpoken(value: string, start: number, end: number, spoken: string): { value: string; caret: number } {
  const before = value.slice(0, start)
  const after = value.slice(end)
  const s = spaced(before, after, spoken)
  if (!s.words) return { value, caret: end }
  return { value: before + s.text + after, caret: start + s.lead + s.words.length }
}

/** A text box dictation can type into: a textarea, or a one-line text or search box, that can be typed in now. */
export function isTextBox(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement {
  if (el instanceof HTMLTextAreaElement) return !el.disabled && !el.readOnly
  if (el instanceof HTMLInputElement) return !el.disabled && !el.readOnly && ['text', 'search', ''].includes(el.type)
  return false
}

/** Sets a box's text the way the browser does, so React-controlled boxes hear about it. */
function setBoxText(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

/** True when Adam is typing somewhere other than `el` now (another box, or the page). */
function typingElsewhere(el: Element): boolean {
  const active = document.activeElement
  return !!active && active !== el && (isTextBox(active) || (active instanceof HTMLElement && active.isContentEditable))
}

/**
 * Types dictated words into a text box at its cursor, in place of any selection, as typing does: one
 * Ctrl+Z takes them out, and a React-controlled box's onChange runs. The box gets the keyboard, unless
 * Adam has gone on to type somewhere else meanwhile (then the words still go in, and the keyboard stays
 * where he is). False when the box can't be typed in now (gone, or read-only).
 */
export function insertIntoField(el: HTMLInputElement | HTMLTextAreaElement, spoken: string): boolean {
  if (!el.isConnected || !isTextBox(el)) return false
  const original = el.value
  const start = el.selectionStart ?? original.length
  const end = el.selectionEnd ?? start
  const s = spaced(original.slice(0, start), original.slice(end), spoken)
  if (!s.words) return true
  const caret = start + s.lead + s.words.length
  if (typingElsewhere(el)) {
    setBoxText(el, original.slice(0, start) + s.text + original.slice(end))
    el.setSelectionRange(caret, caret)
    return true
  }
  if (document.activeElement !== el) el.focus({ preventScroll: true })
  el.setSelectionRange(start, end)
  let typed = false
  try {
    typed = document.execCommand('insertText', false, s.text)
  } catch {
    typed = false
  }
  // A box that won't take typing still gets the words, without its own undo.
  if (!typed || el.value === original) setBoxText(el, original.slice(0, start) + s.text + original.slice(end))
  el.setSelectionRange(caret, caret)
  return true
}

/** Types dictated words into another editable part of the window (not the scene) at its cursor. */
export function insertIntoEditable(el: HTMLElement, spoken: string): boolean {
  if (!el.isConnected || !el.isContentEditable) return false
  if (!el.contains(document.activeElement)) el.focus({ preventScroll: true })
  const sel = window.getSelection()
  const node = sel?.anchorNode
  const before = node && node.nodeType === Node.TEXT_NODE ? (node.textContent ?? '').slice(0, sel?.anchorOffset ?? 0) : ''
  const s = spaced(before, '', spoken)
  if (!s.words) return true
  return document.execCommand('insertText', false, s.text)
}

/**
 * Puts dictated words into a text box Adam is using (a React-controlled one too), then the cursor after
 * them, as insertIntoField does. `setValue` is used only when the box has gone from the screen meanwhile.
 * A box still showing that can't be typed in now (read-only while what it is for is being built) offers
 * the words to copy instead, so they are never lost.
 */
export function insertIntoBox(el: HTMLTextAreaElement | HTMLInputElement, spoken: string, setValue: (value: string) => void): void {
  if (insertIntoField(el, spoken)) return
  if (el.isConnected) return offerWords(spoken, BOX_GONE)
  const { value } = insertSpoken(el.value, el.selectionStart ?? el.value.length, el.selectionEnd ?? el.value.length, spoken)
  if (value !== el.value) setValue(value)
}
