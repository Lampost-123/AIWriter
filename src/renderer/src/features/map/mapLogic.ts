// Pure helpers for the relationship map screen: who shows for a group, fitting the map to the window,
// zooming about a point, which names and words fit on screen, and the words for each relationship.
// Tested in mapLogic.test.ts.
import type { ID } from '@shared/types'
import type { MapLink, MapNode, RelationshipMap } from '@shared/contracts/worldViews'

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
 * but never so far that it can't be told apart. Names and the words on the lines stay the same size at
 * every zoom, so they can always be read.
 */
export const portraitScale = (k: number): number => Math.max(k, 0.6)

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
  const byRank = [...nodes].sort((a, b) => deg(b.id) - deg(a.id) || a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1))
  for (const n of byRank) {
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
    const label = tieLabel(t)
    if (!label) continue
    const w = Math.min(LABEL_MAX, label.length * LABEL_LETTER + 18)
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
