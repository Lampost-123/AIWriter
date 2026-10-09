// The relationship map (milestone 3): characters joined by their relationships as of a point, seen
// along one story's line, with the groups they belong to there. Pure: ipc/worldViews.ts reads the world
// and passes it in. Tested in map.test.ts.
//
// The layout covers every relationship between characters the world has ever had (any story, any
// point), so the map keeps one arrangement as the slider moves and as Adam switches story: only who is
// shown changes. It is kept in the world too, so it looks the same after a restart. Groups are a filter,
// not drawn: a character belongs to a group when a relationship ties them to it ("member (lieutenant)",
// "leader"), unless it reads as being against it ("enemy", "outcast").
import type { AsOf, AsOfStop, Change, Entry, ID, RelationshipPayload } from '@shared/types'
import type { MapGroup, MapLink, MapNode, MapPlace, RelationshipMap } from '@shared/contracts/worldViews'
import type { Line, MemoryData } from '../memory/types'
import type { MemoryStateAll } from '../memory/state'
import { layoutGraph, type LayoutGraph, type Positions } from './layout'
import { existsStep, walkOf, type Walk } from './walk'

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

/** Where a world's layout is kept between runs of the app. */
export interface LayoutStore<W> {
  load(world: W): Positions | null
  save(world: W, positions: Positions): void
}

const samePlaces = (a: Positions, b: Positions | undefined): boolean =>
  !!b && a.size === b.size && [...a].every(([id, p]) => b.get(id)?.x === p.x && b.get(id)?.y === p.y)

/**
 * Keeps the last layout of each world: the same graph reuses it, and a changed graph keeps the places of
 * everyone already on it. With a store, the layout is read from the world the first time and written
 * back whenever it changes, so characters stay put from one run of the app to the next.
 */
export function createLayoutCache<W extends object>(store?: LayoutStore<W>): (world: W, graph: LayoutGraph) => Positions {
  const kept = new WeakMap<W, { key: string; positions: Positions }>()
  return (world, graph) => {
    const key = graphKey(graph)
    let last = kept.get(world)
    if (!last && store) {
      const saved = store.load(world)
      if (saved) last = { key: '', positions: saved }
    }
    if (last?.key === key) return last.positions
    const positions = layoutGraph(graph, last?.positions)
    kept.set(world, { key, positions })
    if (store && !samePlaces(positions, last?.positions)) store.save(world, positions)
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
  /** The story's whole line: who can appear anywhere on its slider. */
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

  const members = new Map<ID, Set<ID>>()
  for (const r of state.relationships) {
    const [person, group] =
      isChar(r.aId) && isGroup(r.bId) ? [r.aId, r.bId] : isChar(r.bId) && isGroup(r.aId) ? [r.bId, r.aId] : [null, null]
    if (!person || !group || !belongs(r.type)) continue
    members.set(group, (members.get(group) ?? new Set()).add(person))
  }

  const shown = new Set<ID>([...links.flatMap((l) => [l.aId, l.bId]), ...[...members.values()].flatMap((m) => [...m])])
  const nodes: MapNode[] = [...shown].flatMap((id) => {
    const e = state.entries.get(id)
    const p = positions.get(id)
    return e && p
      ? [{ id, name: e.name.trim() || 'Unnamed', image: e.image ?? null, x: p.x, y: p.y, role: (e.fields?.role ?? '').trim(), summary: (e.summary ?? '').trim() }]
      : []
  })
  nodes.sort((a, b) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1))

  // Who can appear anywhere on the slider, and the groups anyone belongs to there.
  const along = alongStory(line, data)
  const byId = new Map(data.entries.map((e) => [e.id, e]))
  const w = along.walk
  const point =
    (at.kind === 'scene' ? w.scene.get(at.sceneId) : at.kind === 'start' ? w.post.get(at.storyId) : w.end.get(at.storyId)) ?? Infinity
  const groups: MapGroup[] = [...new Set([...along.members.keys(), ...members.keys()])]
    .flatMap((id) => {
      const name = (state.entries.get(id)?.name ?? byId.get(id)?.name ?? '').trim() || 'Unnamed group'
      const now = [...(members.get(id) ?? [])].filter((m) => shown.has(m))
      const all = [...new Set([...(along.members.get(id) ?? []), ...now])].filter((m) => positions.has(m))
      const joined = along.joins.get(id)
      const hadMembers = now.length > 0 || (!!joined && joined.first <= point)
      return all.length ? [{ id, name, memberIds: now, allMemberIds: all, hadMembers, joinsLater: !!joined && joined.last > point }] : []
    })
    .sort((a, b) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1))
  const everyone: MapPlace[] = [...new Set([...along.characters, ...shown])].flatMap((id) => {
    const p = positions.get(id)
    return p ? [{ id, x: p.x, y: p.y }] : []
  })

  return { storyId, at, label, stops, nodes, links, groups, everyone, any: links.length > 0 || along.tied }
}

