// What the story board's strings say about themselves (UI overhaul, "the AI planning pages"; Adam: "can you explain the
// logic of these connections?"): each string's name tag where it starts ("The sealed letter · opens"), a tag where it
// ends ("resolved here" by its knot, "still open" by its arrow), and the line shown when the pointer is on it ("What is in
// the sealed letter? · opened in Ch 1, Sc 2 · resolved in Ch 2, Sc 1"). Where the tags go: beside the pin of the scene,
// in the room above its card (the board leaves room there), on the right of the pin, or on its left when another tag is
// already there. Pure, so it is unit-tested (stringNotes.test.ts).
import type { ID } from '@shared/types'
import { CARD_W, type BoardLayout, type PlacedString } from './boardLayout'

/** "Ch 2, Sc 1": where a scene is on the board, by its column and its place in it. */
export function placeOf(layout: BoardLayout, sceneId: ID | null | undefined): string | null {
  const box = sceneId ? layout.cards.get(sceneId) : undefined
  if (!box) return null
  const col = layout.columns.findIndex((c) => c.id === box.chapterId)
  return `Ch ${col + 1}, Sc ${box.index + 1}`
}

/** The line shown while the pointer is on a string. */
export function stringLine(layout: BoardLayout, s: PlacedString, name: string, paidOff: ID | null, open: boolean): string {
  const opened = placeOf(layout, s.sceneIds[0])
  const paid = open ? null : placeOf(layout, paidOff ?? s.sceneIds[s.sceneIds.length - 1])
  const touches = Math.max(0, s.sceneIds.length - (open ? 1 : 2))
  return [
    name,
    opened ? `opened in ${opened}` : null,
    touches ? `touched in ${touches} more ${touches === 1 ? 'scene' : 'scenes'}` : null,
    open ? 'still open' : paid ? `resolved in ${paid}` : 'resolved'
  ]
    .filter(Boolean)
    .join(' · ')
}

/** A short name for a tag: the question without its question mark, and its opening "What is in" kept (it reads). */
export function shortName(name: string, max = 34): string {
  const clean = name.trim().replace(/\?$/, '')
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`
}

export interface StringTag {
  id: ID
  kind: 'opens' | 'resolved' | 'open'
  /** Where it is anchored, on the canvas. */
  x: number
  y: number
  /** Which way it reaches from its anchor. */
  side: 'right' | 'left' | 'below'
  /** The widest it may be. */
  max: number
}

/** How far above a pin a tag sits (the room the board leaves over each card). */
export const TAG_LIFT = 38
const TAG_MAX = CARD_W / 2 + 40

/**
 * Where each string's tags go: its name where it starts; "resolved here" by its knot, or "still open" by its arrow. Tags
 * at the same pin take its two sides in turn (right first), then stack one row higher.
 */
export function stringTags(layout: BoardLayout): StringTag[] {
  const used = new Map<string, number>()
  const slot = (sceneId: ID): { side: 'right' | 'left'; lift: number } => {
    const n = used.get(sceneId) ?? 0
    used.set(sceneId, n + 1)
    return { side: n % 2 === 0 ? 'right' : 'left', lift: Math.floor(n / 2) * 24 }
  }
  const tags: StringTag[] = []
  for (const s of layout.strings) {
    const first = s.sceneIds[0]
    const a = slot(first)
    tags.push({ id: s.id, kind: 'opens', x: s.start.x + (a.side === 'right' ? 12 : -12), y: s.start.y - TAG_LIFT - a.lift, side: a.side, max: TAG_MAX })
  }
  for (const s of layout.strings) {
    if (s.knot) {
      const paid = s.sceneIds.find((id) => {
        const p = layout.pins.get(id)
        return p && Math.abs(p.x - 14 - s.knot!.x) < 1 && Math.abs(p.y - s.knot!.y) < 1
      })
      const b = paid ? slot(paid) : { side: 'left' as const, lift: 0 }
      const pin = paid ? layout.pins.get(paid)! : { x: s.knot.x + 14, y: s.knot.y }
      tags.push({ id: s.id, kind: 'resolved', x: pin.x + (b.side === 'right' ? 12 : -12), y: pin.y - TAG_LIFT - b.lift, side: b.side, max: TAG_MAX })
    } else if (s.end) {
      tags.push(
        s.intoNext
          ? { id: s.id, kind: 'open', x: s.end.x + 10, y: s.end.y - 10, side: 'right', max: CARD_W - 60 }
          : { id: s.id, kind: 'open', x: s.end.x, y: s.end.y + 10, side: 'below', max: 100 }
      )
    }
  }
  return tags
}
