// What the free rules over words hold a scene's words to, read from the world (free rules, 2026-10-19; the rules are in
// timeClaims.ts and placeNames.ts): the scene's date on the story calendar and how sure its month, day, year and weekday
// are; the scene before it; whether the story only counts its days; the months and years the codex and the cards name;
// the codex's dated events, places and the routes its place entries state; and the scene card's place. The rule-based
// checks (ruleChecks.ts) and check and repair (repair/index.ts) both read it here, so they find the same things. No AI
// call; the calendar and the cards are kept as long as no date can move (memory/storyCalendar.ts). No Electron imports.

import type Database from 'better-sqlite3'
import type { Entry, ID } from '@shared/types'
import { firstNameOf } from '@shared/names'
import * as repo from '../db/repo'
import { labeler } from '../memory/line'
import { calendarCards, calendarOfScene, type StoryCalendar } from '../memory/storyCalendar'
import { civilFromDays, dateOfText, type StoryDate } from '../memory/calendar'
import { MONTH_NAMES, parseWhen } from '../worldViews/when'
import { shortPlace } from '../ai/mustStay'
import { entryRoutes, placeChain, type RoutePlace } from '../storyIndex/routes'
import type { FreeContext } from './freeRules'
import type { DatedEvent, EarlierScene, TimeContext } from './timeClaims'
import type { LockPlace } from './placeNames'

type DB = Database.Database

/** Day 0 of the Common Era count (1 January 1970) was a Thursday. */
const WEEKDAYS_FROM_THURSDAY = ['Thursday', 'Friday', 'Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday']
const MONTH_RE = new RegExp(`\\b(${MONTH_NAMES.join('|')})\\b`, 'g')
const YEAR_RE = /(?<![\p{L}\p{N}])(1\d{3}|2\d{3})(?![\p{L}\p{N}])/gu
const monthNo = (w: string): number => MONTH_NAMES.indexOf(w) + 1

/** What is sure of a date's month, day, year and weekday (see TimeContext). `own`: the card's own When. */
export function dateFacts(d: StoryDate | null, own: string): Pick<TimeContext, 'month' | 'day' | 'year' | 'weekday'> {
  const none = { month: null, day: null, year: null, weekday: null }
  if (!d) return none
  const year = d.year !== null && !d.yearWord ? d.year : null
  // A real date with a year: everything is sure, the weekday too.
  if (d.axis === 'g' && d.n !== null) {
    const [y, m, day] = civilFromDays(d.n)
    return { month: m, day, year: y, weekday: WEEKDAYS_FROM_THURSDAY[((d.n % 7) + 7) % 7] }
  }
  // A real date in a world's own years ("12 March, Year 3"), or with no year ("12 March").
  const dm = /^(\d{1,2}) (\p{L}+)/u.exec(d.date)
  if (d.axis?.startsWith('g') && dm && monthNo(dm[2]) > 0) return { month: monthNo(dm[2]), day: Number(dm[1]), year, weekday: null }
  // A counted day the cards place on the real calendar ("Day 25, Christmas Eve": Day 3 is 2 December).
  if (d.real) {
    const r = /^(?:(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday) )?(?:about \S+ |(\d{1,2}) )?(\p{L}+)(?: (\d{3,4}))?$/u.exec(d.real)
    if (r && monthNo(r[3]) > 0) return { month: monthNo(r[3]), day: r[2] ? Number(r[2]) : null, year: r[4] ? Number(r[4]) : null, weekday: r[1] ?? null }
  }
  // A month or season the card's own When names ("spring, 1820", "June 1820").
  const p = own.trim() ? parseWhen(own) : null
  if (p && p.month !== null && !p.step && !p.next && d.month !== null) {
    return { month: d.month, day: p.day !== null && !p.dayCount && Number.isInteger(d.month) ? p.day : null, year, weekday: null }
  }
  return { ...none, year }
}

/** Whether each story only counts its days (no card names a real month or year), kept with its calendar. */
const countedOf = new WeakMap<StoryCalendar, Map<ID, boolean>>()

/** True when a story counts its days ("Day 3") and no scene card of it names a real month or year. */
export function storyCounts(cal: StoryCalendar, storyId: ID): boolean {
  let byStory = countedOf.get(cal)
  if (!byStory) countedOf.set(cal, (byStory = new Map()))
  const kept = byStory.get(storyId)
  if (kept !== undefined) return kept
  let counts = false
  let real = false
  for (const [id, w] of cal.where) {
    if (w.storyId !== storyId) continue
    const d = cal.dates.get(id)
    if (!d) continue
    if (d.axis?.startsWith('g') || d.real || (d.year !== null && !d.yearWord) || (d.month !== null && Number.isInteger(d.month) && !d.dayCount)) real = true
    if (d.dayCount) counts = true
  }
  const out = counts && !real
  byStory.set(storyId, out)
  return out
}

/** The months and years some words name. */
function namedDates(text: string, months: Set<number>, years: Set<number>): void {
  for (const m of text.matchAll(MONTH_RE)) months.add(monthNo(m[1]))
  for (const m of text.matchAll(YEAR_RE)) years.add(Number(m[1]))
}

/** True when the memory made the entry from this scene's own words (never one of Adam's). */
export const fromThisScene = (e: Pick<Entry, 'origin' | 'originSceneId'>, sceneId: ID): boolean => e.origin !== 'adam' && e.originSceneId === sceneId

