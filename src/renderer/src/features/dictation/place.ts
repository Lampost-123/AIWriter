// Where dictation's small marker ("Listening", "Writing it down") goes: beside the place the words will go,
// clear of the words themselves where it can be, and always inside the window. Pure.

export interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

/** What the marker sits by: the line the cursor is on in the page, a text box, or a microphone button. */
export interface Anchor {
  rect: Rect
  kind: 'caret' | 'box' | 'button'
  /** The part of the window it is in (the page, a side panel): the marker stays inside that when it fits. */
  within?: Rect
  /** Nothing comes after the cursor on its line (the end of a paragraph): the marker can sit just after it. */
  lineEnd?: boolean
  /** Nothing comes after the cursor in the whole scene: the marker can sit just below its line. */
  sceneEnd?: boolean
}

/** Space between the marker and what it sits by. */
const GAP = 6
/**
 * Room needed after the cursor for the marker to sit there, wide enough for its widest words ("Listening ·
 * 12 s left"), so it doesn't jump above the line as its words change.
 */
const BESIDE_ROOM = 170
/** The marker never comes closer than this to the window's edges. */
const EDGE = 8
/** With nowhere to sit by (that part of the window is covered), it sits this far up from the bottom, in the middle. */
const BOTTOM = 28

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(n, Math.max(lo, hi)))

/** The top-left corner for a marker `w` by `h`, in a window `vw` by `vh`. */
export function markerSpot(anchor: Anchor | null, w: number, h: number, vw: number, vh: number): { x: number; y: number } {
  // Where it may go: the window, or the part of it the anchor is in when the marker fits there.
  let room: Rect = { left: EDGE, top: EDGE, right: vw - EDGE, bottom: vh - EDGE }
  const inner = anchor?.within
  if (inner) {
    const fit = {
      left: Math.max(room.left, inner.left + EDGE),
      top: Math.max(room.top, inner.top + EDGE),
      right: Math.min(room.right, inner.right - EDGE),
      bottom: Math.min(room.bottom, inner.bottom - EDGE)
    }
    if (fit.right - fit.left >= w && fit.bottom - fit.top >= h) room = fit
  }
  let x = (vw - w) / 2
  let y = vh - h - BOTTOM
  if (anchor) {
    const r = anchor.rect
    if (anchor.kind === 'caret' && anchor.lineEnd && r.right + GAP + Math.max(w, BESIDE_ROOM) <= room.right) {
      // Just after the cursor, on its line, where the words will appear: nothing there to cover.
      x = r.right + GAP
      y = (r.top + r.bottom) / 2 - h / 2
    } else if (anchor.kind === 'caret') {
      // Starting where the cursor is: just below its line when nothing comes after it in the scene (nothing
      // there to cover), else just above the line; below it when there's no room above.
      x = r.left - 10
      y = anchor.sceneEnd && r.bottom + GAP + h <= room.bottom ? r.bottom + GAP : r.top - h - GAP
      if (y < room.top) y = r.bottom + GAP
    } else if (anchor.kind === 'box') {
      // Across the box's top edge at its right-hand end, clear of its label and its text; across the bottom
      // edge when the box is at the very top of where it can go.
      x = r.right - w - 10
      y = r.top - h / 2
      if (y < room.top) y = r.bottom - h / 2
    } else {
      // To the left of the button; above it when there's no room on the left.
      x = r.left - w - GAP
      y = (r.top + r.bottom) / 2 - h / 2
      if (x < room.left) {
        x = (r.left + r.right) / 2 - w / 2
        y = r.top - h - GAP
        if (y < room.top) y = r.bottom + GAP
      }
    }
  }
  return { x: Math.round(clamp(x, room.left, room.right - w)), y: Math.round(clamp(y, room.top, room.bottom - h)) }
}
