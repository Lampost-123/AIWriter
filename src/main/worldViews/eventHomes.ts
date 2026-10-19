// Events in the scene they happen in (Adam, 2026-10-19: "all the events being added by the AI went right after the first
// chapter's scene as a long line, and not actually where they were supposed to be added in the timeline"). Builds before
// 0.7.7 made every event of a story's plan exist from the story's start, and the Story builder still lays its events out
// before the outline has scenes for them, so they wait at the start: the timeline can then place one only by its date,
// and with none (or one it can't read) they all sit just after the opening scene. This finds, from the record alone (no
// AI call), the scene such an event happens in, and moves it there; Undo puts it back. Used by "Put events in their
// place" on the timeline (ipc/worldViews.ts) and by keeping an outline (outline/structure.ts keepOutline). Tested in
// eventHomes.test.ts and eventPaths.test.ts.
//
// An event can move when all of these hold:
// - a World build made it for this story (the Story builder's and a recipe story's builds are World builds), and its
//   line in What changed isn't undone: never one Adam made himself;
// - it first exists at the story's (or the world's) start by default only: one first-exists point, not set by hand;
// - it doesn't belong before the story: the timeline (eventPlace.ts, as it shows it) doesn't put it ahead of the story's
//   scenes, and its When doesn't say it was long ago ("twenty years ago", "years earlier");
// - the record names its scene, strongest first:
//     text  the memory keeper read something of it in that scene's words (a source link, or a change it made there);
//     plan  the build's own words for it are that scene's line of the story's plan ("- Scene The Wreck: The Storm ...");
//     card  that scene's card (its title, goal or beats) names it;
//     date  its When falls on that scene's day on the story calendar: the first scene of the story's present on or
//           after its day (the World builder's rule, worldBuilder/save.ts sceneOnDay), or on the day itself when an
//           outline is kept (a later keep may hold its day's scene).
//   A scene its date disagrees with is passed over for the next reason. The story's opening scene is never a move: the
//   event is shown there already.
// Moving sets its first-exists point and its scene of origin to that scene, as a build that knew the scene makes it
// (worldBuilder/save.ts saveEntry), so working the default points out again keeps it there; the characters involved in
// it are involved from there on, as the memory reads a relationship only while both exist (memory/state.ts).
import type Database from 'better-sqlite3'
import type { Entry, EntryInput, EntryKind, ExistsPoint, ID } from '@shared/types'
import type { EventHome, EventHomeWhy, EventMove } from '@shared/contracts/worldViews'
import type { EntryMaking } from '../db/repo'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import { entryLinkScenes } from '../db/history'
import { builtEvents, existsPointPlace, liveSceneStory, originSceneOf, sceneCards, setExistsPointPlace, setOriginScene, textChangeScenes } from '../db/worldViews'
import { labeler } from '../memory/line'
import { storyCalendar, type StoryCalendar } from '../memory/storyCalendar'
import { bareName } from '../worldBuilder/names'
import { eventDaysFrom } from './eventPlace'
import { goesBack } from './when'
import { timelineOf } from './index'

type DB = Database.Database

/** A When that says the event was long before the story: it stays at the start. */
const LONG_AGO =
  /\b(?:ago|long before|before the story|before (?:it|all this|any of this) (?:all )?(?:began|begins|started|starts)|in the past|(?:years|months|decades|centuries|generations|ages) (?:before|earlier))\b/i

/** True when an event's When puts it before the story in words the calendar can't count ("twenty years ago"). */
export const longAgo = (when: string): boolean => !!when.trim() && (LONG_AGO.test(when) || goesBack(when))

/** A scene's line of a story's plan, as the World builder's summary writes it: "- Scene 2 (The Wreck): ..." or (before 0.7.7) "- Scene The Wreck: ...". */
const PLAN_LINE = /^\s*-\s*Scene\s+(?:(\d+)\s*(?:\(([^)]*)\))?|([^:]+?))\s*:/i

/** The scene title a build line's words give, when they are a scene's line of the story's plan; null otherwise. */
export function planTitle(quote: string): string | null {
  const m = PLAN_LINE.exec(quote)
  const title = (m?.[2] ?? m?.[3] ?? '').trim()
  return title || null
}

/** Whether a text names one of these names, as whole words (case, accents, punctuation and a leading "the" aside). */
export function namesIn(text: string, names: readonly string[]): boolean {
  const hay = ` ${bareName(text)} `
  return names.some((n) => {
    const b = bareName(n)
    return b.length >= 3 && hay.includes(` ${b} `)
  })
}

/** The story's scenes, read once for every event: in reading order, with their cards and dates. */
interface StoryScenes {
  storyId: ID
  /** Its scenes in reading order. */
  ids: ID[]
  index: Map<ID, number>
  /** What each scene's card says happens: its title, goal and beats. */
  text: Map<ID, string>
  title: Map<ID, string>
  cal: StoryCalendar | null
  /** Its first scene in reading order. */
  opening: ID | null
  /** Each event's place on the timeline before the story's first scene there (it belongs before the story). */
  before: Set<ID>
}

