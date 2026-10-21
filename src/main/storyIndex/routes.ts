// How long it takes to get from one place to another (free rules, 2026-10-19). The live test on DeepSeek Flash invented
// travel times ("an hour in a cart" where Adam's notes said most of a day), so the app reads them, with no AI call:
// - `readJourneys`: the journeys a text states, "a day's ride", "three days by cart", "two days on foot", "half a day's
//   walk", "it took them four days to reach Carrow", "the ride from Linmouth to Carrow took three days", "a day east of
//   Ashby", each with how long and how (on foot, on horseback, by cart or coach, by boat, by train, or not said);
// - `routesIn`: those that join two codex places, one named and the other named too or the place the words are about
//   (a place entry's own text, or the scene card's place): "a day's ride from Linmouth" in Carrow's entry is Linmouth to
//   Carrow. A sentence naming three places, or a journey "from the coast" (no codex place), says nothing;
// - routes are story index facts (kind 'route', storyIndex/build.ts): from Adam's place entries (at the story's first
//   scene, so true from the start) and from narration that states a journey's length (at its scene). `routeSlot` and
//   `routeOfFact` write and read them;
// - `travelNeeds`: the least time a route can take (a day's journey is a morning to an evening, so 8 hours; three days
//   is two nights and a day, 56 hours), for the story index's "too fast" check (storyIndex/checks.ts);
// - `gettingHere` / `routeLine`: the writer's line "Getting here: Linmouth to Carrow is about 3 days by cart.", for the
//   planner to use (not wired into the briefing here).
// Pure but for `gettingHere`, which reads the story index. No Electron imports.

import type Database from 'better-sqlite3'
import type { Entry, ID } from '@shared/types'
import { findName } from '@shared/names'
import * as sidx from '../db/storyIndex'
import type { IndexOrigin, PlacedFact } from './types'

type DB = Database.Database

/** How a journey is made; null when the words don't say ("a day's journey"). */
export type TravelMode = 'foot' | 'horse' | 'wheels' | 'boat' | 'train'

/** A journey a text states. */
export interface Journey {
  /** Where its words are in the text. */
  start: number
  end: number
  /** The words that say how long ("a day's ride", "three days by cart"). */
  words: string
  /** How long, in hours (a day is 24). */
  hours: number
  /** The unit it was told in: an hour, or a day or more. */
  unit: 'hour' | 'day'
  /** "nearly", "about", "over": not to the hour. */
  hedged: boolean
  mode: TravelMode | null
  /** How, as the words say it, for a line: "by cart", "on horseback", "on foot", "by boat"; '' when not said. */
  how: string
}

/** A route between two codex places. */
export interface Route {
  /** The two places (in no particular order: a route goes both ways). */
  a: ID
  b: ID
  hours: number
  unit: 'hour' | 'day'
  hedged: boolean
  mode: TravelMode | null
  how: string
  /** The words it was read from. */
  words: string
}

/** A codex place, as the routes find it: its id and the names it goes by. */
export interface RoutePlace {
  id: ID
  name: string
  aliases?: string[]
}

// ---------- Reading how long ----------

// prettier-ignore
const SMALL: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11,
  twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90
}

/** A count in figures or words, as a pattern: "3", "three", "twenty-one", "a", "half a", "a couple of". */
export const COUNT = String.raw`(?:\d{1,3}|(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?|half\s+an?|a\s+couple\s+of|an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)`

/** The number a COUNT says (half a = 0.5); null for anything else. */
export function countOf(words: string): number | null {
  const w = words.toLowerCase().replace(/\s+/g, ' ').trim()
  if (/^\d+$/.test(w)) return Number(w)
  if (/^half an?$/.test(w)) return 0.5
  if (w === 'a couple of') return 2
  const parts = w.split(/[- ]/)
  if (parts.length === 2 && SMALL[parts[0]] >= 20 && SMALL[parts[1]] !== undefined && SMALL[parts[1]] < 10) return SMALL[parts[0]] + SMALL[parts[1]]
  return parts.length === 1 && SMALL[w] !== undefined ? SMALL[w] : null
}

/** Words that say a length isn't exact: "nearly a day", "over three days", "about a week". */
export const HEDGE = String.raw`(?:nearly|almost|over|more\s+than|less\s+than|under|about|around|some|roughly|at\s+least|barely|scarcely|hardly|just\s+over|just\s+under|close\s+to|well\s+over|the\s+best\s+part\s+of|the\s+better\s+part\s+of|most\s+of)`
const ADJ = String.raw`(?:(?:good|long|short|hard|easy|full|clear|steady|slow|fast|quick|weary|whole)\s+)?`
const UNIT = String.raw`(hour|day|night|week|fortnight|month)s?`
const HALF = String.raw`(\s+and\s+a\s+half)?`

