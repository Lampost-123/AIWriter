// Where each character sits on the relationship map. Pure and deterministic: the same characters and
// relationships always give the same places, whatever order they come in, with no randomness. Tested
// in layout.test.ts.
//
// It is a force layout (linked characters pull together, every pair pushes apart, a light pull to the
// middle keeps separate groups near), started from a spiral with the best-connected characters in the
// middle. The map lays out every relationship between characters the world has ever had, so moving the
// as-of slider only shows and hides characters: nobody moves. When relationships are added, the
// characters already placed keep their places (`fixed`) and only newcomers are fitted in around them.
import type { ID } from '@shared/types'

export interface LayoutGraph {
  nodes: { id: ID; name: string }[]
  /** Pairs of node ids. */
  edges: [ID, ID][]
}

export type Positions = Map<ID, { x: number; y: number }>

/** The length a relationship's line settles at, in map units (the interface draws one unit as one pixel at 100%). */
export const LINK_LENGTH = 170
/** No two characters end up closer than this. */
export const MIN_GAP = 96

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
 * Nodes bucketed into square cells, for finding the ones within a cell's width of each other. `near`
 * calls back with every later node (by index) in the same or a neighbouring cell, in a fixed order.
 */
function gridOf(x: Float64Array, y: Float64Array, n: number, size: number): { near: (i: number, visit: (j: number) => void) => void } {
  const cells = new Map<number, number[]>()
  const cellX = new Int32Array(n)
  const cellY = new Int32Array(n)
  // Cells as one number: a map of a world is never anywhere near a million cells across.
  const key = (gx: number, gy: number): number => gx * 1_000_003 + gy
  for (let i = 0; i < n; i++) {
    cellX[i] = Math.floor(x[i] / size)
    cellY[i] = Math.floor(y[i] / size)
    const k = key(cellX[i], cellY[i])
    const list = cells.get(k)
    if (list) list.push(i)
    else cells.set(k, [i])
  }
  return {
    near: (i, visit) => {
      for (let gx = cellX[i] - 1; gx <= cellX[i] + 1; gx++) {
        for (let gy = cellY[i] - 1; gy <= cellY[i] + 1; gy++) {
          const list = cells.get(key(gx, gy))
          if (list) for (const j of list) if (j > i) visit(j)
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
  ids.forEach((id, i) => {
    const p = fixed?.get(id)
    if (!p) return
    x[i] = p.x
    y[i] = p.y
    pinned[i] = 1
    pinnedCount++
    cx += p.x
    cy += p.y
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

  const moving = n - pinnedCount
  if (moving > 0) {
    const k = LINK_LENGTH
    const k2 = k * k
    const far = 2.5 * k
    const iterations = n <= 60 ? 300 : n <= 200 ? 160 : 90
    const dx = new Float64Array(n)
    const dy = new Float64Array(n)
    let heat = pinnedCount ? k * 0.6 : k * 1.5
    const cool = heat / (iterations + 1)
    for (let it = 0; it < iterations; it++) {
      dx.fill(0)
      dy.fill(0)
      // Every pair pushes apart. Pairs far apart are left alone, found through a grid of `far`-sized
      // cells, which keeps a world of hundreds of characters quick.
      const grid = gridOf(x, y, n, far)
      for (let i = 0; i < n; i++) {
        grid.near(i, (j) => {
          if (pinned[i] && pinned[j]) return
          let ex = x[i] - x[j]
          let ey = y[i] - y[j]
          if (ex > far || ex < -far || ey > far || ey < -far) return
          let d2 = ex * ex + ey * ey
          if (d2 < 0.01) {
            // Two in the same spot: part them in a fixed direction.
            const a = hash(ids[i] + ids[j]) * Math.PI * 2
            ex = Math.cos(a)
            ey = Math.sin(a)
            d2 = 1
          }
          const f = k2 / d2
          dx[i] += ex * f
          dy[i] += ey * f
          dx[j] -= ex * f
          dy[j] -= ey * f
        })
      }
      // Linked characters pull together.
      for (const [a, b] of edges) {
        const ex = x[a] - x[b]
        const ey = y[a] - y[b]
        const d = Math.sqrt(ex * ex + ey * ey) || 1
        const f = d / k
        dx[a] -= ex * f
        dy[a] -= ey * f
        dx[b] += ex * f
        dy[b] += ey * f
      }
      for (let i = 0; i < n; i++) {
        if (pinned[i]) continue
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

    // Finally, nobody sits on top of anybody: part pairs closer than the gap.
    for (let pass = 0; pass < 30; pass++) {
      let moved = false
      const grid = gridOf(x, y, n, MIN_GAP)
      for (let i = 0; i < n; i++) {
        grid.near(i, (j) => {
          if (pinned[i] && pinned[j]) return
          const ex = x[i] - x[j]
          const ey = y[i] - y[j]
          const d = Math.sqrt(ex * ex + ey * ey)
          if (d >= MIN_GAP) return
          moved = true
          const a = d > 0.01 ? Math.atan2(ey, ex) : hash(ids[i] + ids[j]) * Math.PI * 2
          const push = (MIN_GAP - d) / (pinned[i] || pinned[j] ? 1 : 2) + 0.5
          if (!pinned[i]) {
            x[i] += Math.cos(a) * push
            y[i] += Math.sin(a) * push
          }
          if (!pinned[j]) {
            x[j] -= Math.cos(a) * push
            y[j] -= Math.sin(a) * push
          }
        })
      }
      if (!moved) break
    }
  }

  ids.forEach((id, i) => out.set(id, pinned[i] ? fixed!.get(id)! : { x: Math.round(x[i]), y: Math.round(y[i]) }))
  return out
}