function storyScenes(db: DB, storyId: ID): StoryScenes | null {
  const cal = storyCalendar(db, storyId)
  if (!cal) return null
  const ids = cal.order.filter((id) => cal.where.get(id)?.storyId === storyId)
  const cards = sceneCards(db)
  const text = new Map<ID, string>()
  const title = new Map<ID, string>()
  for (const id of ids) {
    const c = cards.get(id)
    title.set(id, c?.title ?? '')
    text.set(id, [c?.title ?? '', c?.goal ?? '', ...(c?.beats ?? [])].join('\n'))
  }
  // What the timeline shows ahead of the story's own scenes belongs before it (backstory dated by a year, say).
  const before = new Set<ID>()
  const points = timelineOf(db, storyId).points
  const first = points.findIndex((p) => p.kind === 'scene' && p.storyId === storyId)
  if (first > 0) for (const p of points.slice(0, first)) if (p.kind === 'event') before.add(p.id)
  return { storyId, ids, index: new Map(ids.map((id, i) => [id, i])), text, title, cal, opening: ids[0] ?? null, before }
}

/** Days from a scene's date to the event's When; null when it can't be told. */
function daysAt(s: StoryScenes, when: string, sceneId: ID): number | null {
  const d = s.cal?.dates.get(sceneId)
  return d && when.trim() ? eventDaysFrom(when.trim(), d, s.cal!) : null
}

/** The scene an event's When falls on: the first of the story's present on (or, unless `exact`, after) its day. */
function dayScene(s: StoryScenes, when: string, exact: boolean): ID | null {
  if (!when.trim() || !s.cal) return null
  for (const id of s.ids) {
    const d = s.cal.dates.get(id)
    if (!d || d.back || !d.key) continue
    const days = eventDaysFrom(when.trim(), d, s.cal)
    if (days === null) continue
    if (days === 0 || (!exact && days < 0)) return id
  }
  return null
}

/** What the record says of the events: built for which story, the build's words, and the scenes the keeper read them in. */
interface Record_ {
  built: Map<ID, { runId: ID; quote: string }>
  read: Map<ID, Set<ID>>
}

function readRecord(db: DB): Record_ {
  const built = builtEvents(db)
  const ids = [...built.keys()]
  const read = new Map<ID, Set<ID>>()
  for (const m of [entryLinkScenes(db, ids), textChangeScenes(db, ids)])
    for (const [id, scenes] of m) for (const sc of scenes) (read.get(id) ?? read.set(id, new Set()).get(id)!).add(sc)
  return { built, read }
}

/** The one first-exists point an event waits at, when it can move: one point only, not set by hand, at a start. */
function waitingPoint(db: DB, e: Entry, storyId: ID): ExistsPoint | null {
  const points = mem.listExistsPoints(db, e.id)
  if (points.length !== 1) return null
  const p = points[0]
  if (p.byHand || p.kind === 'scene') return null
  if (p.kind !== 'world' && p.storyId !== storyId) return null
  return p
}

/** Where the record says an event happens, and why; null when it says nothing (or it belongs at the start). */
function homeOf(e: Entry, s: StoryScenes, rec: Record_, exact: boolean): { sceneId: ID; why: EventHomeWhy } | null {
  const when = (e.fields.when ?? '').trim()
  if (s.before.has(e.id) || longAgo(when)) return null
  // A scene its date disagrees with is passed over (an event read of later, or named on a card that recalls it).
  const agrees = (id: ID): boolean => {
    const days = daysAt(s, when, id)
    return days === null || days === 0
  }
  const first = (ids: Iterable<ID>): ID | null => {
    let best: ID | null = null
    for (const id of ids) {
      const i = s.index.get(id)
      if (i !== undefined && (best === null || i < s.index.get(best)!)) best = id
    }
    return best
  }
  const text = first([...(rec.read.get(e.id) ?? [])].filter(agrees))
  if (text) return { sceneId: text, why: 'text' }
  const said = planTitle(rec.built.get(e.id)?.quote ?? '')
  if (said) {
    const titled = s.ids.filter((id) => bareName(s.title.get(id) ?? '') === bareName(said))
    if (titled.length === 1 && agrees(titled[0])) return { sceneId: titled[0], why: 'plan' }
  }
  const names = [e.name, ...e.aliases]
  const card = s.ids.find((id) => namesIn(s.text.get(id) ?? '', names) && agrees(id))
  if (card) return { sceneId: card, why: 'card' }
  const day = dayScene(s, when, exact)
  return day ? { sceneId: day, why: 'date' } : null
}

export interface HomeOptions {
  /** Only moves to these scenes (the scenes an outline keep made); any of the story's when left out. */
  within?: ReadonlySet<ID>
  /** A date counts only on its day (keeping an outline), not the first scene after it. */
  exactDay?: boolean
}

/**
 * The events of a story that wait at its start and the scene the record says each happens in (see the top of this file),
 * in the order of those scenes. Changes nothing.
 */
