// Where each character sits on the relationship map. Pure and deterministic: the same characters and
// relationships always give the same places, whatever order they come in, with no randomness. Tested
// in layout.test.ts.
//
// It is a force layout (linked characters pull together, every pair pushes apart, a light pull to the
// middle keeps separate groups near), started from a spiral with the best-connected characters in the
// middle. The map lays out every relationship between characters the world has ever had, so moving the
// as-of slider only shows and hides characters: nobody moves. When relationships are added, the
// characters already placed keep their places (`fixed`) and only newcomers are fitted in around them.
//
// The map is shown in a window wider than it is tall, so the layout is worked out in a space squeezed
// from the sides (by WIDE) and then stretched back: a cast that would settle into a circle settles into
// a wider oval, which fills more of the window when the map is fitted to it, so more names and words fit.
import type { ID } from '@shared/types'
import { MAP_GAP } from '@shared/contracts/worldViews'

export interface LayoutGraph {
  nodes: { id: ID; name: string }[]
  /** Pairs of node ids. */
  edges: [ID, ID][]
}

export type Positions = Map<ID, { x: number; y: number }>

/** The length a relationship's line settles at, in map units (the interface draws one unit as one pixel at 100%). */
export const LINK_LENGTH = 170
/** No two characters end up closer than this (the map sizes portraits by it). */
export const MIN_GAP = MAP_GAP
/** How much wider than tall the layout is (WIDE x WIDE: a circle of characters becomes an oval about 1.4 times as wide). */
export const WIDE = 1.2

/** A small, stable number from a string (FNV-1a), for starting angles. */
function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 4294967296
}

const GOLDEN = Math.PI * (3 - Math.sqrt(5))

/**
 * Some nodes (`members`, by index) bucketed into square cells, for finding the ones within a cell's width
 * of a node. `near` calls back with every member in the same or a neighbouring cell as node i (a member
 * where it was when the grid was made, any other node where it is now), in a fixed order.
 */
function gridOf(
  x: Float64Array,
  y: Float64Array,
  members: readonly number[],
  size: number
): { near: (i: number, visit: (j: number) => void) => void } {
  const cells = new Map<number, number[]>()
  const cellX = new Int32Array(x.length)
  const cellY = new Int32Array(x.length)
  const member = new Uint8Array(x.length)
  // Cells as one number: a map of a world is never anywhere near a million cells across.
  const key = (gx: number, gy: number): number => gx * 1_000_003 + gy
  for (const i of members) {
    cellX[i] = Math.floor(x[i] / size)
    cellY[i] = Math.floor(y[i] / size)
    member[i] = 1
    const k = key(cellX[i], cellY[i])
    const list = cells.get(k)
    if (list) list.push(i)
    else cells.set(k, [i])
  }
  return {
    near: (i, visit) => {
      const cx = member[i] ? cellX[i] : Math.floor(x[i] / size)
      const cy = member[i] ? cellY[i] : Math.floor(y[i] / size)
      for (let gx = cx - 1; gx <= cx + 1; gx++) {
        for (let gy = cy - 1; gy <= cy + 1; gy++) {
          const list = cells.get(key(gx, gy))
          if (list) for (const j of list) visit(j)
        }
      }
    }
  }
}