/** Hours in each unit. */
const UNIT_HOURS: Record<string, number> = { hour: 1, day: 24, night: 24, week: 168, fortnight: 336, month: 720 }

/** The words for how a journey is made, and what each is. */
const MODE_WORDS: [RegExp, TravelMode | null, (w: string) => string][] = [
  [/^(?:ride|riding|horseback|horse|gallop|galloping)$/, 'horse', () => 'on horseback'],
  [/^(?:walk|walking|foot|march|marching|tramp|tramping|hike|trek)$/, 'foot', () => 'on foot'],
  [/^(?:cart|wagon|waggon|coach|carriage|trap|gig|drive|driving|stagecoach)$/, 'wheels', (w) => (/^driv/.test(w) ? 'by carriage' : `by ${w}`)],
  [/^(?:sail|sailing|boat|ship|sea|barge|ferry|rowing)$/, 'boat', (w) => (w === 'sea' ? 'by sea' : w === 'barge' ? 'by barge' : 'by boat')],
  [/^(?:train|rail|railway)$/, 'train', () => 'by train'],
  [/^(?:journey|travel|travelling|traveling|trip|road)$/, null, () => '']
]
const MODE = String.raw`(ride|riding|horseback|horse|gallop|galloping|walk|walking|foot|march|marching|tramp|tramping|hike|trek|cart|wagon|waggon|coach|carriage|trap|gig|drive|driving|stagecoach|sail|sailing|boat|ship|sea|barge|ferry|rowing|train|rail|railway|journey|travel|travelling|traveling|trip|road)`

function modeOf(word: string | undefined): { mode: TravelMode | null; how: string } {
  const w = (word ?? '').toLowerCase()
  for (const [re, mode, how] of MODE_WORDS) if (re.test(w)) return { mode, how: how(w) }
  return { mode: null, how: '' }
}

const DIRECTION = String.raw`(?:north|south|east|west|north-east|north-west|south-east|south-west|northeast|northwest|southeast|southwest|upriver|downriver|upstream|downstream|inland|up\s+the\s+coast|down\s+the\s+coast)`

/**
 * The ways a text says how long a journey takes, each with the groups (hedge, count, unit, half, mode) in that order:
 * "a day's ride", "three days by cart", "three days of riding", "it took them three days to reach", "the ride from X to Y
 * took three days", "a day east of X". A length with no journey ("a day's work", "three days since") is none.
 */
const JOURNEYS: { re: RegExp; groups: [number, number, number, number, number | null] }[] = [
  // "a day's ride", "three days' walk", "half a day's hard riding"
  { re: new RegExp(String.raw`\b(?:(${HEDGE})\s+)?(${COUNT})\s+${ADJ}${UNIT}${HALF}['’]s?\s+(?:hard\s+|easy\s+|steady\s+|slow\s+)?${MODE}\b`, 'giu'), groups: [1, 2, 3, 4, 5] },
  // "three days by cart", "two days on horseback", "a day on foot", "four days in a coach"
  { re: new RegExp(String.raw`\b(?:(${HEDGE})\s+)?(${COUNT})\s+${ADJ}${UNIT}${HALF}\s+(?:by|on|in\s+(?:a|the))\s+${MODE}\b`, 'giu'), groups: [1, 2, 3, 4, 5] },
  // "three days of riding"
  { re: new RegExp(String.raw`\b(?:(${HEDGE})\s+)?(${COUNT})\s+${ADJ}${UNIT}${HALF}\s+of\s+(?:hard\s+)?${MODE}\b`, 'giu'), groups: [1, 2, 3, 4, 5] },
  // "it took them four days to reach Carrow"
  {
    re: new RegExp(String.raw`\b(?:took|takes|take|taking)\s+(?:them|us|him|her|me|you|the\s+\w+)\s+(?:(${HEDGE})\s+)?(${COUNT})\s+${ADJ}${UNIT}${HALF}\s+to\s+(?:reach|get\s+to|come\s+to|cross\s+to|(ride|walk|sail|drive)\s+to)\b`, 'giu'),
    groups: [1, 2, 3, 4, 5]
  },
  // "the ride from Linmouth to Carrow took three days"
  {
    re: new RegExp(String.raw`\b${MODE}\s+(?:from\s+[^,.;!?]{1,60}?\s+)?(?:to\s+[^,.;!?]{1,60}?\s+)?(?:took|takes|was|is|had\s+taken)\s+(?:(${HEDGE})\s+)?(${COUNT})\s+${ADJ}${UNIT}${HALF}\b`, 'giu'),
    groups: [2, 3, 4, 5, 1]
  },
  // "a day east of Ashby", "two days north of Linmouth"
  { re: new RegExp(String.raw`\b(?:(${HEDGE})\s+)?(${COUNT})\s+${ADJ}${UNIT}${HALF}\s+${DIRECTION}\s+(?:of|from)\b`, 'giu'), groups: [1, 2, 3, 4, null] }
]

