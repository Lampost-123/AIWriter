// The relationship map (milestone 3): characters joined by their relationships as of a point, seen
// along one story's line, with the groups they belong to there. Pure: ipc/worldViews.ts reads the world
// and passes it in. Tested in map.test.ts.
//
// The layout covers every relationship between characters the world has ever had (any story, any
// point), so the map keeps one arrangement as the slider moves and as Adam switches story: only who is
// shown changes. Groups are a filter, not drawn: a character belongs to a group when a relationship ties
// them to it ("member (lieutenant)", "leader"), unless it reads as being against it ("enemy", "outcast").
import type { AsOfStop, Entry, ID, RelationshipPayload } from '@shared/types'
import type { MapGroup, MapLink, MapNode, RelationshipMap } from '@shared/contracts/worldViews'
import type { AsOf } from '@shared/types'
import type { Line, MemoryData } from '../memory/types'
import type { MemoryStateAll } from '../memory/state'
import { layoutGraph, type LayoutGraph, type Positions } from './layout'

/** Ties to a group that don't make a character one of its members. */
const AGAINST =
  /\b(enem(y|ies)|rivals?|hunts?|hunted|hunting|outcasts?|exiled?|banished|former|ex|left|traitor|betrayed|oppos(es|ed|ing)|against|fights?|wanted by)\b/i

/** Whether a relationship to a group makes a character one of its members. */
export const belongs = (type: string): boolean => !AGAINST.test(type)

/** Every relationship between two characters, or between a character and a group, any change has ever made. */
export function worldGraph(data: MemoryData): LayoutGraph {
  const byId = new Map(data.entries.map((e) => [e.id, e]))
  const kind = (id: ID): Entry['kind'] | undefined => byId.get(id)?.kind
  const nodes = new Map<ID, string>()
  const edges: [ID, ID][] = []
  const add = (a: ID, r: RelationshipPayload): void => {
    const b = r.otherId
    if (!b || a === b) return
    const [ka, kb] = [kind(a), kind(b)]
    if (ka === 'character' && kb === 'character') {
      edges.push([a, b])
      nodes.set(a, byId.get(a)!.name)
      nodes.set(b, byId.get(b)!.name)
    } else if (ka === 'character' && kb === 'group') nodes.set(a, byId.get(a)!.name)
    else if (kb === 'character' && ka === 'group') nodes.set(b, byId.get(b)!.name)
  }
  for (const c of data.changes) {
    if (c.kind === 'relationship') add(c.entryId, c.payload)
    else if (c.kind === 'full') for (const r of c.payload.relationships ?? []) add(c.entryId, r)
  }
  return { nodes: [...nodes].map(([id, name]) => ({ id, name })), edges }
}

/** A key that changes whenever the graph does, so a layout can be kept until then. */
export function graphKey(g: LayoutGraph): string {
  const nodes = g.nodes.map((n) => n.id).sort()
  const edges = g.edges.map(([a, b]) => (a < b ? `${a}|${b}` : `${b}|${a}`))
  return `${nodes.join(',')}#${[...new Set(edges)].sort().join(',')}`
}

/**
 * Keeps the last layout of each world while it is open: the same graph reuses it, and a changed graph
 * keeps the places of everyone already on it.
 */
export function createLayoutCache(): (world: object, graph: LayoutGraph) => Positions {
  const kept = new WeakMap<object, { key: string; positions: Positions }>()
  return (world, graph) => {
    const key = graphKey(graph)
    const last = kept.get(world)
    if (last?.key === key) return last.positions
    const positions = layoutGraph(graph, last?.positions)
    kept.set(world, { key, positions })
    return positions
  }
}

