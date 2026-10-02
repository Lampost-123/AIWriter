// Pure helpers for the relationship map screen: who shows for a group, fitting the map to the window,
// zooming about a point, which names and words fit on screen, and the words for each relationship.
// Tested in mapLogic.test.ts.
import type { ID } from '@shared/types'
import { MAP_GAP, type MapLink, type MapNode, type RelationshipMap } from '@shared/contracts/worldViews'

/** How the map sits in its window: a point (x, y) on the map shows at (x * k + tx, y * k + ty). */
export interface View {
  tx: number
  ty: number
  k: number
}

export const MIN_ZOOM = 0.12
export const MAX_ZOOM = 2.5
/** A portrait's width at life size, in pixels. */
export const PORTRAIT = 44
/** The widest a name or a relationship's words get on screen before they are cut short. */
export const NAME_MAX = 124
export const LABEL_MAX = 150

/**
 * Room kept around the map when it is fitted to the window, in screen pixels, measured from the middle of
 * the outermost portraits: half a name at the sides, and at the bottom half a portrait and the name under
 * it, above the zoom buttons drawn over the map (50 pixels high with their margin).
 */
export const FIT_PAD = { x: 72, top: 36, bottom: 96 }

/**
 * How big a portrait is on screen at a zoom, as a share of life size: it shrinks as the map is zoomed out,
 * but no further than 60%, so it can still be told apart, unless that would make portraits touch. The
 * layout keeps characters MAP_GAP apart, so a portrait is never wider than nine tenths of that on screen.
 * Names and the words on the lines stay the same size at every zoom, so they can always be read.
 */
export const portraitScale = (k: number): number => Math.max(k, Math.min(0.6, (0.9 * MAP_GAP * k) / PORTRAIT))

/** The least zoom a map is opened fitted to everyone at: below it, too few names and words have room. */
export const READABLE_ZOOM = 0.5
/** The zoom a cast too big to fit readably opens at: from here on most names and many words have room. */
export const OPENING_ZOOM = 0.6

const clampZoom = (k: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k))

/** One line on the map: a pair of characters, with every relationship between them. */
export interface Tie {
  key: string
  a: MapNode
  b: MapNode
  links: MapLink[]
}

export const pairKey = (a: ID, b: ID): string => (a < b ? `${a}|${b}` : `${b}|${a}`)

/**
 * The characters and lines to draw: everyone at the point, or only the members of one group (and the
 * lines between them). Two relationships between the same pair share one line.
 */
export function visibleGraph(map: RelationshipMap, groupId: ID | null): { nodes: MapNode[]; ties: Tie[] } {
  const group = groupId ? map.groups.find((g) => g.id === groupId) : undefined
  const keep = groupId ? new Set(group?.memberIds ?? []) : null
  const nodes = keep ? map.nodes.filter((n) => keep.has(n.id)) : map.nodes
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const ties = new Map<string, Tie>()
  for (const l of map.links) {
    const a = byId.get(l.aId)
    const b = byId.get(l.bId)
    if (!a || !b) continue
    const key = pairKey(a.id, b.id)
    const tie = ties.get(key)
    if (tie) tie.links.push(l)
    else ties.set(key, { key, a, b, links: [l] })
  }
  return { nodes, ties: [...ties.values()] }
}

/**
 * The view that fits these characters into a window of this size, centred in the room left by `pad`
 * (never zoomed in past life size).
 */
export function fitView(points: Pick<MapNode, 'x' | 'y'>[], width: number, height: number, pad = FIT_PAD): View {
  if (!points.length || width <= 0 || height <= 0) return { tx: width / 2, ty: height / 2, k: 1 }
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const n of points) {
    minX = Math.min(minX, n.x)
    maxX = Math.max(maxX, n.x)
    minY = Math.min(minY, n.y)
    maxY = Math.max(maxY, n.y)
  }
  const w = width - pad.x * 2
  const h = height - pad.top - pad.bottom
  const k = clampZoom(Math.min(1, maxX > minX ? Math.max(w, 1) / (maxX - minX) : 1, maxY > minY ? Math.max(h, 1) / (maxY - minY) : 1))
  const cx = w > 0 ? pad.x + w / 2 : width / 2
  const cy = h > 0 ? pad.top + h / 2 : height / 2
  return { tx: cx - ((minX + maxX) / 2) * k, ty: cy - ((minY + maxY) / 2) * k, k }
}

