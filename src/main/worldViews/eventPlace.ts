// Where an event belongs in story time (Adam, 2026-10-17: "ensure events are placed at the correct place ALWAYS"). One
// rule for every event, whatever made it (a build, the memory keeper reading the text, Adam by hand, a recipe, the
// outline), and for everything that places one: the timeline (timeline.ts buildTimeline) and the writer's brief, which
// leaves out an event still to come (ai/context.ts datedAfter). Pure; tested in eventPlace.test.ts.
//
// - An event whose When can be placed on the calendar goes by its date: after the last scene of the story's present (not
//   a flashback) that isn't later than it. With no time of day that is after the last scene of its day; with one, among
//   that day's scenes by the time. A scene it is tied to (it was planned for that scene, or first exists there) keeps it
//   only when that scene is on its day, or is undated and sits where its date would put it: a scene that disagrees with
//   the date is ignored.
// - Before every scene of the present: backstory dated by a year stays before the story; a date counted in the story's
//   own days ("Day 0") goes just after the story's opening scene, never ahead of it.
// - An event with no date that can be placed: after the scene it is tied to, else after the scene read just before it
//   (where it first exists), else after the story's opening scene.
import { compareKeys, parseWhen } from './when'
import { dateOfText, elapsedBetween, type Calendar, type StoryDate } from '../memory/calendar'

/** -1: the event comes before the scene; 1: after it; 0: on the scene's day, with nothing to say which comes first. */
export type EventOrder = -1 | 0 | 1

/**
 * How an event's moment stands to a scene's. `days`: the event's day less the scene's (only its sign counts). A time of
 * day orders the two the same day only when both say one; an event tied to the scene (planned for it, or first there)
 * is at that scene on its day, whatever time it says.
 */
export function eventVsScene(days: number, eventMinute: number | null, sceneMinute: number | null, tied = false): EventOrder {
  if (days !== 0) return days < 0 ? -1 : 1
  if (tied || eventMinute === null || sceneMinute === null || eventMinute === sceneMinute) return 0
  return eventMinute < sceneMinute ? -1 : 1
}

/** A sort key's day: [year, calendar, month, day], without the time (worldViews/when.ts placeWhens). */
const dayOf = (key: readonly number[]): number[] => key.slice(0, 4)
/** A sort key's time of day in minutes, or null for none. */
const minuteOf = (key: readonly number[]): number | null => (Number.isFinite(key[4]) && key[4] >= 0 ? key[4] : null)
/** Whether two sort keys name the same day. */
export const sameKeyDay = (a: readonly number[], b: readonly number[]): boolean => compareKeys(dayOf(a), dayOf(b)) === 0

/** eventVsScene on two placeWhens sort keys. */
export function keyVsScene(event: readonly number[], scene: readonly number[], tied = false): EventOrder {
  return eventVsScene(compareKeys(dayOf(event), dayOf(scene)), minuteOf(event), minuteOf(scene), tied)
}

/**
 * Days from a scene's date to an event's When on the story calendar (the event's day less the scene's), or null when it
 * can't be told. Read as the scene card's landmarks are (memory/calendar.ts dateOfText, leaning on the scene); a bare
 * "Day N" in a story dated by the calendar counts from its first day, as the timeline counts it.
 */
export function eventDaysFrom(when: string, here: StoryDate, cal: Calendar = { dates: new Map([[here.id, here]]), order: [here.id] }): number | null {
  const gap = elapsedBetween(here, dateOfText(cal, when, here.id))
  if (gap) return gap.days
  const p = parseWhen(when)
  return p?.dayCount && p.day !== null && p.year === null && p.month === null && !p.qual && here.day !== null ? p.day - here.day : null
}

/** eventVsScene for an event's When and a scene's date on the story calendar; null when it can't be told. */
export function eventVsDate(when: string, here: StoryDate, tied = false, cal?: Calendar): EventOrder | null {
  const days = eventDaysFrom(when, here, cal)
  return days === null ? null : eventVsScene(days, parseWhen(when)?.minute ?? null, here.minute, tied)
}

/** A scene, in the order the timeline shows them (sorted by date, undated ones after the scene before them). */
export interface PlaceScene {
  /** Its placeWhens sort key; null when it can't be placed by date. */
  key: readonly number[] | null
  /** Its When says it goes back on purpose (when.ts goesBack): a flashback. */
  back: boolean
}

/** An event to place among the scenes. Scene numbers are indexes into the scene list. */
export interface PlaceEvent {
  /** Its placeWhens sort key, read in its own story's calendar; null when its When can't be placed by date. */
  key: readonly number[] | null
  /** Its date names a year (or takes its story's) rather than counting the story's own days: it may sit before the story. */
  backstory: boolean
  /** The scene it is tied to: the one it was planned for, or first exists at. */
  tied: number | null
  /** The scene read just before it, where it first exists (the scene it waited for, for one from a story's start). */
  read: number | null
  /** The scene its story opens with (for the world's start, the first on the line). */
  opening: number | null
}

/**
 * Where an event goes: after scene `after` (-1: before every scene), and its rank among the events placed there: 0 for
 * one dated before the story's first day and shown after its opening scene, 1 for one with no date (at the scene it is
 * tied to), 2 for one placed by its date or kept at its scene (in date order).
 */
export interface EventPlace {
  after: number
  rank: 0 | 1 | 2
}

/**
 * The scenes of the present (dated, not flashbacks), by their place in `scenes`, for placeEvent: they are in date order,
 * so the last one not later than an event can be found by halving.
 */
export function presentScenes(scenes: readonly PlaceScene[]): number[] {
  const out: number[] = []
  scenes.forEach((s, i) => {
    if (s.key && !s.back) out.push(i)
  })
  return out
}

/** Places an event among the scenes (see the top of this file). `present` is presentScenes(scenes), worked out once. */
export function placeEvent(e: PlaceEvent, scenes: readonly PlaceScene[], present: readonly number[] = presentScenes(scenes)): EventPlace {
  const key = e.key
  if (!key) return { after: e.tied ?? e.read ?? e.opening ?? -1, rank: 1 }
  if (e.tied !== null && agrees(key, e.tied, scenes, present)) return { after: e.tied, rank: 2 }
  // The last scene of the present the event isn't before.
  let lo = 0
  let hi = present.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (keyVsScene(key, scenes[present[mid]].key!) >= 0) lo = mid + 1
    else hi = mid
  }
  if (lo > 0) {
    let after = present[lo - 1]
    // Past the undated scenes read after that one, which the timeline shows with it.
    while (after + 1 < scenes.length && !scenes[after + 1].key && !scenes[after + 1].back) after++
    return { after, rank: 2 }
  }
  if (e.backstory) {
    // History before the story: among any flashbacks further back still.
    let after = -1
    scenes.forEach((s, i) => {
      if (s.key && compareKeys(s.key, key) <= 0) after = i
    })
    return { after, rank: 2 }
  }
  return { after: e.opening ?? e.read ?? e.tied ?? -1, rank: 0 }
}

/**
 * Whether the scene an event is tied to agrees with its date: the scene is on its day; or the scene is undated and the
 * dated scenes of the present around it leave room for that day (none before it later, none after it earlier).
 */
function agrees(key: readonly number[], at: number, scenes: readonly PlaceScene[], present: readonly number[]): boolean {
  const s = scenes[at]
  if (s.key) return sameKeyDay(key, s.key)
  const day = dayOf(key)
  for (const i of present) {
    const c = compareKeys(dayOf(scenes[i].key!), day)
    if (i < at && c > 0) return false
    if (i > at && c < 0) return false
  }
  return true
}