/** Lays the graph out. `fixed`: places to keep for characters that already have one. */
export function layoutGraph(graph: LayoutGraph, fixed?: Positions): Positions {
  const ids = [...new Set(graph.nodes.map((n) => n.id))].sort()
  const n = ids.length
  const out: Positions = new Map()
  if (!n) return out
  const index = new Map(ids.map((id, i) => [id, i]))
  const names = new Map(graph.nodes.map((node) => [node.id, node.name]))

  // Each pair once, both ends known, in a stable order.
  const pairs = new Set<string>()
  const edges: [number, number][] = []
  for (const [a, b] of graph.edges) {
    const i = index.get(a)
    const j = index.get(b)
    if (i === undefined || j === undefined || i === j) continue
    const [lo, hi] = i < j ? [i, j] : [j, i]
    const key = `${lo}|${hi}`
    if (pairs.has(key)) continue
    pairs.add(key)
    edges.push([lo, hi])
  }
  edges.sort((p, q) => p[0] - q[0] || p[1] - q[1])
  const degree = new Array<number>(n).fill(0)
  const neighbours: number[][] = ids.map(() => [])
  for (const [a, b] of edges) {
    degree[a]++
    degree[b]++
    neighbours[a].push(b)
    neighbours[b].push(a)
  }

  const x = new Float64Array(n)
  const y = new Float64Array(n)
  const pinned = new Uint8Array(n)
  let pinnedCount = 0
  let cx = 0
  let cy = 0
  let reach = 0
  // Worked out in the squeezed space (see the top of the file); placed characters are squeezed to match.
  ids.forEach((id, i) => {
    const p = fixed?.get(id)
    if (!p) return
    x[i] = p.x / WIDE
    y[i] = p.y * WIDE
    pinned[i] = 1
    pinnedCount++
    cx += x[i]
    cy += y[i]
  })
  if (pinnedCount) {
    cx /= pinnedCount
    cy /= pinnedCount
    for (let i = 0; i < n; i++) if (pinned[i]) reach = Math.max(reach, Math.hypot(x[i] - cx, y[i] - cy))
  }

  // Newcomers start beside a placed neighbour, or on a spiral (outside anything already placed), the
  // best-connected first so they end up in the middle.
  const order = ids
    .map((_, i) => i)
    .filter((i) => !pinned[i])
    .sort((a, b) => degree[b] - degree[a] || (names.get(ids[a]) ?? '').localeCompare(names.get(ids[b]) ?? '') || (ids[a] < ids[b] ? -1 : 1))
  const placed = new Uint8Array(pinned)
  let spiral = 0
  for (const i of order) {
    const near = neighbours[i].filter((j) => placed[j])
    const angle = hash(ids[i]) * Math.PI * 2
    if (near.length) {
      const mx = near.reduce((s, j) => s + x[j], 0) / near.length
      const my = near.reduce((s, j) => s + y[j], 0) / near.length
      x[i] = mx + Math.cos(angle) * LINK_LENGTH * 0.8
      y[i] = my + Math.sin(angle) * LINK_LENGTH * 0.8
    } else {
      const r = (pinnedCount ? reach + LINK_LENGTH : 0) + LINK_LENGTH * 0.75 * Math.sqrt(spiral + 0.5)
      x[i] = cx + Math.cos(spiral * GOLDEN) * r
      y[i] = cy + Math.sin(spiral * GOLDEN) * r
      spiral++
    }
    placed[i] = 1
  }

  // Only the characters that move are pushed and pulled; the ones already placed are found once, through
  // grids that never change, so fitting a few newcomers into a big cast is quick.
  const movers: number[] = []
  const kept: number[] = []
  for (let i = 0; i < n; i++) (pinned[i] ? kept : movers).push(i)
  if (movers.length) {
    const k = LINK_LENGTH
    const k2 = k * k
    const far = 2.5 * k
    // A few newcomers start beside a neighbour already placed, so they settle in fewer rounds.
    const iterations = pinnedCount && movers.length * 4 <= n ? 50 : n <= 60 ? 300 : n <= 200 ? 160 : 90
    const dx = new Float64Array(n)
    const dy = new Float64Array(n)
    let heat = pinnedCount ? k * 0.6 : k * 1.5
    const cool = heat / (iterations + 1)
    const still = kept.length ? gridOf(x, y, kept, far) : null
    const pulls = edges.filter(([a, b]) => !pinned[a] || !pinned[b])
    /** Pushes i away from j, and j away from i when j moves too. */
    const repel = (i: number, j: number): void => {
      let ex = x[i] - x[j]
      let ey = y[i] - y[j]
      if (ex > far || ex < -far || ey > far || ey < -far) return
      let d2 = ex * ex + ey * ey
      if (d2 < 0.01) {
        // Two in the same spot: part them in a fixed direction.
        const a = hash(i < j ? ids[i] + ids[j] : ids[j] + ids[i]) * Math.PI * 2
        ex = i < j ? Math.cos(a) : -Math.cos(a)
        ey = i < j ? Math.sin(a) : -Math.sin(a)
        d2 = 1
      }
      const f = k2 / d2
      dx[i] += ex * f
      dy[i] += ey * f
      if (pinned[j]) return
      dx[j] -= ex * f
      dy[j] -= ey * f
    }
    for (let it = 0; it < iterations; it++) {
      dx.fill(0)
      dy.fill(0)
      // Every pair pushes apart. Pairs far apart are left alone, found through grids of `far`-sized
      // cells, which keeps a world of hundreds of characters quick.
      const grid = gridOf(x, y, movers, far)
      for (const i of movers) {
        grid.near(i, (j) => {
          if (j > i) repel(i, j)
        })
        still?.near(i, (j) => repel(i, j))
      }
      // Linked characters pull together.
      for (const [a, b] of pulls) {
        const ex = x[a] - x[b]
        const ey = y[a] - y[b]
        const d = Math.sqrt(ex * ex + ey * ey) || 1
        const f = d / k
        dx[a] -= ex * f
        dy[a] -= ey * f
        dx[b] += ex * f
        dy[b] += ey * f
      }
      for (const i of movers) {
        // A light pull to the middle keeps separate groups from drifting off.
        dx[i] -= (x[i] - cx) * 0.02
        dy[i] -= (y[i] - cy) * 0.02
        const d = Math.sqrt(dx[i] * dx[i] + dy[i] * dy[i])
        if (d > 0) {
          const step = Math.min(d, heat)
          x[i] += (dx[i] / d) * step
          y[i] += (dy[i] / d) * step
        }
      }
      heat -= cool
    }

    // Stretched back to the window's shape.
    for (let i = 0; i < n; i++) {
      x[i] *= WIDE
      y[i] /= WIDE
    }

    // Finally, nobody sits on top of anybody: part pairs closer than the gap.
    const stillGap = kept.length ? gridOf(x, y, kept, MIN_GAP) : null
    for (let pass = 0; pass < 30; pass++) {
      let moved = false
      /** Parts i (which moves) from j when they are too close: j moves its share too unless it is placed. */
      const part = (i: number, j: number): void => {
        const ex = x[i] - x[j]
        const ey = y[i] - y[j]
        const d = Math.sqrt(ex * ex + ey * ey)
        if (d >= MIN_GAP) return
        moved = true
        const a = d > 0.01 ? Math.atan2(ey, ex) : hash(i < j ? ids[i] + ids[j] : ids[j] + ids[i]) * Math.PI * 2 + (i < j ? 0 : Math.PI)
        const push = (MIN_GAP - d) / (pinned[j] ? 1 : 2) + 0.5
        x[i] += Math.cos(a) * push
        y[i] += Math.sin(a) * push
        if (pinned[j]) return
        x[j] -= Math.cos(a) * push
        y[j] -= Math.sin(a) * push
      }
      const grid = gridOf(x, y, movers, MIN_GAP)
      for (const i of movers) {
        grid.near(i, (j) => {
          if (j > i) part(i, j)
        })
        stillGap?.near(i, (j) => part(i, j))
      }
      if (!moved) break
    }

    // In a crowd the parting above can leave a newcomer still too close to someone (pushed off one
    // character onto another): it moves to the nearest free spot instead, on rings around where it is.
    // Only when fitting newcomers in: a first layout keeps what the forces give, which is quicker.
    if (pinnedCount) relocate(x, y, ids, movers)
  }

  ids.forEach((id, i) => out.set(id, pinned[i] ? fixed!.get(id)! : { x: Math.round(x[i]), y: Math.round(y[i]) }))
  return out
}

