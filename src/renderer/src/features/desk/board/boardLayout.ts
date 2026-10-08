// Where everything sits on the desk's story board (UI overhaul, D5.2): a column for each chapter, the scenes' index
// cards down it, each card's pin, a ghost slot under each column ("Add a scene") and one more column for the next
// chapter; the plot threads as strings from pin to pin in reading order, with a knot where a thread is paid off and an
// open end where it still runs on; and, while a card is dragged, where it would land. No React, so it is unit-tested
// (boardLayout.test.ts).
import type { ID } from '@shared/types'

export const CARD_W = 260
export const CARD_H = 150
/** Between columns: room for the strings to swing through. */
export const COL_GAP = 110
/** Between cards in a column. */
export const ROW_GAP = 34
/** A column's head (numeral, chapter, its progress), above its first card. */
export const HEAD_H = 76
/** Around the whole board. */
export const PAD_X = 40
export const PAD_TOP = 8
export const PAD_BOTTOM = 40
/** The ghost slot under a column's cards. */
export const GHOST_H = 112
/** How many string inks there are (--thread-1 … --thread-6 in desk.css). */
export const INKS = 6

/** A small tilt for each card, the same every time (cards pinned by hand are never quite straight). */
const TILTS = [-0.6, 0.4, 0.5, -0.4, 0.3, -0.5, 0.2, -0.3]

export interface BoardColumnIn {
  id: ID
  sceneIds: ID[]
}

export interface ThreadIn {
  id: ID
  /** The scenes it is set up or paid off in, any order (put in reading order here). */
  sceneIds: ID[]
  /** The scene it is paid off in, when it is. */
  paidOffSceneId: ID | null
  /** Still running on (not resolved). */
  open: boolean
}

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export interface PlacedCard extends Box {
  id: ID
  chapterId: ID
  /** Its place in its chapter. */
  index: number
  /** Degrees. */
  tilt: number
}

export interface PlacedColumn {
  id: ID
  x: number
  /** Where its cards start. */
  top: number
  /** The ghost slot under its cards. */
  ghost: Box
}

export interface PlacedString {
  id: ID
  /** Its ink: 1 to INKS, by the thread's order. */
  ink: number
  /** SVG path data, pin to pin. */
  d: string
  /** The knot where it is paid off. */
  knot: { x: number; y: number } | null
  /** The open end, where it still runs on. */
  end: { x: number; y: number } | null
  /** The scenes it passes through, in reading order. */
  sceneIds: ID[]
}

export interface BoardLayout {
  columns: PlacedColumn[]
  cards: Map<ID, PlacedCard>
  /** Each card's pin, top middle. */
  pins: Map<ID, { x: number; y: number }>
  /** The next chapter's column ("Plan Chapter N"). */
  next: { x: number; ghost: Box }
  strings: PlacedString[]
  width: number
  height: number
}

const r1 = (n: number): number => Math.round(n * 10) / 10