/** All of an entry's own words. */
const entryText = (e: Entry): string => [e.name, ...(e.aliases ?? []), e.summary, e.description, e.notes, ...Object.values(e.fields ?? {})].filter(Boolean).join('\n')

/**
 * What the free rules over words hold a scene's words to; null when the scene is gone. `entries`: the world's live
 * entries, when the caller has read them.
 */
export function freeContext(db: DB, sceneId: ID, entries: Entry[] = repo.listEntries(db)): FreeContext | null {
  let card
  try {
    card = repo.getScene(db, sceneId).card
  } catch {
    return null
  }
  const cal = calendarOfScene(db, sceneId)
  const at = cal?.where.get(sceneId)
  const storyId = at?.storyId ?? null
  const date = cal?.dates.get(sceneId) ?? null
  const storyTitle = storyId ? (cal?.shape.stories.find((s) => s.id === storyId)?.title ?? '') : ''
  const label = cal ? labeler(cal.shape) : null
  const sceneLabel = (id: ID): string => (label && storyId ? shortPlace(label({ storyId: cal!.where.get(id)?.storyId ?? storyId, sceneId: id }), storyTitle) : '')

  const places: (LockPlace & RoutePlace)[] = entries
    .filter((e) => e.kind === 'place')
    .map((e) => ({ id: e.id, name: e.name, aliases: e.aliases ?? [], parentId: e.parentId }))
  const parents = new Map(places.map((p) => [p.id, p.parentId] as const))
  const here = card.locationId && parents.has(card.locationId) ? card.locationId : null

  // The scene before in its story, and the last scene at a place before this one.
  const order = cal?.order ?? []
  const upTo = order.indexOf(sceneId)
  const earlier = (keep: (id: ID) => boolean): EarlierScene | null => {
    for (let i = upTo - 1; i >= 0; i--) {
      const id = order[i]
      if (cal!.where.get(id)?.storyId !== storyId || !keep(id)) continue
      const d = cal!.dates.get(id)
      return d ? { sceneId: id, label: sceneLabel(id), date: d } : null
    }
    return null
  }
  const previous = upTo > 0 ? earlier(() => true) : null
  let cards: ReturnType<typeof calendarCards> | null = null
  const lastAt = (placeId: ID): EarlierScene | null => {
    if (upTo <= 0) return null
    cards ??= calendarCards(db)
    return earlier((id) => {
      const loc = cards!.get(id)?.locationId ?? null
      return !!loc && placeChain(loc, parents).includes(placeId)
    })
  }

  // Months and years the codex and the story's cards name: never made up. Not an entry the memory made from this scene's
  // own words (checkfix, 2026-10-20): reading the scene before its check, the memory keeper makes its events ("Frost on a
  // raw March morning"), and the month made up in the words then read as one the codex names (the book's X13, caught
  // offline, passed on DeepSeek).
  const knownMonths = new Set<number>()
  const knownYears = new Set<number>()
  for (const e of entries) if (!fromThisScene(e, sceneId)) namedDates(entryText(e), knownMonths, knownYears)
  namedDates([card.when, card.notes, card.goal, card.conflict, card.outcome, ...(card.beats ?? [])].join('\n'), knownMonths, knownYears)
  if (cal && storyId) {
    cards ??= calendarCards(db)
    for (const [id, w] of cal.where) if (w.storyId === storyId) namedDates([cards.get(id)?.when ?? '', cards.get(id)?.goal ?? '', ...(cards.get(id)?.beats ?? [])].join('\n'), knownMonths, knownYears)
  }

  const events: DatedEvent[] = []
  if (cal) {
    for (const e of entries) {
      if (e.kind !== 'event' || !e.fields?.when?.trim()) continue
      const d = dateOfText(cal, e.fields.when, sceneId)
      if (d) events.push({ id: e.id, name: e.name, aliases: e.aliases ?? [], date: d })
    }
  }

  const routes: TimeContext['routes'] = entryRoutes(entries).map(({ route, entry }) => ({ ...route, entryId: entry.id, entryName: entry.name }))

  // Every other codex name: a place "of" someone ("Tobin's Mill", "Venn Lane") is no slip.
  const otherNames = new Set<string>()
  for (const e of entries) {
    if (e.kind === 'place') continue
    for (const n of [e.name, ...(e.aliases ?? [])]) {
      const t = n.replace(/\s+/g, ' ').trim().toLowerCase().replace(/[’‘]/g, "'")
      if (t.length < 2) continue
      otherNames.add(t)
      if (e.kind === 'character' || e.kind === 'group') {
        const first = firstNameOf(n)
        if (first) otherNames.add(first.toLowerCase())
        for (const w of t.split(' ')) if (w.length >= 3 && w !== 'the') otherNames.add(w)
      }
    }
  }

  const time: TimeContext = {
    date,
    ...dateFacts(date, card.when ?? ''),
    previous,
    counted: !!cal && !!storyId && storyCounts(cal, storyId),
    knownMonths,
    knownYears,
    events,
    lastAt,
    places,
    parents,
    here,
    routes
  }
  return { time, place: { places, chain: here ? placeChain(here, parents) : [], otherNames } }
}