/**
 * The view the map opens at: fitted to `points` (as fitView) when they can still be read that way. A cast
 * too big for that opens at OPENING_ZOOM with its best-connected character in the middle, moved only as
 * far as keeps empty space past the cast's edges out of the window. "Fit the map to the window" still
 * shows everyone.
 */
export function openingView(
  points: Pick<MapNode, 'x' | 'y'>[],
  nodes: MapNode[],
  ties: Tie[],
  width: number,
  height: number,
  pad = FIT_PAD
): View {
  const fit = fitView(points, width, height, pad)
  const best = byConnections(nodes, ties)[0]
  if (fit.k >= READABLE_ZOOM || !best) return fit
  const k = OPENING_ZOOM
  let [minX, minY, maxX, maxY] = [best.x, best.y, best.x, best.y]
  for (const p of points) {
    minX = Math.min(minX, p.x)
    maxX = Math.max(maxX, p.x)
    minY = Math.min(minY, p.y)
    maxY = Math.max(maxY, p.y)
  }
  /** The offset that puts `at` in the middle of the room from lo to hi, kept so the cast covers the room. */
  const place = (at: number, min: number, max: number, lo: number, hi: number): number => {
    if ((max - min) * k <= hi - lo) return (lo + hi) / 2 - ((min + max) / 2) * k
    return Math.min(lo - min * k, Math.max(hi - max * k, (lo + hi) / 2 - at * k))
  }
  return {
    k,
    tx: place(best.x, minX, maxX, pad.x, width - pad.x),
    ty: place(best.y, minY, maxY, pad.top, height - pad.bottom)
  }
}

/** Characters with the most relationships first (then by name), as labelsAt gives them room. */
function byConnections(nodes: MapNode[], ties: Tie[]): MapNode[] {
  const degree = new Map<ID, number>()
  for (const t of ties) {
    degree.set(t.a.id, (degree.get(t.a.id) ?? 0) + 1)
    degree.set(t.b.id, (degree.get(t.b.id) ?? 0) + 1)
  }
  const deg = (id: ID): number => degree.get(id) ?? 0
  return [...nodes].sort((a, b) => deg(b.id) - deg(a.id) || a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1))
}

/** Zooms by `factor`, keeping the map point under the window point (cx, cy) where it is. */
export function zoomAt(view: View, factor: number, cx: number, cy: number): View {
  const k = clampZoom(view.k * factor)
  if (k === view.k) return view
  const f = k / view.k
  return { k, tx: cx - (cx - view.tx) * f, ty: cy - (cy - view.ty) * f }
}

/** Moves the view so a map point is inside the window with some room around it (for a character reached with Tab). */
export function reveal(view: View, x: number, y: number, width: number, height: number, room = 80): View {
  const sx = x * view.k + view.tx
  const sy = y * view.k + view.ty
  const dx = sx < room ? room - sx : sx > width - room ? width - room - sx : 0
  const dy = sy < room ? room - sy : sy > height - room ? height - room - sy : 0
  return dx || dy ? { ...view, tx: view.tx + dx, ty: view.ty + dy } : view
}

/** The words on a line: "sister", or "rival, owes money" for two relationships. */
export const tieLabel = (tie: Tie): string => [...new Set(tie.links.map((l) => l.type).filter(Boolean))].join(', ')

/** How each feels, in sentences: "Mara feels betrayed. Tobin feels guilty." */
export function feelsText(link: MapLink, name: (id: ID) => string): string[] {
  const out: string[] = []
  if (link.aFeels) out.push(`${name(link.aId)} feels ${link.aFeels}`)
  if (link.bFeels) out.push(`${name(link.bId)} feels ${link.bFeels}`)
  return out
}

/** Where a relationship last changed, in words. */
export const whereText = (link: MapLink): string => (link.where ? `Last changed in ${link.where}` : 'Since before the story begins')

/**
 * A point on the slider inside a sentence: "Start of Book 1" reads "the start of Book 1"; a scene's place
 * stays as it is. Each number keeps to its word ("Sc 2"), so a sentence never wraps between them.
 */