/** Every journey a text states (see JOURNEYS), in order, none overlapping. */
export function readJourneys(text: string): Journey[] {
  const found: Journey[] = []
  for (const { re, groups } of JOURNEYS) {
    re.lastIndex = 0
    for (const m of text.matchAll(re)) {
      const [h, c, u, half, md] = groups
      const n = countOf(m[c] ?? '')
      const unit = (m[u] ?? '').toLowerCase()
      if (n === null || !UNIT_HOURS[unit] || n <= 0) continue
      // "a month's journey" is a long way, but how long a month on the road takes isn't one sum; nothing under a month.
      const hours = (n + (m[half] ? 0.5 : 0)) * UNIT_HOURS[unit]
      const { mode, how } = modeOf(md === null ? undefined : m[md])
      const start = m.index ?? 0
      const end = start + m[0].length
      if (found.some((f) => start < f.end && f.start < end)) continue
      found.push({ start, end, words: m[0], hours, unit: unit === 'hour' ? 'hour' : 'day', hedged: !!m[h], mode, how })
    }
  }
  return found.sort((a, b) => a.start - b.start)
}

// ---------- Which places a journey joins ----------

/** The names a place goes by in prose: its name, other names, and its name without a leading "The". */
export function placeNames(p: RoutePlace): string[] {
  const out = new Set<string>()
  for (const n of [p.name, ...(p.aliases ?? [])]) {
    const t = n.replace(/\s+/g, ' ').trim()
    if (t.length < 3) continue
    out.add(t)
    const bare = t.replace(/^the\s+/i, '')
    if (bare !== t && bare.length >= 3 && /^\p{Lu}/u.test(bare)) out.add(bare)
  }
  return [...out]
}

/** The codex places a sentence names, longest name first, none overlapping, in order. */
export function placesIn(sentence: string, places: readonly RoutePlace[]): { id: ID; start: number; end: number }[] {
  const hits: { id: ID; start: number; end: number }[] = []
  const all = places.flatMap((p) => placeNames(p).map((n) => ({ id: p.id, n }))).sort((a, b) => b.n.length - a.n.length)
  for (const { id, n } of all) {
    let from = 0
    for (;;) {
      const r = findName(sentence.slice(from), n)
      if (!r) break
      const start = from + r.start
      const end = from + r.end
      if (!hits.some((h) => start < h.end && h.start < end)) hits.push({ id, start, end })
      from = end
    }
  }
  return hits.sort((a, b) => a.start - b.start)
}