/** Lays out the board: columns left to right in chapter order, cards top to bottom by position. */
export function boardLayout(columns: BoardColumnIn[], threads: ThreadIn[] = []): BoardLayout {
  const cards = new Map<ID, PlacedCard>()
  const pins = new Map<ID, { x: number; y: number }>()
  const placed: PlacedColumn[] = []
  const top = PAD_TOP + HEAD_H
  let tallest = 0
  let k = 0
  columns.forEach((col, ci) => {
    const x = PAD_X + ci * (CARD_W + COL_GAP)
    col.sceneIds.forEach((id, i) => {
      const y = top + i * (CARD_H + ROW_GAP)
      cards.set(id, { id, chapterId: col.id, index: i, x, y, w: CARD_W, h: CARD_H, tilt: TILTS[k++ % TILTS.length] })
      pins.set(id, { x: x + CARD_W / 2, y: y + 13 })
    })
    const ghostY = top + col.sceneIds.length * (CARD_H + ROW_GAP)
    placed.push({ id: col.id, x, top, ghost: { x, y: ghostY, w: CARD_W, h: GHOST_H } })
    tallest = Math.max(tallest, ghostY + GHOST_H)
  })
  const nextX = PAD_X + columns.length * (CARD_W + COL_GAP)
  const nextGhost = { x: nextX, y: top, w: CARD_W, h: Math.max(GHOST_H * 1.6, tallest - top) }
  tallest = Math.max(tallest, nextGhost.y + nextGhost.h)

  // Reading order, for the strings.
  const order = new Map<ID, number>()
  columns.forEach((c) => c.sceneIds.forEach((id) => order.set(id, order.size)))
  const strings: PlacedString[] = []
  threads.forEach((t, ti) => {
    const ids = [...new Set(t.sceneIds)].filter((id) => order.has(id)).sort((a, b) => order.get(a)! - order.get(b)!)
    if (!ids.length) return
    const points = ids.map((id) => pins.get(id)!)
    let d = `M${r1(points[0].x)} ${r1(points[0].y)}`
    for (let i = 1; i < points.length; i++) d += ` ${segment(points[i - 1], points[i])}`
    const paid = t.paidOffSceneId && pins.get(t.paidOffSceneId)
    const knot = !t.open && paid ? { x: r1(paid.x - 14), y: r1(paid.y) } : null
    let end: { x: number; y: number } | null = null
    if (t.open) {
      // It runs on past its last scene, into the gap after that column, and stops at an open end.
      const last = points[points.length - 1]
      end = { x: r1(last.x + CARD_W / 2 + COL_GAP * 0.62), y: r1(last.y + CARD_H * 0.62 + (ti % 3) * 18) }
      d += ` C${r1(last.x + CARD_W * 0.7)} ${r1(last.y - 4)} ${r1(end.x - 6)} ${r1(end.y - CARD_H * 0.5)} ${end.x} ${end.y}`
    }
    strings.push({ id: t.id, ink: (ti % INKS) + 1, d, knot, end, sceneIds: ids })
  })

  return {
    columns: placed,
    cards,
    pins,
    next: { x: nextX, ghost: nextGhost },
    strings,
    width: nextX + CARD_W + PAD_X,
    height: tallest + PAD_BOTTOM
  }
}

/** A string from one pin to the next: across to a later column in a long curve, or down a column in a loop out to the right. */
function segment(p: { x: number; y: number }, q: { x: number; y: number }): string {
  if (Math.abs(q.x - p.x) < 1) {
    const loop = CARD_W / 2 + COL_GAP * 0.56
    return `C${r1(p.x + loop)} ${r1(p.y - 4)} ${r1(q.x + loop)} ${r1(q.y + 4)} ${r1(q.x)} ${r1(q.y)}`
  }
  const dx = q.x - p.x
  return `C${r1(p.x + dx * 0.72)} ${r1(p.y + 8)} ${r1(q.x - dx * 0.52)} ${r1(q.y)} ${r1(q.x)} ${r1(q.y)}`
}

/** Where a card dropped at `point` (board coordinates) lands: the column under it (or nearest), and its place in it. */
export function dropTarget(layout: BoardLayout, point: { x: number; y: number }, dragged: ID): { chapterId: ID; index: number } | null {
  if (!layout.columns.length) return null
  let best = layout.columns[0]
  let bestD = Infinity
  for (const c of layout.columns) {
    const mid = c.x + CARD_W / 2
    const dist = Math.abs(point.x - mid)
    if (dist < bestD) {
      bestD = dist
      best = c
    }
  }
  const others = [...layout.cards.values()].filter((c) => c.chapterId === best.id && c.id !== dragged).sort((a, b) => a.index - b.index)
  const index = others.filter((c) => c.y + c.h / 2 < point.y).length
  return { chapterId: best.id, index }
}

/**
 * While a card is dragged over a column, where the others in it move to make room (by how far down, in pixels):
 * those at or after the landing place step down one card; in the column it left, those after it step up.
 */
export function makeRoom(layout: BoardLayout, dragged: ID, target: { chapterId: ID; index: number } | null): Map<ID, number> {
  const out = new Map<ID, number>()
  const from = layout.cards.get(dragged)
  if (!from) return out
  const step = CARD_H + ROW_GAP
  for (const c of layout.cards.values()) {
    if (c.id === dragged) continue
    let dy = 0
    if (c.chapterId === from.chapterId && c.index > from.index) dy -= step
    if (target && c.chapterId === target.chapterId) {
      const at = c.chapterId === from.chapterId && c.index > from.index ? c.index - 1 : c.index
      if (at >= target.index) dy += step
    }
    if (dy) out.set(c.id, dy)
  }
  return out
}