/** Moves each of `movers` that is closer than MIN_GAP to anyone to the nearest spot where it isn't, in a fixed order. */
function relocate(x: Float64Array, y: Float64Array, ids: string[], movers: readonly number[]): void {
  const key = (gx: number, gy: number): number => gx * 1_000_003 + gy
  const cellOf = (px: number, py: number): number => key(Math.floor(px / MIN_GAP), Math.floor(py / MIN_GAP))
  const cells = new Map<number, number[]>()
  const file = (i: number): void => {
    const list = cells.get(cellOf(x[i], y[i]))
    if (list) list.push(i)
    else cells.set(cellOf(x[i], y[i]), [i])
  }
  for (let i = 0; i < ids.length; i++) file(i)
  /** Whether anyone but i is closer than the gap to (px, py). */
  const crowded = (i: number, px: number, py: number): boolean => {
    const gx = Math.floor(px / MIN_GAP)
    const gy = Math.floor(py / MIN_GAP)
    for (let cx = gx - 1; cx <= gx + 1; cx++) {
      for (let cy = gy - 1; cy <= gy + 1; cy++) {
        for (const j of cells.get(key(cx, cy)) ?? NOBODY) {
          const ex = x[j] - px
          const ey = y[j] - py
          if (j !== i && ex * ex + ey * ey < MIN_GAP * MIN_GAP) return true
        }
      }
    }
    return false
  }
  for (const i of movers) {
    if (!crowded(i, x[i], y[i])) continue
    const list = cells.get(cellOf(x[i], y[i]))!
    list.splice(list.indexOf(i), 1)
    const start = hash(ids[i]) * Math.PI * 2
    search: for (let ring = 1; ring <= 40; ring++) {
      const steps = 6 * ring
      for (let s = 0; s < steps; s++) {
        const a = start + (s / steps) * Math.PI * 2
        const px = x[i] + Math.cos(a) * ring * MIN_GAP * 0.5
        const py = y[i] + Math.sin(a) * ring * MIN_GAP * 0.5
        if (crowded(i, px, py)) continue
        x[i] = px
        y[i] = py
        break search
      }
    }
    file(i)
  }
}

const NOBODY: readonly number[] = []