/** The sentences of a text: start and end of each (a full stop, question or exclamation mark, or a line break ends one). */
export function sentencesOf(text: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = []
  const re = /[^.!?…\n]+(?:[.!?…]+["”’')\]]*|(?=\n)|$)/g
  for (const m of text.matchAll(re)) {
    const raw = m[0]
    const lead = raw.length - raw.trimStart().length
    const s = (m.index ?? 0) + lead
    const e = (m.index ?? 0) + raw.trimEnd().length
    if (e > s) out.push({ start: s, end: e })
  }
  return out
}

/** Words that point a journey somewhere: "from", "to", "between", "towards", "reach". */
const POINTER = /\b(?:from|to|between|towards?|reach|reached|reaching)\s+(?:the\s+)?([\p{L}'’-]+)/giu
/** What such a word may point at without naming another place: here, a direction, or a verb ("to reach", "to get there"). */
const NOT_A_PLACE =
  /^(?:here|there|home|it|them|us|him|her|me|you|north|south|east|west|north-east|north-west|south-east|south-west|northeast|northwest|southeast|southwest|reach|get|go|come|ride|walk|sail|drive|cross|travel|make|be|do|see|find|arrive|return)$/i

/**
 * The routes a text states between codex places (see the top of this file). `self`: the place the words are about (a
 * place entry's own text, the scene card's place), the other end of a journey that names only one place; null for none.
 */
export function routesIn(text: string, places: readonly RoutePlace[], self: ID | null): Route[] {
  const out: Route[] = []
  if (!places.length) return out
  // The journeys first, over the whole text (most texts have none), then the sentences they are in.
  const all = readJourneys(text)
  if (!all.length) return out
  for (const s of sentencesOf(text)) {
    if (!all.some((j) => j.start >= s.start && j.start < s.end)) continue
    const sentence = text.slice(s.start, s.end)
    const journeys = readJourneys(sentence)
    if (!journeys.length) continue
    const named = placesIn(sentence, places)
    const ids = [...new Set(named.map((n) => n.id))]
    let ends: [ID, ID] | null = null
    if (ids.length === 2) ends = [ids[0], ids[1]]
    else if (ids.length === 1 && self && self !== ids[0]) {
      // Every "from", "to" or "between" points at the place named (or "here"): "from the coast" is somewhere else.
      const elsewhere = [...sentence.matchAll(POINTER)].some((m) => {
        const at = (m.index ?? 0) + m[0].length - m[1].length
        return !named.some((n) => n.start <= at && at < n.end) && !NOT_A_PLACE.test(m[1])
      })
      if (!elsewhere) ends = [ids[0], self]
    }
    if (!ends || journeys.length > 1) continue
    const j = journeys[0]
    out.push({ a: ends[0], b: ends[1], hours: j.hours, unit: j.unit, hedged: j.hedged, mode: j.mode, how: j.how, words: j.words })
  }
  return out
}

/** The words of a place entry that may say how far it is from somewhere. */
export const placeEntryText = (e: Pick<Entry, 'summary' | 'description' | 'fields'>): string =>
  [e.summary, e.description, e.fields?.geography, e.fields?.history, e.fields?.people, e.fields?.atmosphere].filter(Boolean).join('\n')

/** The routes each codex place entry's own words state (the other end, when they name only one, is the entry itself). */
export function entryRoutes(entries: readonly Entry[]): { route: Route; entry: Entry }[] {
  const places = entries.filter((e) => e.kind === 'place').map((e) => ({ id: e.id, name: e.name, aliases: e.aliases ?? [] }))
  const out: { route: Route; entry: Entry }[] = []
  for (const e of entries) {
    if (e.kind !== 'place') continue
    const text = placeEntryText(e)
    if (text.trim()) for (const route of routesIn(text, places, e.id)) out.push({ route, entry: e })
  }
  return out
}

// ---------- As story index facts ----------

/** A route's slot in the story index: the other place, how and how long, so routes by other means never stop each other. */
export const routeSlot = (r: Pick<Route, 'b' | 'mode' | 'hours' | 'unit' | 'hedged'>): string =>
  `to:${r.b}|${r.mode ?? ''}|${r.hours}|${r.unit}${r.hedged ? '|~' : ''}`

/** A route as its fact's value says it: "about 3 days by cart". */
export function routeWords(r: Pick<Route, 'hours' | 'unit' | 'how'>): string {
  return `about ${lengthWords(r.hours, r.unit)}${r.how ? ` ${r.how}` : ''}`
}

/** A length in words: "half an hour", "2 hours", "half a day", "a day", "3 days", "a week", "2 weeks". */
export function lengthWords(hours: number, unit: 'hour' | 'day'): string {
  const round = (n: number): number => Math.round(n * 10) / 10
  if (unit === 'hour') {
    if (hours === 0.5) return 'half an hour'
    return hours === 1 ? 'an hour' : `${round(hours)} hours`
  }
  const days = hours / 24
  if (days === 0.5) return 'half a day'
  if (days === 1) return 'a day'
  if (days >= 7 && days % 7 === 0) return days === 7 ? 'a week' : `${days / 7} weeks`
  return `${round(days)} days`
}

/** What a route fact holds, read back; null for a fact that isn't one. */
export function routeOfFact(f: Pick<PlacedFact, 'kind' | 'entryId' | 'slot' | 'value' | 'quote'>): Route | null {
  if (f.kind !== 'route' || !f.entryId) return null
  const m = /^to:([^|]+)\|([a-z]*)\|([\d.]+)\|(hour|day)(\|~)?$/.exec(f.slot)
  if (!m) return null
  const hours = Number(m[3])
  if (!(hours > 0)) return null
  const how = f.value.replace(/^about\s+/, '').replace(/^(?:half an hour|an hour|[\d.]+ hours|half a day|a day|[\d.]+ days|a week|[\d.]+ weeks)\s*/, '')
  return { a: f.entryId, b: m[1], hours, unit: m[4] as 'hour' | 'day', hedged: !!m[5], mode: (m[2] || null) as TravelMode | null, how, words: f.quote }
}

// ---------- How long a route needs ----------

/**
 * The least time a route can take, in hours: a journey told in days is a morning to an evening of each (a day's ride is
 * at least 8 hours on the road; three days is two nights and a day, 56 hours); in hours, three quarters of it. "Nearly"
 * and the like take a quarter more off.
 */
export function travelNeeds(r: Pick<Route, 'hours' | 'unit' | 'hedged'>): number {
  const base = r.unit === 'hour' ? r.hours * 0.75 : r.hours < 24 ? (r.hours / 24) * 8 : (Math.ceil(r.hours / 24) - 1) * 24 + 8
  return r.hedged ? base * 0.75 : base
}

/** The quickest of some routes (what the "too fast" check holds a journey to: the one that asks least of it). */
export function quickest(routes: readonly Route[]): Route | null {
  return routes.reduce<Route | null>((best, r) => (!best || travelNeeds(r) < travelNeeds(best) ? r : best), null)
}

/** True when a route joins one of `here` to one of `there` (each a place and the places it is in), and neither end is in both. */
export function joins(r: Pick<Route, 'a' | 'b'>, here: readonly ID[], there: readonly ID[]): boolean {
  const only = (list: readonly ID[], other: readonly ID[], id: ID): boolean => list.includes(id) && !other.includes(id)
  return (only(here, there, r.a) && only(there, here, r.b)) || (only(here, there, r.b) && only(there, here, r.a))
}

// ---------- For the writer ----------

/** "Getting here: Linmouth to Carrow is about 3 days by cart." */
export const routeLine = (from: string, to: string, r: Pick<Route, 'hours' | 'unit' | 'how'>): string =>
  `Getting here: ${from} to ${to} is ${routeWords(r)}.`

/** A place and the places it is in, nearest first. */
export function placeChain(id: ID | null, parents: ReadonlyMap<ID, ID | null>): ID[] {
  const out: ID[] = []
  for (let p: ID | null = id; p && !out.includes(p); p = parents.get(p) ?? null) out.push(p)
  return out
}

/**
 * The writer's lines for how far the people on a scene's card have come (for the planner; not told by the briefing
 * here): for each of them whose last scene before this one in the story (on its card) was somewhere apart, with a route
 * known between the two places, "Getting here: Linmouth to Carrow is about 3 days by cart." Adam's own routes first,
 * then the quickest. [] when there is nothing to say, or the index has no row for the scene.
 */
export function gettingHere(db: DB, storyId: ID, sceneId: ID): string[] {
  const scenes = sidx.indexScenes(db, storyId)
  const at = scenes.findIndex((s) => s.sceneId === sceneId)
  const here = scenes[at]
  if (at < 0 || !here?.placeEntryId) return []
  const routes = sidx.storyRouteFacts(db, storyId)
  const parsed = routes.map((f) => ({ r: routeOfFact(f), origin: f.origin })).filter((x): x is { r: Route; origin: IndexOrigin } => !!x.r)
  if (!parsed.length) return []
  const parents = sidx.placeParents(db)
  const toChain = placeChain(here.placeEntryId, parents)
  const cards = new Set(here.present)
  const lines: string[] = []
  const said = new Set<string>()
  const names = sidx.entryNames(db, [...new Set(parsed.flatMap((x) => [x.r.a, x.r.b]))])
  for (const id of cards) {
    const before = [...scenes.slice(0, at)].reverse().find((s) => s.present.includes(id) && s.placeEntryId)
    if (!before?.placeEntryId) continue
    const fromChain = placeChain(before.placeEntryId, parents)
    const fits = parsed.filter((x) => joins(x.r, fromChain, toChain))
    if (!fits.length) continue
    const own = fits.filter((x) => x.origin === 'hand').map((x) => x.r)
    const r = quickest(own.length ? own : fits.map((x) => x.r))!
    const fromId = fromChain.includes(r.a) ? r.a : r.b
    const toId = fromId === r.a ? r.b : r.a
    const key = `${fromId}|${toId}`
    if (said.has(key)) continue
    said.add(key)
    const from = names.get(fromId)?.name
    const to = names.get(toId)?.name
    if (from && to) lines.push(routeLine(from, to, r))
  }
  return lines
}
