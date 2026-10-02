// Editing a scene's beats as a list: pure functions, tested in beats.test.ts.
// Each beat carries a stable id so React keys and dragging survive edits.

export interface Beat {
  id: string
  text: string
}

/** Where the cursor should go after an edit. */
export interface BeatEdit {
  beats: Beat[]
  focus: { index: number; caret: number }
}

let seq = 0
export const newBeatId = (): string => `beat-${++seq}`

/** Beats for the editor. Always at least one (empty) row to type into. */
export const toBeats = (texts: string[], makeId: () => string = newBeatId): Beat[] =>
  (texts.length ? texts : ['']).map((text) => ({ id: makeId(), text }))

/** Beats as stored on the scene card: tidied, with blank ones left out. */
export const beatsToStore = (beats: Beat[] | string[]): string[] =>
  beats.map((b) => (typeof b === 'string' ? b : b.text).replace(/\s+/g, ' ').trim()).filter(Boolean)

/** Enter: splits the beat at the cursor; the text after it becomes the next beat. */
export function splitBeat(beats: Beat[], index: number, selStart: number, selEnd: number, makeId: () => string = newBeatId): BeatEdit {
  const cur = beats[index]
  const before = cur.text.slice(0, selStart)
  const after = cur.text.slice(selEnd)
  const out = [...beats]
  out.splice(index, 1, { ...cur, text: before }, { id: makeId(), text: after })
  return { beats: out, focus: { index: index + 1, caret: 0 } }
}

/** Removes a beat (Backspace on an empty one, or the remove button). The last row is cleared rather than removed. */
export function removeBeat(beats: Beat[], index: number): BeatEdit {
  if (beats.length <= 1) return { beats: [{ ...beats[0], text: '' }], focus: { index: 0, caret: 0 } }
  const out = beats.filter((_, i) => i !== index)
  const to = Math.max(0, index - 1)
  return { beats: out, focus: { index: to, caret: index === 0 ? 0 : out[to].text.length } }
}

/** Backspace at the very start of a beat: joins it onto the end of the one before. */
export function mergeWithPrevious(beats: Beat[], index: number): BeatEdit | null {
  if (index <= 0) return null
  const prev = beats[index - 1]
  const cur = beats[index]
  const out = [...beats]
  out.splice(index - 1, 2, { ...prev, text: prev.text + cur.text })
  return { beats: out, focus: { index: index - 1, caret: prev.text.length } }
}

/** Moves a beat to a new position (drag, or Alt+Up / Alt+Down). */
export function moveBeat(beats: Beat[], from: number, to: number): Beat[] {
  if (from === to || from < 0 || to < 0 || from >= beats.length || to >= beats.length) return beats
  const out = [...beats]
  const [b] = out.splice(from, 1)
  out.splice(to, 0, b)
  return out
}

/**
 * Pasting several lines into a beat makes one beat per line. Returns null for a
 * single line, so the normal paste happens. List markers ("1.", "-", "•") are dropped.
 */
export function pasteLines(
  beats: Beat[],
  index: number,
  selStart: number,
  selEnd: number,
  pasted: string,
  makeId: () => string = newBeatId
): BeatEdit | null {
  const lines = pasted
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim())
    .filter(Boolean)
  if (lines.length < 2) return null
  const cur = beats[index]
  const before = cur.text.slice(0, selStart)
  const after = cur.text.slice(selEnd)
  const last = lines.length - 1
  const made: Beat[] = lines.map((line, i) => ({
    id: i === 0 ? cur.id : makeId(),
    text: (i === 0 ? before : '') + line + (i === last ? after : '')
  }))
  const out = [...beats]
  out.splice(index, 1, ...made)
  return { beats: out, focus: { index: index + last, caret: lines[last].length } }
}
