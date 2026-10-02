// The timeline (milestone 3): a story's scenes, and the events that exist by its end, along the
// in-world calendar, with who is where and the clashes between them. Pure: ipc/worldViews.ts reads
// the world and passes it in. Tested in timeline.test.ts.
//
// Order. Points are taken in reading order along the story's line (every scene on it; an event where
// it first exists, or at the very start). Each When text is read with when.ts; the ones that can be read
// are sorted by in-world date (reading order breaks ties), and each one that can't stays just after the
// point before it in reading order, marked "No date". Nothing is ever given a date it doesn't have.
// Each book that follows on has a calendar of its own (when.ts), so books that each count from "Day 1"
// aren't mixed together; a side story shares its host's calendar.
//
// Clashes (spec: "a character in two places on the same day"): a character at the point of view or
// present in scenes on the same named in-world day whose locations differ. A place inside another (a
// hall inside the castle) isn't a different place for this.
import type { Entry, ID, StoryKind } from '@shared/types'
import type { Timeline, TimelineClash, TimelineEntry, TimelinePoint } from '@shared/contracts/worldViews'
import type { Line, MemoryData, WorldShape } from '../memory/types'
import type { MemoryStateAll } from '../memory/state'
import { labeler } from '../memory/line'
import type { CardInfo } from '../db/worldViews'
import { compareKeys, dayName, placeWhens, type PlacedWhen, type WhenItem } from './when'
import { existsStep, walkOf } from './walk'

export interface TimelineInput {
  storyId: ID
  shape: WorldShape
  data: MemoryData
  /** The story's line through its end. */
  line: Line
  /** The memory at the story's end (which events exist, their When as of then, who is involved). */
  state: MemoryStateAll
  cards: Map<ID, CardInfo>
}

/**
 * The order to show points in, as indexes into the reading-order list: dated points by date (reading
 * order breaking ties), each followed by the undated points after it in reading order. Undated points
 * before the first dated one come first.
 */
export function timelineOrder(placed: (PlacedWhen | null)[]): number[] {
  const lead: number[] = []
  const after = new Map<number, number[]>()
  let last = -1
  placed.forEach((p, i) => {
    if (p) {
      last = i
      return
    }
    if (last < 0) lead.push(i)
    else {
      const list = after.get(last)
      if (list) list.push(i)
      else after.set(last, [i])
    }
  })
  const dated = placed
    .map((p, i) => ({ p, i }))
    .filter((x): x is { p: PlacedWhen; i: number } => !!x.p)
    .sort((a, b) => compareKeys(a.p.key, b.p.key) || a.i - b.i)
  return [...lead, ...dated.flatMap(({ i }) => [i, ...(after.get(i) ?? [])])]
}

const joinAnd = (xs: string[]): string => (xs.length < 2 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)

interface Draft extends Omit<TimelinePoint, 'dated' | 'day' | 'clashes'> {
  /** Step on the line, for events placed where they first exist. */
  step: number
}

/** Adds to a list kept in a map. */
function add<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

/** The ids in `a` then `b` that pass `keep`, each once. */
function joined(a: readonly ID[], b: readonly ID[], keep: (id: ID) => boolean): ID[] {
  const out: ID[] = []
  for (const id of a) if (keep(id) && !out.includes(id)) out.push(id)
  for (const id of b) if (keep(id) && !out.includes(id)) out.push(id)
  return out
}

