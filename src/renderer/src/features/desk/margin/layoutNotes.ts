// Where the margin notes go down the page (the desk, UI overhaul phase 3): each note wants to sit level with the line it
// is about, and none may overlap the one above it, so a note that would is pushed down below it (with a small gap).
// Pinned notes (the scene card, beside the title) stay where they want to be, and the others make way for them. Pure.

export interface NoteToPlace {
  id: string
  /** Where it wants its top (px down the page). */
  want: number
  /** Its height. */
  height: number
  /** It stays at `want` whatever else is there. */
  pinned?: boolean
  /** Its place in reading order, for notes that want the same line (the one about the earlier word goes first). */
  order?: number
}

/** Each note's top, keyed by id. */
export function layoutNotes(items: readonly NoteToPlace[], gap = 8): Map<string, number> {
  const out = new Map<string, number>()
  // Pinned notes first where they want to be; the rest in order down the page, each below what is above it.
  const pinned = items.filter((n) => n.pinned).sort((a, b) => a.want - b.want)
  const free = items.filter((n) => !n.pinned).sort((a, b) => a.want - b.want || (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id))
  const taken: { top: number; bottom: number }[] = pinned.map((n) => ({ top: n.want, bottom: n.want + n.height }))
  for (const n of pinned) out.set(n.id, n.want)
  let floor = -Infinity
  for (const n of free) {
    let top = Math.max(n.want, floor)
    // Below any pinned note it would overlap (they never move).
    for (let moved = true; moved; ) {
      moved = false
      for (const t of taken) {
        if (top < t.bottom + gap && top + n.height + gap > t.top) {
          top = t.bottom + gap
          moved = true
        }
      }
    }
    out.set(n.id, top)
    floor = top + n.height + gap
  }
  return out
}
