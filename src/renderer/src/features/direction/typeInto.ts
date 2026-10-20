// Changing a direction box's words the way typing does, so one Ctrl+Z in the box takes the change back (a quick ask
// pressed with the pointer). Only the part that changed is replaced, so the box doesn't scroll or lose its place.

type Box = HTMLTextAreaElement | HTMLInputElement

/** The part of `before` that `after` replaces: from the first difference to the last. */
export function changedSpan(before: string, after: string): { from: number; to: number; text: string } {
  let from = 0
  const most = Math.min(before.length, after.length)
  while (from < most && before[from] === after[from]) from++
  let tail = 0
  while (tail < most - from && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail++
  return { from, to: before.length - tail, text: after.slice(from, after.length - tail) }
}

/**
 * Puts `next` in the box as typing would (it gets the keyboard), with the caret after the change. Where the browser
 * won't type it, `onChange` sets it (without the box's own undo).
 */
export function typeInto(el: Box, next: string, onChange: (text: string) => void): void {
  if (el.value === next) return
  if (document.activeElement !== el) el.focus({ preventScroll: true })
  const span = changedSpan(el.value, next)
  el.setSelectionRange(span.from, span.to)
  let typed = false
  try {
    typed = span.text ? document.execCommand('insertText', false, span.text) : document.execCommand('delete')
  } catch {
    typed = false
  }
  if (!typed || el.value !== next) onChange(next)
  const caret = span.from + span.text.length
  el.setSelectionRange(caret, caret)
}
