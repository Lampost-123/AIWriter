// The timeline (milestone 3): a story's scenes, and the events that exist by its end, along the
// in-world calendar, with who is where and the clashes between them. Pure: ipc/worldViews.ts reads
// the world and passes it in. Tested in timeline.test.ts.
//
// Order. Points are taken in reading order along the story's line (every scene on it; an event where
// it first exists, or at the very start). Each When text is read with when.ts; the ones that can be read
// are sorted by in-world date (reading order breaks ties), and each one that can't stays just after the
// point before it in reading order, marked "No date". Nothing is ever given a date it doesn't have.
//
// Clashes (spec: "a character in two places on the same day"): a character at the point of view or
// present in scenes on the same named in-world day whose locations differ. A place inside another (a
// hall inside the castle) isn't a different place for this.
import type { Entry, ID } from '@shared/types'
import type { Timeline, TimelineClash, TimelineEntry, TimelinePoint } from '@shared/contracts/worldViews'
import type { Line, MemoryData, WorldShape } from '../memory/types'
import { indexChanges, type MemoryStateAll } from '../memory/state'
import { labeler } from '../memory/line'
import type { CardInfo } from '../db/worldViews'
import { compareKeys, dayWords, parseWhen, placeWhens, type PlacedWhen } from './when'
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
    else after.set(last, [...(after.get(last) ?? []), i])
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

export function buildTimeline(input: TimelineInput): Timeline {
  const { storyId, shape, data, line, state, cards } = input
  const label = labeler(shape)
  const w = walkOf(line)
  const byId = new Map(data.entries.map((e) => [e.id, e]))
  const isKind = (id: ID | null, kind: Entry['kind']): id is ID => !!id && byId.get(id)?.kind === kind
  const changes = indexChanges(data.changes)

  // Events that exist by the story's end, at the step where they first exist.
  const pointsOf = new Map<ID, MemoryData['exists']>()
  for (const p of data.exists) pointsOf.set(p.entryId, [...(pointsOf.get(p.entryId) ?? []), p])
  const eventsAt = new Map<number, Draft[]>()
  for (const e of state.entries.values()) {
    if (e.kind !== 'event') continue
    const step = existsStep(w, pointsOf.get(e.id)) ?? -1
    const involved = state.relationships
      .filter((r) => r.aId === e.id || r.bId === e.id)
      .map((r) => (r.aId === e.id ? r.bId : r.aId))
      .filter((id) => isKind(id, 'character'))
    const list = eventsAt.get(step) ?? []
    list.push({
      kind: 'event',
      id: e.id,
      storyId: null,
      place: '',
      title: e.name.trim() || 'Unnamed event',
      when: (e.fields.when ?? '').trim(),
      povId: null,
      presentIds: [...new Set(involved)],
      locationId: null,
      setsUpIds: [],
      paysOffIds: [],
      step
    })
    eventsAt.set(step, list)
  }
  for (const list of eventsAt.values()) list.sort((a, b) => a.title.localeCompare(b.title))

  // Every point in reading order.
  const reading: Draft[] = [...(eventsAt.get(-1) ?? [])]
  line.steps.forEach((step, i) => {
    if (step.type === 'scene') {
      const card = cards.get(step.sceneId)
      const opened: ID[] = []
      const resolved: ID[] = []
      for (const c of changes.byScene.get(step.sceneId) ?? []) {
        if (c.kind !== 'thread' || !byId.has(c.entryId)) continue
        ;(c.payload.status === 'resolved' ? resolved : opened).push(c.entryId)
      }
      const pov = card && isKind(card.povId, 'character') ? card.povId : null
      reading.push({
        kind: 'scene',
        id: step.sceneId,
        storyId: step.storyId,
        place: label({ storyId: step.storyId, sceneId: step.sceneId }),
        title: card?.title.trim() || 'Untitled scene',
        when: (card?.when ?? '').trim(),
        povId: pov,
        presentIds: [...new Set([...(pov ? [pov] : []), ...(card?.presentIds ?? []).filter((id) => isKind(id, 'character'))])],
        locationId: card && isKind(card.locationId, 'place') ? card.locationId : null,
        setsUpIds: [...new Set([...(card?.setsUpIds ?? []), ...opened])].filter((id) => byId.has(id)),
        paysOffIds: [...new Set([...(card?.paysOffIds ?? []), ...resolved])].filter((id) => byId.has(id)),
        step: i
      })
    }
    for (const e of eventsAt.get(i) ?? []) reading.push(e)
  })

  const placed = placeWhens(reading.map((p) => p.when))
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
    for (const id of c.sceneIds) clashesAt.set(id, [...(clashesAt.get(id) ?? []), n])
  })
  for (const p of points) if (p.kind === 'scene') p.clashes = clashesAt.get(p.id) ?? []

  // The characters, places and threads the points refer to.
  const used = new Set<ID>()
  for (const p of points) {
    for (const id of [...p.presentIds, ...p.setsUpIds, ...p.paysOffIds]) used.add(id)
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
  // By character and day: the scenes with a location, in timeline order.
  const groups = new Map<string, { characterId: ID; scenes: TimelinePoint[] }>()
  for (const p of points) {
    if (p.kind !== 'scene' || !p.day || !p.locationId) continue
    for (const c of p.presentIds) {
      const key = `${c}\u0000${p.day}`
      const g = groups.get(key) ?? { characterId: c, scenes: [] }
      g.scenes.push(p)
      groups.set(key, g)
    }
  }
  const out: TimelineClash[] = []
  for (const { characterId, scenes } of groups.values()) {
    const places = [...new Set(scenes.map((s) => s.locationId!))]
    // The most specific places: a castle holding one of the halls is the same place as that hall.
    const apart = places.filter((a) => !places.some((b) => b !== a && isInside(byId, b, a)))
    if (apart.length < 2) continue
    const name = (id: ID): string => byId.get(id)?.name.trim() || 'an unnamed place'
    // The day in Adam's words, from a scene that names it outright rather than "the next day".
    const named = scenes.find((s) => {
      const p = parseWhen(s.when)
      return p && !p.step && p.day !== null
    })
    const day = named ? dayWords(named.when) : ''
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
