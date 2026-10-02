// Pure helpers for the relationship map screen: who shows for a group, fitting the map to the window,
// zooming about a point, and the words for each relationship. Tested in mapLogic.test.ts.
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
/** Below this zoom the words on the lines are hidden, and below NAMES_ZOOM the names too, so a big map stays readable. */
export const LABELS_ZOOM = 0.6
export const NAMES_ZOOM = 0.35
/** Room kept around the map when it is fitted to the window (a portrait and its name). */
const FIT_PAD = 72

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

/** The view that fits these characters into a window of this size, centred (never zoomed in past 1). */
export function fitView(nodes: Pick<MapNode, 'x' | 'y'>[], width: number, height: number): View {
  if (!nodes.length || width <= 0 || height <= 0) return { tx: width / 2, ty: height / 2, k: 1 }
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const n of nodes) {
    minX = Math.min(minX, n.x)
    maxX = Math.max(maxX, n.x)
    minY = Math.min(minY, n.y)
    maxY = Math.max(maxY, n.y)
  }
  const w = maxX - minX + FIT_PAD * 2
  const h = maxY - minY + FIT_PAD * 2
  const k = clampZoom(Math.min(1, width / w, height / h))
  return { tx: width / 2 - ((minX + maxX) / 2) * k, ty: height / 2 - ((minY + maxY) / 2) * k, k }
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