/** The relationships a change sets: one, or all of a full description's. */
const tiesOf = (c: Change): RelationshipPayload[] =>
  c.kind === 'relationship' ? [c.payload] : c.kind === 'full' ? (c.payload.relationships ?? []) : []

/**
 * Who the map can show anywhere along a story's line (before any story, at a story's start or in a
 * scene on it): characters tied to another character or belonging to a group, while they exist there,
 * and each group's members, with the first and last steps on the line where someone joins it (-1 from
 * the start; a member who only comes into the world later joins when they do). `tied` says whether any
 * two characters are tied anywhere along it.
 */
function alongStory(
  line: Line,
  data: MemoryData
): { characters: Set<ID>; members: Map<ID, Set<ID>>; joins: Map<ID, { first: number; last: number }>; tied: boolean; walk: Walk } {
  const kinds = new Map(data.entries.map((e) => [e.id, e.kind]))
  const scenes = new Set<ID>()
  const starts = new Set<ID>()
  for (const s of line.steps) {
    if (s.type === 'scene') scenes.add(s.sceneId)
    else if (s.type === 'start-changes') starts.add(s.storyId)
  }
  const w = walkOf(line)
  const pointsOf = new Map<ID, MemoryData['exists']>()
  for (const p of data.exists) {
    const list = pointsOf.get(p.entryId)
    if (list) list.push(p)
    else pointsOf.set(p.entryId, [p])
  }
  const firstAt = new Map<ID, number | null>()
  const existsAt = (id: ID): number | null => {
    let at = firstAt.get(id)
    if (at === undefined) firstAt.set(id, (at = existsStep(w, pointsOf.get(id))))
    return at
  }
  const there = (id: ID): boolean => existsAt(id) !== null

  const characters = new Set<ID>()
  const members = new Map<ID, Set<ID>>()
  const joins = new Map<ID, { first: number; last: number }>()
  let tied = false
  for (const c of data.changes) {
    const counts =
      c.anchor === 'baseline' ||
      (c.anchor === 'story-start' && !!c.storyId && starts.has(c.storyId)) ||
      (c.anchor === 'scene' && !!c.sceneId && scenes.has(c.sceneId))
    if (!counts) continue
    // Where on the line it happens: a change that counts has its scene or story set.
    const step = (c.anchor === 'scene' ? w.scene.get(c.sceneId!) : c.anchor === 'story-start' ? w.post.get(c.storyId!) : -1) ?? -1
    for (const r of tiesOf(c)) {
      const [a, b] = [c.entryId, r.otherId]
      const [ka, kb] = [kinds.get(a), kinds.get(b)]
      if (ka === 'character' && kb === 'character') {
        tied = true
        if (there(a)) characters.add(a)
        if (there(b)) characters.add(b)
        continue
      }
      const [person, group] = ka === 'character' && kb === 'group' ? [a, b] : kb === 'character' && ka === 'group' ? [b, a] : [null, null]
      if (!person || !group || !belongs(r.type) || !there(person)) continue
      characters.add(person)
      members.set(group, (members.get(group) ?? new Set()).add(person))
      const at = Math.max(step, existsAt(person) ?? -1)
      const seen = joins.get(group)
      joins.set(group, seen ? { first: Math.min(seen.first, at), last: Math.max(seen.last, at) } : { first: at, last: at })
    }
  }
  return { characters, members, joins, tied, walk: w }
}