export const inSentence = (label: string): string =>
  label.replace(/^(Start|End) of /, (_, w: string) => `the ${w.toLowerCase()} of `).replace(/ (?=\d)/g, '\u00a0')

/** A line's accessible name: who, how they are tied, and how each feels. */
export function tieName(tie: Tie, name: (id: ID) => string): string {
  const who = `${tie.a.name} and ${tie.b.name}`
  const parts = tie.links.map((l) => [l.type || 'tied', ...feelsText(l, name)].join('. '))
  return `${who}: ${parts.join('; ')}.`
}

/** "3 characters, 2 relationships". */
export function countText(nodes: number, ties: number): string {
  const n = (k: number, one: string, many: string): string => `${k} ${k === 1 ? one : many}`
  return `${n(nodes, 'character', 'characters')}, ${n(ties, 'relationship', 'relationships')}`
}

/** Rough widths of the words on the map, in screen pixels per letter (names at 12px, a line's words at 11px). */
const NAME_LETTER = 6.8
const LABEL_LETTER = 6.2

interface Box {
  x0: number
  y0: number
  x1: number
  y1: number
  /** A name may sit against its own portrait. */
  owner: string
}

/** Where along a line its words may sit, as shares of the way from one end: the middle first. */
const SPOTS = [0.5, 0.4, 0.6, 0.3, 0.7]

/** How wide a line's words are on screen, about. */
export const labelWidth = (t: Tie): number => Math.min(LABEL_MAX, tieLabel(t).length * LABEL_LETTER + 18)

/** The point a share of the way along a line, in map units. */
export const along = (t: Tie, at: number): { x: number; y: number } => ({
  x: t.a.x + (t.b.x - t.a.x) * at,
  y: t.a.y + (t.b.y - t.a.y) * at
})

/**
 * Which names and relationship words show at a zoom: as many as fit without covering a portrait or each
 * other, the best-connected characters first. A line's words sit in its middle, or a little to one side
 * when the middle is taken; `ties` says where, as a share of the way along the line. The rest show when
 * Adam points at a character or a line, reaches it with Tab, or zooms in.
 */
export function labelsAt(nodes: MapNode[], ties: Tie[], k: number): { names: Set<ID>; ties: Map<string, number> } {
  const r = (PORTRAIT / 2) * portraitScale(k)
  const degree = new Map<ID, number>()
  for (const t of ties) {
    degree.set(t.a.id, (degree.get(t.a.id) ?? 0) + 1)
    degree.set(t.b.id, (degree.get(t.b.id) ?? 0) + 1)
  }
  const deg = (id: ID): number => degree.get(id) ?? 0

  // Boxes in screen pixels (the pan doesn't matter), bucketed into cells to find neighbours quickly.
  const CELL = 64
  const cells = new Map<string, Box[]>()
  const each = (b: Box, visit: (key: string) => boolean | void): boolean => {
    for (let gx = Math.floor(b.x0 / CELL); gx <= Math.floor(b.x1 / CELL); gx++) {
      for (let gy = Math.floor(b.y0 / CELL); gy <= Math.floor(b.y1 / CELL); gy++) if (visit(`${gx},${gy}`) === false) return false
    }
    return true
  }
  const GAP = 2
  const covers = (b: Box, o: Box): boolean =>
    o.owner !== b.owner && b.x0 < o.x1 + GAP && o.x0 < b.x1 + GAP && b.y0 < o.y1 + GAP && o.y0 < b.y1 + GAP
  const free = (b: Box): boolean => each(b, (key) => !(cells.get(key) ?? []).some((o) => covers(b, o)))
  const put = (b: Box): void => {
    each(b, (key) => {
      const list = cells.get(key)
      if (list) list.push(b)
      else cells.set(key, [b])
    })
  }

  // Every portrait is drawn, so nothing may cover one.
  for (const n of nodes) put({ x0: n.x * k - r, y0: n.y * k - r, x1: n.x * k + r, y1: n.y * k + r, owner: n.id })

  const names = new Set<ID>()
  for (const n of byConnections(nodes, ties)) {
    const w = Math.min(NAME_MAX, n.name.length * NAME_LETTER + 12)
    const top = n.y * k + r + 3
    const box = { x0: n.x * k - w / 2, y0: top, x1: n.x * k + w / 2, y1: top + 18, owner: n.id }
    if (!free(box)) continue
    put(box)
    names.add(n.id)
  }

  const words = new Map<string, number>()
  const tiesByRank = [...ties].sort((a, b) => deg(b.a.id) + deg(b.b.id) - deg(a.a.id) - deg(a.b.id) || (a.key < b.key ? -1 : 1))
  for (const t of tiesByRank) {
    if (!tieLabel(t)) continue
    const w = labelWidth(t)
    for (const at of SPOTS) {
      const p = along(t, at)
      const [x, y] = [p.x * k, p.y * k]
      const box = { x0: x - w / 2, y0: y - 10, x1: x + w / 2, y1: y + 10, owner: t.key }
      if (!free(box)) continue
      put(box)
      words.set(t.key, at)
      break
    }
  }
  return { names, ties: words }
}