export function buildTimeline(input: TimelineInput): Timeline {
  const { storyId, shape, data, line, state, cards } = input
  const label = labeler(shape)
  const w = walkOf(line)
  const byId = new Map(data.entries.map((e) => [e.id, e]))
  const isKind = (id: ID | null, kind: Entry['kind']): id is ID => !!id && byId.get(id)?.kind === kind
  const known = (id: ID): boolean => byId.has(id)
  const isCharacter = (id: ID): boolean => isKind(id, 'character')

  // Where the memory has each scene open or resolve a plot thread.
  const threadsAt = new Map<ID, { opened: ID[]; resolved: ID[] }>()
  for (const c of data.changes) {
    if (c.kind !== 'thread' || c.anchor !== 'scene' || !c.sceneId) continue
    const at = threadsAt.get(c.sceneId) ?? { opened: [], resolved: [] }
    ;(c.payload.status === 'resolved' ? at.resolved : at.opened).push(c.entryId)
    threadsAt.set(c.sceneId, at)
  }

  // Events that exist by the story's end, at the step where they first exist, with the characters
  // involved in them.
  const pointsOf = new Map<ID, MemoryData['exists']>()
  for (const p of data.exists) add(pointsOf, p.entryId, p)
  const involved = new Map<ID, ID[]>()
  for (const r of state.relationships) {
    if (state.entries.get(r.aId)?.kind === 'event' && isCharacter(r.bId)) add(involved, r.aId, r.bId)
    if (state.entries.get(r.bId)?.kind === 'event' && isCharacter(r.aId)) add(involved, r.bId, r.aId)
  }
  const eventsAt = new Map<number, Draft[]>()
  for (const e of state.entries.values()) {
    if (e.kind !== 'event') continue
    const step = existsStep(w, pointsOf.get(e.id)) ?? -1
    add(eventsAt, step, {
      kind: 'event',
      id: e.id,
      storyId: null,
      place: '',
      title: e.name.trim() || 'Unnamed event',
      when: (e.fields.when ?? '').trim(),
      povId: null,
      presentIds: [...new Set(involved.get(e.id) ?? [])],
      locationId: null,
      setsUpIds: [],
      paysOffIds: [],
      step
    })
  }
  for (const list of eventsAt.values()) list.sort((a, b) => a.title.localeCompare(b.title))

  // Every point in reading order, with how its date is read: each book that follows on starts a
  // calendar of its own, and events are read on their own.
  const kindOf = new Map<ID, StoryKind>(shape.stories.map((s) => [s.id, s.kind]))
  const reading: Draft[] = []
  const items: WhenItem[] = []
  let fresh = false
  let started = false
  const push = (d: Draft): void => {
    reading.push(d)
    items.push({ text: d.when, fresh, aside: d.kind === 'event' })
    fresh = false
  }
  for (const e of eventsAt.get(-1) ?? []) push(e)
  line.steps.forEach((step, i) => {
    if (step.type === 'start' && kindOf.get(step.storyId) !== 'side') {
      if (started) fresh = true
      started = true
    } else if (step.type === 'scene') {
      const card = cards.get(step.sceneId)
      const threads = threadsAt.get(step.sceneId)
      const pov = card && isKind(card.povId, 'character') ? card.povId : null
      push({
        kind: 'scene',
        id: step.sceneId,
        storyId: step.storyId,
        place: label({ storyId: step.storyId, sceneId: step.sceneId }),
        title: card?.title.trim() || 'Untitled scene',
        when: (card?.when ?? '').trim(),
        povId: pov,
        presentIds: joined(pov ? [pov] : [], card?.presentIds ?? [], isCharacter),
        locationId: card && isKind(card.locationId, 'place') ? card.locationId : null,
        setsUpIds: joined(card?.setsUpIds ?? [], threads?.opened ?? [], known),
        paysOffIds: joined(card?.paysOffIds ?? [], threads?.resolved ?? [], known),
        step: i
      })
    }
    for (const e of eventsAt.get(i) ?? []) push(e)
  })

  const placed = placeWhens(items)
  const points: TimelinePoint[] = timelineOrder(placed).map((i) => {
    const p = reading[i]
    return {
      kind: p.kind,
      id: p.id,
      storyId: p.storyId,
      place: p.place,
      title: p.title,
      when: p.when,
      dated: !!placed[i],
      day: placed[i]?.day ?? null,
      povId: p.povId,
      presentIds: p.presentIds,
      locationId: p.locationId,
      setsUpIds: p.setsUpIds,
      paysOffIds: p.paysOffIds,
      clashes: []
    }
  })

  const clashes = findClashes(points, byId)
  const clashesAt = new Map<ID, number[]>()
  clashes.forEach((c, n) => {
    for (const id of c.sceneIds) add(clashesAt, id, n)
  })
  for (const p of points) if (p.kind === 'scene') p.clashes = clashesAt.get(p.id) ?? []

  // The characters, places and threads the points refer to.
  const used = new Set<ID>()
  for (const p of points) {
    for (const id of p.presentIds) used.add(id)
    for (const id of p.setsUpIds) used.add(id)
    for (const id of p.paysOffIds) used.add(id)
    if (p.locationId) used.add(p.locationId)
  }
  const entries: TimelineEntry[] = [...used].flatMap((id) => {
    const e = byId.get(id)
    return e ? [{ id, kind: e.kind, name: e.name.trim() || 'Unnamed', image: e.image ?? null }] : []
  })

  return { storyId, points, entries, clashes }
}

/** Characters in two places on the same named day, in timeline order. */
export function findClashes(points: TimelinePoint[], byId: Map<ID, Entry>): TimelineClash[] {
  // By day and character: the scenes with a location, in timeline order. A day without a year is
  // already kept to its own story's calendar (when.ts), so books that each count from Day 1 never clash.
  const days = new Map<string, Map<ID, TimelinePoint[]>>()
  for (const p of points) {
    if (p.kind !== 'scene' || !p.day || !p.locationId) continue
    let who = days.get(p.day)
    if (!who) days.set(p.day, (who = new Map()))
    for (const c of p.presentIds) add(who, c, p)
  }
  const groups: { characterId: ID; scenes: TimelinePoint[] }[] = []
  for (const who of days.values()) for (const [characterId, scenes] of who) if (scenes.length > 1) groups.push({ characterId, scenes })
  const out: TimelineClash[] = []
  // In the order the first scene of each comes on the timeline.
  const order = new Map(points.map((p, i) => [p, i]))
  groups.sort((a, b) => order.get(a.scenes[0])! - order.get(b.scenes[0])!)
  for (const { characterId, scenes } of groups) {
    const places = [...new Set(scenes.map((s) => s.locationId!))]
    if (places.length < 2) continue
    // The most specific places: a castle holding one of the halls is the same place as that hall.
    const apart = places.filter((a) => !places.some((b) => b !== a && isInside(byId, b, a)))
    if (apart.length < 2) continue
    const name = (id: ID): string => byId.get(id)?.name.trim() || 'an unnamed place'
    // The day in plain words, from a scene that names it outright rather than "the next day".
    const day = scenes.map((s) => dayName(s.when)).find(Boolean)
    const who = byId.get(characterId)?.name.trim() || 'A character'
    out.push({
      characterId,
      sceneIds: scenes.map((s) => s.id),
      text: `${who} is in ${joinAnd(apart.map(name))} ${day ? `on ${day}` : 'on the same day'}.`
    })
  }
  return out
}

/** Whether `inner` is inside `outer` (following parent places). */
function isInside(byId: Map<ID, Entry>, inner: ID, outer: ID): boolean {
  const seen = new Set<ID>()
  for (let cur = byId.get(inner)?.parentId ?? null; cur && !seen.has(cur); cur = byId.get(cur)?.parentId ?? null) {
    if (cur === outer) return true
    seen.add(cur)
  }
  return false
}
