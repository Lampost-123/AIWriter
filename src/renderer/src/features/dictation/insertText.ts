// Putting dictated words into a text box at its cursor (milestone 4): they replace any selection and get
// a space in front when the word before needs one. Owned by the Dictation part.

/** The box's new text with `spoken` at the cursor (or in place of the selection), and where the cursor goes. */
export function insertSpoken(value: string, start: number, end: number, spoken: string): { value: string; caret: number } {
  const words = spoken.trim()
  if (!words) return { value, caret: end }
  const before = value.slice(0, start)
  const after = value.slice(end)
  const lead = before && !/\s$/.test(before) ? ' ' : ''
  const trail = after && !/^[\s.,;:!?)\]}'"”’]/.test(after) ? ' ' : ''
  const next = before + lead + words + trail + after
  return { value: next, caret: before.length + lead.length + words.length }
}

/** Puts dictated words into a text box Adam is using (a React-controlled one too), then the cursor after them. */
export function insertIntoBox(el: HTMLTextAreaElement | HTMLInputElement, spoken: string, setValue: (value: string) => void): void {
  const { value, caret } = insertSpoken(el.value, el.selectionStart ?? el.value.length, el.selectionEnd ?? el.value.length, spoken)
  if (value === el.value) return
  setValue(value)
  requestAnimationFrame(() => {
    if (!el.isConnected) return
    el.focus({ preventScroll: true })
    el.setSelectionRange(caret, caret)
  })
}