/** How many relationships between characters change at each stop of a story's slider. */
export function countChanges(stops: AsOfStop[], data: MemoryData): AsOfStop[] {
  const chars = new Set(data.entries.filter((e) => e.kind === 'character').map((e) => e.id))
  const atScene = new Map<ID, number>()
  const atStart = new Map<ID, number>()
  const bump = (map: Map<ID, number>, id: ID | null, n: number): void => {
    if (id && n) map.set(id, (map.get(id) ?? 0) + n)
  }
  for (const c of data.changes) {
    if (!chars.has(c.entryId)) continue
    const n =
      c.kind === 'relationship'
        ? chars.has(c.payload.otherId)
          ? 1
          : 0
        : c.kind === 'full'
          ? Math.max(1, (c.payload.relationships ?? []).filter((r) => chars.has(r.otherId)).length)
          : 0
    if (c.anchor === 'scene') bump(atScene, c.sceneId, n)
    else if (c.anchor === 'story-start') bump(atStart, c.storyId, n)
  }
  return stops.map((s) => ({ ...s, changes: s.sceneId ? (atScene.get(s.sceneId) ?? 0) : (atStart.get(s.storyId) ?? 0) }))
}

export interface MapInput {
  storyId: ID
  at: AsOf
  label: string
  stops: AsOfStop[]
  data: MemoryData
  /** The memory at the point. */
  state: MemoryStateAll
  /** The story's whole line, to tell whether characters have any relationship along it. */
  line: Line
  positions: Positions
}

export function buildMap(input: MapInput): RelationshipMap {
  const { storyId, at, label, stops, data, state, line, positions } = input
  const isChar = (id: ID): boolean => state.entries.get(id)?.kind === 'character'
  const isGroup = (id: ID): boolean => state.entries.get(id)?.kind === 'group'

  const links: MapLink[] = state.relationships
    .filter((r) => isChar(r.aId) && isChar(r.bId))
    .map((r) => ({ aId: r.aId, bId: r.bId, type: r.type.trim(), aFeels: r.aFeels.trim(), bFeels: r.bFeels.trim(), where: r.where }))

  const members = new Map<ID, ID[]>()
  for (const r of state.relationships) {
    const [person, group] =
      isChar(r.aId) && isGroup(r.bId) ? [r.aId, r.bId] : isChar(r.bId) && isGroup(r.aId) ? [r.bId, r.aId] : [null, null]
    if (!person || !group || !belongs(r.type)) continue
    members.set(group, [...new Set([...(members.get(group) ?? []), person])])
  }
  const groups: MapGroup[] = [...members]
    .map(([id, memberIds]) => ({ id, name: state.entries.get(id)!.name.trim() || 'Unnamed group', memberIds }))
    .sort((a, b) => a.name.localeCompare(b.name))

  const shown = new Set<ID>([...links.flatMap((l) => [l.aId, l.bId]), ...groups.flatMap((g) => g.memberIds)])
  const nodes: MapNode[] = [...shown].flatMap((id) => {
    const e = state.entries.get(id)
    const p = positions.get(id)
    return e && p ? [{ id, name: e.name.trim() || 'Unnamed', image: e.image ?? null, x: p.x, y: p.y }] : []
  })
  nodes.sort((a, b) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1))

  return { storyId, at, label, stops, nodes, links, groups, any: links.length > 0 || anyAlong(line, data) }
}

/** Whether a relationship between characters is set anywhere along the line (before any story, at a story's start or in a scene). */
function anyAlong(line: Line, data: MemoryData): boolean {
  const chars = new Set(data.entries.filter((e) => e.kind === 'character').map((e) => e.id))
  const scenes = new Set<ID>()
  const starts = new Set<ID>()
  for (const s of line.steps) {
    if (s.type === 'scene') scenes.add(s.sceneId)
    else if (s.type === 'start-changes') starts.add(s.storyId)
  }
  return data.changes.some((c) => {
    if (!chars.has(c.entryId)) return false
    const others =
      c.kind === 'relationship' ? [c.payload.otherId] : c.kind === 'full' ? (c.payload.relationships ?? []).map((r) => r.otherId) : []
    if (!others.some((o) => chars.has(o))) return false
    return (
      c.anchor === 'baseline' ||
      (c.anchor === 'story-start' && !!c.storyId && starts.has(c.storyId)) ||
      (c.anchor === 'scene' && !!c.sceneId && scenes.has(c.sceneId))
    )
  })
}
