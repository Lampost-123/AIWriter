// Where dictation's small marker ("Listening", "Writing it down") goes: beside the place the words will go,
// clear of the words themselves, and always inside the window. In the middle of a paragraph, with no clear
// space beside the cursor's line, it shows small (no words), in the gap between the lines. Pure.

export interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

/** What the marker sits by: the cursor in the page, a text box, or a microphone button. */
export interface Anchor {
  rect: Rect
  kind: 'caret' | 'box' | 'button'
  /** The part of the window it is in (the page, a side panel): the marker stays inside that when it fits. */
  within?: Rect
  /** Where the cursor's line ends, when nothing comes after that in its paragraph (its last line). */
  lineEnd?: number
  /** The cursor's line is the scene's last: nothing below it to cover. */
  sceneEnd?: boolean
  /** Where the page's text starts, so the marker can sit in the margin beside the cursor's line. */
  textLeft?: number
  /** The top of the cursor's line: the middle of the gap between its words and those of the line above. */
  lineTop?: number
}

/** Where the marker's top-left corner goes, and whether it shows small (no words: there's no room for them). */
export interface Spot {
  x: number
  y: number
  small: boolean
}

/** Space between the marker and what it sits by. */
const GAP = 6
/**
 * Room the full marker needs beside a line: its widest words ("Starting the microphone…", "Listening ·
 * 12 s left"). Whether it fits is worked out for this, never for its size now, so it doesn't move (or
 * switch between full and small) as its words change.
 */
const FULL_W = 180
/** The full marker's height. */
const FULL_H = 24
/** The marker never comes closer than this to the window's edges. */
const EDGE = 8
/** With nowhere to sit by (that part of the window is covered), it sits this far up from the bottom, in the middle. */
const BOTTOM = 28

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(n, Math.max(lo, hi)))

/** Where a marker `w` by `h` may go: the window, or the part of it the anchor is in when it fits there. */
function roomFor(anchor: Anchor | null, w: number, h: number, vw: number, vh: number): Rect {
  const room: Rect = { left: EDGE, top: EDGE, right: vw - EDGE, bottom: vh - EDGE }
  const inner = anchor?.within
  if (!inner) return room
  const fit = {
    left: Math.max(room.left, inner.left + EDGE),
    top: Math.max(room.top, inner.top + EDGE),
    right: Math.min(room.right, inner.right - EDGE),
    bottom: Math.min(room.bottom, inner.bottom - EDGE)
  }
  return fit.right - fit.left >= w && fit.bottom - fit.top >= h ? fit : room
}

/**
 * Where a marker `w` by `h` goes, in a window `vw` by `vh`. By the cursor it shows in full where there is
 * clear space beside its line; elsewhere small, unless `small` is false (a countdown it must show): then
 * just above the line.
 */
export function markerSpot(anchor: Anchor | null, w: number, h: number, vw: number, vh: number, small = true): Spot {
  const room = roomFor(anchor, w, h, vw, vh)
  let x = (vw - w) / 2
  let y = vh - h - BOTTOM
  let shrunk = false
  if (anchor) {
    const r = anchor.rect
    const beside = (r.top + r.bottom) / 2 - h / 2
    if (anchor.kind === 'caret') {
      const full = roomFor(anchor, FULL_W, FULL_H, vw, vh)
      if (anchor.lineEnd != null && anchor.lineEnd + GAP + FULL_W <= full.right) {
        // Just after the end of the cursor's line, the last of its paragraph: nothing there to cover.
        x = anchor.lineEnd + GAP
        y = beside
      } else if (anchor.sceneEnd && r.bottom + GAP + FULL_H <= full.bottom) {
        // Just below the scene's last line, starting where the cursor is: nothing there to cover.
        x = r.left - 10
        y = r.bottom + GAP
      } else if (anchor.textLeft != null && anchor.textLeft - GAP - FULL_W >= full.left) {
        // In the page's margin, beside the cursor's line.
        x = anchor.textLeft - GAP - w
        y = beside
      } else if (small) {
        // In the middle of a paragraph: small, over the cursor in the gap between its line and the one above
        // (the one below, when its line is at the top), where it covers next to nothing.
        shrunk = true
        const gap = anchor.lineTop != null ? Math.max(0, r.top - anchor.lineTop) : 4
        x = (r.left + r.right) / 2 - w / 2
        y = r.top - gap - h / 2
        if (y < room.top) y = r.bottom + gap - h / 2
      } else {
        // Starting where the cursor is, just above its line; below it when there's no room above.
        x = r.left - 10
        y = r.top - h - GAP
        if (y < room.top) y = r.bottom + GAP
      }
    } else if (anchor.kind === 'box') {
      // Across the box's top edge at its right-hand end, clear of its label and its text; across the bottom
      // edge when the box is at the very top of where it can go.
      x = r.right - w - 10
      y = r.top - h / 2
      if (y < room.top) y = r.bottom - h / 2
    } else {
      // To the left of the button; above it when there's no room on the left.
      x = r.left - w - GAP
      y = beside
      if (x < room.left) {
        x = (r.left + r.right) / 2 - w / 2
        y = r.top - h - GAP
        if (y < room.top) y = r.bottom + GAP
      }
    }
  }
  return { x: Math.round(clamp(x, room.left, room.right - w)), y: Math.round(clamp(y, room.top, room.bottom - h)), small: shrunk }
}