/**
 * Where along each line its words sit clear of every portrait at a zoom, as a share of the way along it:
 * for a line lit up by pointing whose words had no room among the others. A line with no clear spot is
 * left out (its words then sit in the middle, drawn over the portraits while it is lit).
 */
export function clearSpots(nodes: MapNode[], ties: Tie[], k: number): Map<string, number> {
  const r = (PORTRAIT / 2) * portraitScale(k)
  const out = new Map<string, number>()
  for (const t of ties) {
    const w = labelWidth(t)
    const at = [...SPOTS, 0.2, 0.8].find((s) => {
      const p = along(t, s)
      return !nodes.some((n) => Math.abs(n.x - p.x) * k < w / 2 + r + 2 && Math.abs(n.y - p.y) * k < 10 + r + 2)
    })
    if (at !== undefined) out.set(t.key, at)
  }
  return out
}

/**
 * Where the card telling how each feels about a line goes, in window pixels, kept in the window: under
 * the line's words, or above them, or off one of their corners (to the side of a slanting line away from
 * both its characters), or beside them, or under or over both characters (a short, level line); the
 * first that covers neither character (their portraits and names), else the one that covers least.
 * `words` is the middle of the line's words, `ends` its two characters where they are on screen, `r` a
 * portrait's radius on screen.
 */
export function cardPlace(
  card: { width: number; height: number },
  words: { x: number; y: number; width: number },
  ends: { x: number; y: number; name: string }[],
  r: number,
  room: { width: number; height: number }
): { left: number; top: number } {
  const { width: w, height: h } = card
  const [below, above] = [words.y + 16, words.y - 16 - h]
  const [rightOf, leftOf] = [words.x + 8, words.x - 8 - w]
  // Just clear of both characters, names included.
  const under = ends.reduce((y, e) => Math.max(y, e.y + r + 29), below)
  const over = ends.reduce((y, e) => Math.min(y, e.y - r - 8 - h), above)
  const candidates = [
    { left: words.x - w / 2, top: below },
    { left: words.x - w / 2, top: above },
    { left: rightOf, top: below - 4 },
    { left: leftOf, top: below - 4 },
    { left: rightOf, top: above + 4 },
    { left: leftOf, top: above + 4 },
    { left: words.x + words.width / 2 + 10, top: words.y - h / 2 },
    { left: words.x - words.width / 2 - 10 - w, top: words.y - h / 2 },
    { left: words.x - w / 2, top: under },
    { left: words.x - w / 2, top: over }
  ].map((c) => ({
    left: Math.max(8, Math.min(room.width - w - 8, c.left)),
    top: Math.max(8, Math.min(room.height - h - 8, c.top))
  }))
  // How much of a character, its portrait with its name under it, a place for the card covers.
  const covered = (c: { left: number; top: number }, e: { x: number; y: number; name: string }): number => {
    const half = Math.max(r, Math.min(NAME_MAX, e.name.length * NAME_LETTER + 12) / 2) + 4
    const across = Math.min(c.left + w, e.x + half) - Math.max(c.left, e.x - half)
    const down = Math.min(c.top + h, e.y + r + 25) - Math.max(c.top, e.y - r - 4)
    return across > 0 && down > 0 ? across * down : 0
  }
  let best = candidates[0]
  let least = Infinity
  for (const c of candidates) {
    const n = ends.reduce((sum, e) => sum + covered(c, e), 0)
    if (n < least) [best, least] = [c, n]
    if (!n) break
  }
  return best
}