export function eventHomes(db: DB, storyId: ID, o: HomeOptions = {}): EventHome[] {
  const rec = readRecord(db)
  if (!rec.built.size) return []
  const candidates = repo
    .getEntries(db, [...rec.built.keys()])
    .filter((e) => e.kind === 'event' && e.originStoryId === storyId && waitingPoint(db, e, storyId))
  if (!candidates.length) return []
  const s = storyScenes(db, storyId)
  if (!s || !s.ids.length) return []
  const label = labeler(mem.loadShape(db))
  const out: EventHome[] = []
  for (const e of candidates) {
    const home = homeOf(e, s, rec, !!o.exactDay)
    if (!home || home.sceneId === s.opening || (o.within && !o.within.has(home.sceneId))) continue
    const where = label({ storyId, sceneId: home.sceneId }).replace(/^.*?, (?=Ch \d)/, '')
    const title = (s.title.get(home.sceneId) ?? '').trim()
    out.push({ entryId: e.id, name: e.name, storyId, sceneId: home.sceneId, place: title ? `${where} “${title}”` : where, why: home.why })
  }
  return out.sort((a, b) => s.index.get(a.sceneId)! - s.index.get(b.sceneId)! || a.name.localeCompare(b.name))
}

/**
 * Moves each event to its scene (eventHomes' list), checking again that it still waits where it did. Returns what Undo
 * needs. Call inside a transaction with the rest of what it goes with.
 */
export function moveEvents(db: DB, homes: readonly EventHome[]): EventMove[] {
  const moves: EventMove[] = []
  for (const h of homes) {
    const e = repo.getEntries(db, [h.entryId])[0]
    const p = e ? waitingPoint(db, e, h.storyId) : null
    if (!e || !p) continue
    setExistsPointPlace(db, p.id, { kind: 'scene', storyId: h.storyId, sceneId: h.sceneId })
    setOriginScene(db, e.id, h.sceneId)
    moves.push({
      entryId: e.id,
      name: e.name,
      pointId: p.id,
      from: { kind: p.kind, storyId: p.storyId, sceneId: p.sceneId },
      originSceneId: e.originSceneId,
      storyId: h.storyId,
      sceneId: h.sceneId
    })
  }
  return moves
}

const EXISTS_KINDS = new Set(['world', 'story-pre', 'story-post', 'scene'])

/** A move as Undo is handed it back from the window, or null when it isn't one. */
function cleanMove(m: unknown): EventMove | null {
  if (!m || typeof m !== 'object') return null
  const x = m as Partial<EventMove>
  const str = (v: unknown): v is string => typeof v === 'string' && v !== ''
  const opt = (v: unknown): v is string | null => v === null || str(v)
  if (!str(x.entryId) || !str(x.pointId) || !str(x.sceneId) || !str(x.storyId) || !opt(x.originSceneId ?? null)) return null
  const f = x.from
  if (!f || !EXISTS_KINDS.has(f.kind) || !opt(f.storyId ?? null) || !opt(f.sceneId ?? null)) return null
  return {
    entryId: x.entryId,
    name: typeof x.name === 'string' ? x.name : '',
    pointId: x.pointId,
    from: { kind: f.kind, storyId: f.storyId ?? null, sceneId: f.sceneId ?? null },
    originSceneId: x.originSceneId ?? null,
    storyId: x.storyId,
    sceneId: x.sceneId
  }
}

/**
 * Undo: puts moved events back where they were, each only while it is still where it was moved to (a point Adam has set
 * by hand since, or moved again, stays). Returns the events put back.
 */
export function unmoveEvents(db: DB, moves: readonly unknown[]): ID[] {
  const back: ID[] = []
  for (const raw of Array.isArray(moves) ? moves : []) {
    const m = cleanMove(raw)
    if (!m) continue
    const p = existsPointPlace(db, m.pointId)
    if (!p || p.entryId !== m.entryId || p.byHand || p.kind !== 'scene' || p.sceneId !== m.sceneId) continue
    setExistsPointPlace(db, m.pointId, m.from)
    if (originSceneOf(db, m.entryId) === m.sceneId) setOriginScene(db, m.entryId, m.originSceneId)
    back.push(m.entryId)
  }
  return back
}

/**
 * How an entry Adam makes from a scene is made (repo.createEntry): an event first exists at that scene (it happens
 * there, as one the memory finds in the scene's words does), in that scene's story; anything else, and an event with no
 * live scene, as usual.
 */
export function makingAt(db: DB, kind: EntryKind, input: EntryInput | undefined, at: { sceneId?: unknown } | null | undefined): EntryMaking {
  const sceneId = typeof at?.sceneId === 'string' ? at.sceneId : ''
  if (kind !== 'event' || !sceneId) return { origin: 'adam' }
  const storyId = liveSceneStory(db, sceneId)
  return storyId ? { origin: 'adam', originStoryId: storyId, originSceneId: sceneId } : { origin: 'adam', originStoryId: input?.originStoryId ?? null }
}
