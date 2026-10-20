// The story calendar (long story memory fix 11, 2026-10-16). Time slips are among the commonest errors in long stories
// (ConStory-Bench) and the hardest questions in NovelQA, and models are bad at sums they have to make for themselves
// ("three weeks since the siege", how old someone is now). So the app, not the model, works out each scene's in-story
// date where it can be known, and the sums between dates: no new AI call, no store (it is worked out from the scene
// cards whenever it is needed, as the timeline is), and nothing invented.
//
// Where a scene's date comes from, in order:
// - Adam's own words in the card's When, read as the timeline reads them (worldViews/when.ts: "12 March 1820", "Day 3,
//   evening", "Year 2 of the reign, spring", "the next morning", "three weeks later", "that night"), in the walk's
//   reading order: what a When leaves out comes from the dated scene before it in its story; a side story leans on its
//   host where it starts, a book that follows on on the book before (unless a time gap lies between), and a book that
//   counts its days afresh starts a calendar of its own. Scenes are read in the line's order (`line.steps`), a side
//   story where it is added in its host, as the promises ledger reads them (fix 10).
// - Otherwise the time of day the memory read from the scene's own words (where things stand at its end:
//   continuity/tracker.ts `timeCues`), as a time of day only: it never names a day (`withCues`).
// - Otherwise nothing: the date isn't known, and nothing is made up.
//
// Sums. Each date that names its day exactly sits on an axis the app can count days along, with its day on it (`axis`,
// `n`): real months with a year are one axis for every story (days from the Common Era, months of their real length,
// leap years too), "Day 41" counts are an axis per year and calendar, and a month the app doesn't know ("the 3rd of
// Frostmoon") is an axis of its own. Two dates on one axis are a sum of days apart; dates that only name a month or
// season and a year, or only a year, are about so many months or years apart (`elapsedBetween`). So a world with
// months of its own still gets its sums, as long as its days are counted or stepped ("two days later"). Each date also
// has its day since the story began (`day`): Adam's own count where the story counts its days with a bare "Day 41" (day
// 41), else days since the first dated day of its calendar that isn't a flashback (that day is day 1; none before it).
// A count with a year or season ("Day 300, Year 1") is a day of that year: within the year the sums work, but across
// years how far apart isn't known. Impossible dates ("31 April 1820", "29 February 1821") are no dates, and years before
// Christ count through zero (1 BC is year 0), so sums cross the BC/AD line right.
//
// Going back. A scene whose date comes before the last scene before it that isn't a flashback, where that is certain
// (same axis, or the same day with times of day whose spans don't meet: "night" after "11pm" may be the same hour), and
// whose When doesn't say it goes back on purpose, is listed by `goingBack`, for the rule-based checks (fix 8, checks/rules.ts). A When
// saying it goes back on purpose (worldViews/when.ts goesBack) starts "Flashback" or "Earlier" (the app has no other
// mark for a flashback), or steps back itself ("three days earlier", "the night before"). The present carries on from
// the present: a scene after a flashback is dated from the scene before the flashback.
//
// Ages (`readAge`, `ageFrom`): from a character's "Age or birth date" field, a birth date or year ("born 12 March 1790",
// "b. 1790"), or an age at a date ("17 in 1815", "34 at the start of the story", or a bare "34" as of where it was set),
// worked out for the scene's date. Pure: memory/storyCalendar.ts reads the world and passes it in. Tested in
// calendar.test.ts.

import type { ID } from '@shared/types'
import {
  MONTH_NAMES,
  dayName,
  goesBack,
  monthLength,
  parseWhen,
  placeWhens,
  whenStates,
  type WhenParts,
  type WhenState,
  type WhenStory
} from '../worldViews/when'

export { goesBack } from '../worldViews/when'

/** A scene to place on the calendar, in reading order. */
export interface CalendarItem {
  id: ID
  /** The story it is in: what its When leaves out comes from that story's dated scenes before it (WhenStory says where a story carries on from). */
  story: ID
  /** Adam's own words in the card's When ('' for none). */
  when: string
}

/** How a scene's When was read. */
export type DateReading =
  /** No When: the date isn't known (a time of day may come from the memory). */
  | 'empty'
  /** Read, as far as it says (it may name only a season, a year or a time of day). */
  | 'read'
  /** Nothing in it could be read as a date or a time ("after the wedding"). */
  | 'unclear'
  /** It counts from the scene before ("the next morning"), and no scene before it names a day to count from. */
  | 'unanchored'
  /** "Days later", "years later": the order is known, but not how far on, so no day is counted from here. */
  | 'vague'

/** One scene's in-story date, as far as it is known. */
export interface StoryDate {
  id: ID
  /** Adam's own words in the card's When ('' for none). */
  when: string
  reading: DateReading
  /** The axis its day is counted on, and its day there (see above); null when the day isn't known exactly. */
  axis: string | null
  n: number | null
  /** Its day since the story began (see above); null when it can't be told. */
  day: number | null
  /** About when, for sums in months or years when the day isn't known: the year, and the month (a season between months). */
  year: number | null
  month: number | null
  /** Whether a year is told with a word ("Year 3") rather than a number ("1820"): two kinds of year are never compared. */
  yearWord: boolean
  /** Its day is a count ("Day 41"), which may run across years: never compared by its year alone. */
  dayCount: boolean
  /** The calendar a date without a year is counted in (a book that counts its days afresh has its own). */
  cal: number
  /** Minutes after midnight, or null when no time of day is known. */
  minute: number | null
  /** The time of day in words, as typed but in lower case ("evening", "first light", "3pm"); '' for none. */
  time: string
  /** How far that time of day reaches (worldViews/when.ts SPANS: "night" is 20:00 to 03:00, "11pm" exact); null for none. */
  span: [number, number] | null
  /** Where the time of day came from: the card's When, or the memory's reading of the scene's words. */
  timeFrom: 'card' | 'memory' | null
  /** The day in plain words: "Day 41", "Day 41, Year 3", "12 March 1820", "the 3rd of Frostmoon"; '' when it can't be said. */
  date: string
  /** The When leans on the scenes before: a step ("the next morning"), a time of day alone, or a year or month carried over. */
  leans: boolean
  /** The When says it goes back in time on purpose: it starts "Flashback" or "Earlier", or steps back ("three days earlier"). */
  back: boolean
  /** Sort key along the in-world calendar (worldViews/when.ts compareKeys); null when it can't be placed among the others. */
  key: number[] | null
  /**
   * A counted day on the real calendar, where a scene's When names a real day beside its count ("Day 25, Christmas Eve"):
   * "2 December", "Sunday 2 December 1923", "about early December". Left out when it isn't known.
   */
  real?: string
}

/** Every scene's date, by id, in reading order. */
export interface Calendar {
  dates: Map<ID, StoryDate>
  /** The scene ids in reading order. */
  order: ID[]
}

// ---------- Days on the Common Era calendar ----------

/** Days from 1 January 1970 to a day of a real month (months of their real length, leap years too; day 32 runs on). */
export function daysFromCivil(year: number, month: number, day: number): number {
  const y = year - (month <= 2 ? 1 : 0)
  const era = Math.floor(y / 400)
  const yoe = y - era * 400
  const mp = (month + 9) % 12
  const doy = Math.floor((153 * mp + 2) / 5)
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy
  return era * 146097 + doe - 719468 + day - 1
}

/** The year, month and day of a count from daysFromCivil. */
export function civilFromDays(n: number): [number, number, number] {
  const z = n + 719468
  const era = Math.floor(z / 146097)
  const doe = z - era * 146097
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365)
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100))
  const mp = Math.floor((5 * doy + 2) / 153)
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1
  const m = mp < 10 ? mp + 3 : mp - 9
  return [yoe + era * 400 + (m <= 2 ? 1 : 0), m, d]
}

/** A leap year, for dates whose year is never told: "29 February" may be in one, and never becomes 1 March. */
const PLAIN_YEAR = 2000
const PLAIN_START = daysFromCivil(PLAIN_YEAR, 1, 1)

// ---------- Saying a date ----------

/** A year in words: "Year 3", "1820", "44 BC" (years before Christ count through zero: 1 BC is year 0). */
const yearText = (year: number, word: boolean): string => (word ? `Year ${year}` : year <= 0 ? `${1 - year} BC` : String(year))

/** A season's name from its place among the months (spring 3.5 ... winter 12.5, early or late by 0.6). */
function seasonName(month: number): string {
  const seasons: [number, string][] = [
    [3.5, 'spring'],
    [6.5, 'summer'],
    [9.5, 'autumn'],
    [12.5, 'winter']
  ]
  const [base, name] = seasons.reduce((a, b) => (Math.abs(b[0] - month) < Math.abs(a[0] - month) ? b : a))
  const shift = month - base
  return `${shift < -0.3 ? 'early ' : shift > 0.3 ? 'late ' : ''}${name}`
}

/** A month or a season in words. */
const monthText = (month: number): string =>
  Number.isInteger(month) && month >= 1 && month <= 12 ? MONTH_NAMES[month - 1] : seasonName(month)

/** The axis a state's day is counted on, and its day there; null when the day isn't known exactly. */
function axisOf(s: WhenState): { axis: string; n: number } | null {
  if (!s.named || s.vague || s.day === null) return null
  const year = s.year === null ? `~${s.cal}` : `${s.yearWord ? 'Y' : ''}${s.year}`
  if (s.qual) return { axis: `q|${year}|${s.dayCount ? 'n' : 'm'}|${s.month ?? ''}|${s.qual}`, n: s.day }
  if (s.dayCount) return { axis: `n|${year}|${s.month ?? ''}`, n: s.day }
  if (s.month !== null && Number.isInteger(s.month)) {
    if (s.year !== null) return { axis: s.yearWord ? 'g|Y' : 'g', n: daysFromCivil(s.year, s.month, s.day) }
    return { axis: `g|~${s.cal}`, n: daysFromCivil(PLAIN_YEAR, s.month, s.day) - PLAIN_START }
  }
  if (s.month !== null) return { axis: `s|${year}|${s.month}`, n: s.day }
  return null
}

/**
 * Whether an axis counts Adam's own days with a bare "Day 41": its day since the story began is his count. A count with a
 * year or season ("Day 300, Year 1") is a day of that year, counted from the story's first day like any other date.
 */
const counted = (axis: string): boolean => /^n\|~\d+\|$/.test(axis)

/** The day in words, for a state on an axis (or '' when it can't be said). */
function dateText(s: WhenState, at: { axis: string; n: number }, own: WhenParts | null, text: string): string {
  const year = s.year === null ? '' : yearText(s.year, s.yearWord)
  if (at.axis.startsWith('n|')) {
    const season = s.month !== null ? ` of ${monthText(s.month)}` : ''
    return `Day ${at.n}${season}${year ? `, ${year}` : ''}`
  }
  if (at.axis.startsWith('g|~')) {
    if (at.n < 0 || at.n > 365) return ''
    const [, m, d] = civilFromDays(PLAIN_START + at.n)
    return `${d} ${MONTH_NAMES[m - 1]}`
  }
  if (at.axis.startsWith('g')) {
    const [y, m, d] = civilFromDays(at.n)
    return `${d} ${MONTH_NAMES[m - 1]}${s.yearWord ? `, ${yearText(y, true)}` : ` ${yearText(y, false)}`}`
  }
  if (at.axis.startsWith('s|')) return `day ${at.n} of ${monthText(s.month!)}${year ? `, ${year}` : ''}`
  // A month of a calendar the app doesn't know: only as Adam wrote it, and only when it is his own day, not a step.
  return own && !own.step && !own.next && own.day !== null ? (dayName(text) ?? '') : ''
}

/** What is known of a date that names no day: a month or season, a year ("spring, Year 2", "June 1820", "1820"). */
function roughText(s: WhenState, monthKnown: boolean): string {
  if (s.vague === 2 || (s.year === null && (s.month === null || !monthKnown))) return ''
  const year = s.year === null ? '' : yearText(s.year, s.yearWord)
  const month = s.month !== null && monthKnown && !s.dayCount ? monthText(s.month) : ''
  return [month, year].filter(Boolean).join(s.yearWord ? ', ' : ' ')
}

// ---------- Counted days on the real calendar ----------

/**
 * Days of the year a When may name by their feast (live test, 2026-10-16: "Day 25, Christmas Eve" was the cards' only
 * clue to the month, and nothing read it). Only fixed days; Easter and the like move.
 */
// prettier-ignore
const FEASTS: [RegExp, number, number][] = [
  [/\bchristmas\s+eve\b/i, 12, 24], [/\bchristmas\s+day\b/i, 12, 25], [/\bboxing\s+day\b/i, 12, 26],
  [/\bnew\s+year['’]?s\s+eve\b/i, 12, 31], [/\bnew\s+year['’]?s\s+day\b/i, 1, 1], [/\btwelfth\s+night\b/i, 1, 5],
  [/\bcandlemas\b/i, 2, 2], [/\b(?:st\.?\s+)?valentine['’]?s\s+day\b/i, 2, 14], [/\blady\s+day\b/i, 3, 25],
  [/\bmidsummer['’]?s?\s+eve\b/i, 6, 23], [/\bmidsummer['’]?s?\s+day\b/i, 6, 24], [/\blammas\b/i, 8, 1],
  [/\bmichaelmas\b/i, 9, 29], [/\bhallowe['’]?en\b/i, 10, 31], [/\ball\s+saints['’]?\s+day\b/i, 11, 1],
  [/\b(?:guy\s+fawkes|bonfire)\s+night\b/i, 11, 5], [/\bmartinmas\b/i, 11, 11]
]

/** "Christmas Eve" as "24 December", so a When naming a feast day is read as that day. */
export function feastsAsDates(text: string): string {
  for (const [re, month, day] of FEASTS) if (re.test(text)) return text.replace(re, `${day} ${MONTH_NAMES[month - 1]}`)
  return text
}

/** The real day a counted day falls on: its month, and its day of the month and year where told; `part` for "late November". */
export interface CountAnchor {
  month: number
  day: number | null
  year: number | null
  part: '' | 'early' | 'mid' | 'late'
}

const MONTH_RE = MONTH_NAMES.join('|')
const COUNT_RE = /\bday\s+(\d{1,4})\b(?!\s+of\b)/i
const DAY_MONTH_RE = new RegExp(String.raw`\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(${MONTH_RE})\b(?:,?\s+(\d{3,4})\b)?`, 'i')
const MONTH_DAY_RE = new RegExp(String.raw`\b(${MONTH_RE})\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(\d{3,4})\b)?`, 'i')
const PART_MONTH_RE = new RegExp(String.raw`\b(?:(early|mid|middle\s+of|late)[\s-]+)?(${MONTH_RE})\b(?:,?\s+(\d{3,4})\b)?`, 'i')

/**
 * A When that counts its days and names a real day too ("Day 25, 24 December", "Day 1, 28 November 1923", "Day 1, late
 * November"): the count alone, as the calendar counts it, and the real day it falls on. Null for any other When. "Day
 * 3 of spring" is a day of that season, as before, so it is left alone. "May" and "March" count only capitalised.
 */
export function splitCount(text: string): { count: string; anchor: CountAnchor } | null {
  const c = COUNT_RE.exec(text)
  if (!c) return null
  // A real day never takes the count's own number ("Day 3 December").
  const apart = (m: RegExpExecArray | null): RegExpExecArray | null =>
    m && (m.index >= c.index + c[0].length || m.index + m[0].length <= c.index) ? m : null
  const monthOf = (word: string): number | null => {
    if (/^(may|march)$/i.test(word) && !/^\p{Lu}/u.test(word)) return null
    const i = MONTH_NAMES.findIndex((m) => m.toLowerCase() === word.toLowerCase())
    return i < 0 ? null : i + 1
  }
  const tidy = (t: string): string =>
    t
      .replace(/\s*,\s*(,\s*)+/g, ', ')
      .replace(/^[\s,]+|[\s,]+$/g, '')
      .replace(/\s{2,}/g, ' ')
  const dm = apart(DAY_MONTH_RE.exec(text))
  const md = dm ? null : apart(MONTH_DAY_RE.exec(text))
  const m = dm ?? md
  if (m) {
    const [day, word, year] = dm ? [m[1], m[2], m[3]] : [m[2], m[1], m[3]]
    const month = monthOf(word)
    if (month !== null && Number(day) >= 1 && Number(day) <= 31) {
      return { count: tidy(text.replace(m[0], '')), anchor: { month, day: Number(day), year: year ? Number(year) : null, part: '' } }
    }
  }
  const pm = apart(PART_MONTH_RE.exec(text))
  const month = pm ? monthOf(pm[2]) : null
  if (!pm || month === null) return null
  const part = !pm[1] ? '' : /^early/i.test(pm[1]) ? 'early' : /^late/i.test(pm[1]) ? 'late' : 'mid'
  return { count: tidy(text.replace(pm[0], '')), anchor: { month, day: null, year: pm[3] ? Number(pm[3]) : null, part } }
}

/** Day 0 of daysFromCivil (1 January 1970) was a Thursday. */
const WEEKDAY_NAMES = ['Thursday', 'Friday', 'Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday']

/**
 * Where a bare count's days fall on the real calendar: the real day (daysFromCivil) of its day 0, and whether the year
 * and the day of the month were told.
 */
interface CountOnCalendar {
  zero: number
  year: boolean
  exact: boolean
}

/** A counted day as a real one: "Sunday 2 December 1923", "2 December", or "about early December" when only a month was told. */
function realText(on: CountOnCalendar, n: number): string {
  const real = on.zero + n
  const [y, m, d] = civilFromDays(real)
  const month = MONTH_NAMES[m - 1]
  if (!on.exact) return `about ${d <= 10 ? 'early' : d <= 20 ? 'mid' : 'late'} ${month}${on.year ? ` ${yearText(y, false)}` : ''}`
  if (!on.year) return `${d} ${month}`
  return `${WEEKDAY_NAMES[((real % 7) + 7) % 7]} ${d} ${month} ${yearText(y, false)}`
}

// ---------- The calendar ----------

/**
 * Places every scene on the calendar, in reading order (see above). `stories` says where each story carries on from, as
 * for the timeline (worldViews/when.ts WhenStory).
 */
export function buildCalendar(items: readonly CalendarItem[], stories: ReadonlyMap<ID, WhenStory> = new Map()): Calendar {
  // A feast day is read as its date, and a counted day that names a real one too ("Day 25, Christmas Eve") is counted as
  // the count alone, its real day kept to place every day of that count on the real calendar (below).
  const anchors = new Map<number, CountAnchor>()
  const texts = items.map((x, i) => {
    const text = feastsAsDates(x.when.trim())
    const split = splitCount(text)
    if (split) anchors.set(i, split.anchor)
    return { text: split?.count ?? text, story: x.story }
  })
  const states = whenStates(texts, stories)
  const placed = placeWhens(texts, stories)
  const dates = new Map<ID, StoryDate>()
  /**
   * The first day of each calendar that names one and isn't a flashback: day 1 of the story. Dates read before it (a
   * story opening on a flashback) have no day since the story began.
   */
  const origins = new Map<number, { axis: string; n: number }>()
  const before = new Set<ID>()
  items.forEach((item, i) => {
    const text = texts[i].text
    const p = text ? parseWhen(text) : null
    const s = states[i]
    const back = !!text && goesBack(text, p)
    // A day its month doesn't have in the year it takes from the scenes before ("29 February" after "1 January 1821")
    // is no day: it never rolls into the next month.
    const impossible =
      !!p &&
      !!s &&
      p.day !== null &&
      !p.step &&
      !p.next &&
      !p.dayCount &&
      !p.qual &&
      s.year !== null &&
      s.month !== null &&
      Number.isInteger(s.month) &&
      p.day > monthLength(s.month, s.year)
    const at = s && !impossible ? axisOf(s) : null
    if (s && at && !back && !origins.has(s.cal)) origins.set(s.cal, at)
    else if (s && at && !origins.has(s.cal)) before.add(item.id)
    const timeOnly = !!p && !p.step && !p.next && p.year === null && p.month === null && p.day === null
    const reading: DateReading = !text
      ? 'empty'
      : !p || impossible
        ? 'unclear'
        : !s
          ? timeOnly
            ? 'read'
            : 'unanchored'
          : p.step?.vague
            ? 'vague'
            : 'read'
    const rough = !!s && !at && !timeOnly && !impossible
    // The month is known unless a vague step lost it: after "six months later" (or "half a year later") the day is only
    // about right, but the month is the one stepped to.
    const monthKnown = !!s && (!s.vague || (s.vague === 1 && !!p?.step && p.step.unit !== 'day' && !p.step.vague))
    dates.set(item.id, {
      id: item.id,
      when: item.when.trim(),
      reading,
      axis: at?.axis ?? null,
      n: at?.n ?? null,
      day: null,
      year: s && s.vague < 2 && (at || rough) ? s.year : null,
      month: s && monthKnown && (at || rough) ? s.month : null,
      yearWord: !!s?.yearWord,
      dayCount: !!s?.dayCount,
      cal: s?.cal ?? 0,
      minute: p?.minute ?? null,
      time: p?.time ?? '',
      span: p?.span ?? null,
      timeFrom: p?.minute != null ? 'card' : null,
      date: s && at ? dateText(s, at, p, text) : s && rough ? roughText(s, monthKnown) : '',
      leans:
        !!p &&
        (!!p.step || p.next || timeOnly || (!!s && ((p.year === null && s.year !== null) || (p.month === null && s.month !== null)))),
      back,
      key: placed[i]?.key ?? null
    })
  })
  // Each date's day since the story began, now that every calendar's first day is known: Adam's own bare count, or days
  // since that first day (none for a date read before it).
  for (const d of dates.values()) {
    const origin = origins.get(d.cal)
    if (d.axis === null || d.n === null) continue
    if (counted(d.axis)) d.day = d.n
    else if (origin && origin.axis === d.axis && !before.has(d.id)) d.day = d.n - origin.n + 1
  }
  // A bare count of days on the real calendar: the first scene that names a real day beside its count places every day
  // of that count ("Day 25, Christmas Eve" makes Day 3 the 2nd of December). Only a bare count: a count of a year or
  // season's days ("Day 3 of spring") is left as it is. With no year told, a year that isn't a leap year is assumed.
  const onCalendar = new Map<string, CountOnCalendar>()
  items.forEach((item, i) => {
    const a = anchors.get(i)
    const d = dates.get(item.id)
    if (!a || !d || d.axis === null || d.n === null || !counted(d.axis) || onCalendar.has(d.axis)) return
    const year = a.year ?? PLAIN_YEAR - 1
    if (a.day !== null && a.day > monthLength(a.month, year)) return
    const day = a.day ?? (a.part === 'early' ? 5 : a.part === 'late' ? 25 : 15)
    onCalendar.set(d.axis, { zero: daysFromCivil(year, a.month, day) - d.n, year: a.year !== null, exact: a.day !== null })
  })
  for (const d of dates.values()) {
    const on = d.axis !== null && d.n !== null ? onCalendar.get(d.axis) : undefined
    if (on) d.real = realText(on, d.n!)
  }
  return { dates, order: items.map((x) => x.id) }
}

/**
 * The calendar with a time of day for the scenes whose card has no When, from the memory's reading of their own words
 * (`cues`, by scene: where things stand at the scene's end, continuity/tracker.ts timeCues). Only a time of day: it
 * never names a day.
 */
export function withCues(cal: Calendar, cues: ReadonlyMap<ID, string>): Calendar {
  if (!cues.size) return cal
  const dates = new Map(cal.dates)
  for (const [id, words] of cues) {
    const d = dates.get(id)
    if (!d || d.when || d.minute !== null) continue
    const p = parseWhen(words)
    if (p?.minute == null) continue
    dates.set(id, { ...d, minute: p.minute, time: p.time, span: p.span, timeFrom: 'memory' })
  }
  return { ...cal, dates }
}

/**
 * The date of a When that isn't a scene's (an event's When, a birth date), read where the calendar stands at a scene: as
 * the timeline reads an event, on its own, taking only a year it leaves out from the dated scene at or before that one
 * (`at`). Null when it names no day, month or year of its own.
 */
export function dateOfText(cal: Calendar, text: string, at: ID | null): StoryDate | null {
  const p = parseWhen(text.trim())
  if (!p || p.step || p.next || (p.year === null && p.month === null && p.day === null)) return null
  let lean: StoryDate | undefined
  if (at) {
    const upTo = cal.order.indexOf(at)
    for (let i = upTo; i >= 0 && !lean; i--) {
      const d = cal.dates.get(cal.order[i])
      if (d && (d.axis !== null || d.year !== null)) lean = d
    }
  }
  const s: WhenState = {
    year: p.year ?? lean?.year ?? null,
    yearWord: p.year !== null ? p.yearWord : !!lean?.yearWord,
    month: p.month,
    day: p.day,
    dayCount: p.dayCount,
    minute: p.minute ?? -1,
    qual: p.qual,
    cal: lean?.cal ?? 0,
    vague: 0,
    named: p.day !== null && (p.dayCount || p.month !== null || !!p.qual)
  }
  const ax = axisOf(s)
  const rough = !ax
  const origin = lean ? [...cal.dates.values()].find((d) => d.cal === s.cal && d.axis !== null && !d.back) : undefined
  return {
    id: '',
    when: text.trim(),
    reading: 'read',
    axis: ax?.axis ?? null,
    n: ax?.n ?? null,
    day: ax ? (counted(ax.axis) ? ax.n : origin?.axis === ax.axis ? ax.n - origin.n! + 1 : null) : null,
    year: s.year,
    month: s.month,
    yearWord: s.yearWord,
    dayCount: s.dayCount,
    cal: s.cal,
    minute: p.minute,
    time: p.time,
    span: p.span,
    timeFrom: p.minute !== null ? 'card' : null,
    date: ax ? dateText(s, ax, p, text.trim()) : rough ? roughText(s, true) : '',
    leans: p.year === null && s.year !== null,
    back: false,
    key: null
  }
}

// ---------- Sums ----------

/** How far apart two dates are. */
export interface Elapsed {
  /** Days from the first to the second: negative when the second comes first. About right only, when `months` is given. */
  days: number
  /** Only the months (or years, as twelve months each) are known, not the days: `days` is then about right. */
  months?: number
  /** Minutes from the first to the second, when both are on the same day and both say the time of day. */
  minutes?: number
}

/** A year in days, on average (for "about so many years" only). */
const YEAR_DAYS = 365.2425
const MONTH_DAYS = YEAR_DAYS / 12

/**
 * How long after `a` the date `b` is: in days when both name their day on the same axis; else about so many months when
 * both name a month (or season) and a year of the same kind, or years when both name a year and neither counts its
 * days ("Day 300, Year 1" and "Day 5, Year 2" may be weeks apart); null when it can't be told (or when only the month is
 * the same, with no days to count).
 */
export function elapsedBetween(a: StoryDate | null | undefined, b: StoryDate | null | undefined): Elapsed | null {
  if (!a || !b) return null
  if (a.axis !== null && a.axis === b.axis && a.n !== null && b.n !== null) {
    const days = b.n - a.n
    return days === 0 && a.minute !== null && b.minute !== null ? { days, minutes: b.minute - a.minute } : { days }
  }
  if (a.year === null || b.year === null || a.yearWord !== b.yearWord) return null
  const years = b.year - a.year
  if (a.month !== null && b.month !== null && !a.dayCount && !b.dayCount) {
    const months = Math.round((years * 12 + (b.month - a.month)) * 10) / 10
    return Math.abs(months) >= 1 ? { days: Math.round(months * MONTH_DAYS), months } : null
  }
  return years && !a.dayCount && !b.dayCount ? { days: Math.round(years * YEAR_DAYS), months: years * 12 } : null
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`

/**
 * How long a gap is, in plain words, whichever way it goes: "the same day", "2 days", "3 weeks and 2 days", "about 4
 * months (121 days)", "about 6 months", "about 3 years".
 */
export function elapsedWords(e: Elapsed): string {
  if (e.months !== undefined) {
    const m = Math.abs(e.months)
    if (m < 11.5) return `about ${plural(Math.max(1, Math.round(m)), 'month')}`
    if (m < 18) return 'about a year'
    if (m < 24) return `about ${Math.round(m)} months`
    return `about ${plural(Math.round(m / 12), 'year')}`
  }
  const d = Math.abs(e.days)
  if (d === 0) return 'the same day'
  if (d < 14) return plural(d, 'day')
  if (d < 70) return `${plural(Math.floor(d / 7), 'week')}${d % 7 ? ` and ${plural(d % 7, 'day')}` : ''}`
  if (d < 730) {
    const m = Math.round(d / MONTH_DAYS)
    return `about ${m === 12 ? 'a year' : plural(m, 'month')} (${d} days)`
  }
  return `about ${plural(Math.round(d / YEAR_DAYS), 'year')}`
}

/** Whether two dates are on the same day: null when it can't be told (either isn't known exactly, or they are on different axes). */
export function sameDay(a: StoryDate | null | undefined, b: StoryDate | null | undefined): boolean | null {
  if (!a || !b || a.axis === null || a.axis !== b.axis || a.n === null || b.n === null) return null
  return a.n === b.n
}

/**
 * Whether two dates are the same moment, for what carries from one scene into the next (the time of day, the light and
 * the weather): the same day and the same time of day. False on different days, or the same day with different times
 * (or one saying a time and the other not); null when it can't be told (the caller keeps its own rule).
 */
export function sameMoment(a: StoryDate | null | undefined, b: StoryDate | null | undefined): boolean | null {
  const day = sameDay(a, b)
  if (day === null || !day) return day
  if (a!.minute === null && b!.minute === null) return null
  return a!.minute === b!.minute
}

/**
 * Which of two times of day the same day comes first, only where that is certain: 1 when `b` is later than `a`, -1 when
 * earlier, 0 when their spans meet ("night" after "11pm" may be the same hour, "evening" and "7pm" overlap); null when
 * either says no time.
 */
export function timeOrder(a: StoryDate | null | undefined, b: StoryDate | null | undefined): -1 | 0 | 1 | null {
  if (!a?.span || !b?.span) return null
  if (a.span[1] < b.span[0]) return 1
  if (b.span[1] < a.span[0]) return -1
  return 0
}

/** A scene whose date comes before the dated scene before it, and whose When doesn't say it goes back on purpose. */
export interface GoingBack {
  sceneId: ID
  /** The dated scene before it in reading order that it comes before. */
  beforeId: ID
  /** How far back it goes (negative days, or minutes the same day). */
  elapsed: Elapsed
}

/** The earliest time of day that can go back within a day: one in the small hours after a night scene may be that same night. */
const BACK_FROM_MINUTE = 300

/**
 * The scenes whose date goes backwards in reading order without saying so (see above), for the rule-based checks
 * (fix 8, checks/rules.ts). Each is compared with the last dated scene before it in its own story that isn't a flashback (`stories`: each
 * scene's story; a side story added whole runs alongside its host, so a host scene after it is never compared with it),
 * so the present after a flashback is held to the present before it. Only where it is certain: both name their day on
 * the same axis, or a month or year of their own. A When that leans on the scenes before is never counted: a step forward
 * can't go back, and one that takes its year or month from them ("March" after "December, Year 2") may be the next year,
 * which only Adam knows. The same day with an earlier time counts only when both cards say the time, the two times
 * can't be the same hour (timeOrder: "night" after "11pm" may be), and not for a time in the small hours.
 */
export function goingBack(cal: Calendar, stories?: ReadonlyMap<ID, ID>): GoingBack[] {
  const out: GoingBack[] = []
  const last = new Map<ID, StoryDate>()
  for (const id of cal.order) {
    const d = cal.dates.get(id)
    if (!d || (d.axis === null && d.year === null)) continue
    const story = stories?.get(id) ?? ''
    const before = last.get(story)
    if (!d.back) last.set(story, d)
    if (!before || d.back || d.leans) continue
    const e = elapsedBetween(before, d)
    if (!e) continue
    const earlierToday =
      e.days === 0 && d.timeFrom === 'card' && before.timeFrom === 'card' && timeOrder(before, d) === -1 && d.minute! >= BACK_FROM_MINUTE
    if (e.days < 0 || earlierToday) out.push({ sceneId: id, beforeId: before.id, elapsed: e })
  }
  return out
}

// ---------- Saying it ----------

/** "day 41 of the story", when the date says something else (a real date) and it isn't the story's first day; '' otherwise. */
export function storyDayWords(d: StoryDate): string {
  return d.day !== null && d.day > 1 && d.axis !== null && !counted(d.axis) ? `day ${d.day} of the story` : ''
}

/**
 * A date in plain words, for a list or a line: "Day 41 · evening", "12 March 1820 · day 41 of the story · dusk",
 * "spring, Year 2", "evening" (`sep` between the parts). '' when nothing is known.
 */
export function dateLabel(d: StoryDate | null | undefined, sep = ' · '): string {
  if (!d) return ''
  const day = d.date || (d.day !== null && d.day >= 1 ? `Day ${d.day} of the story` : '')
  return [day, d.date ? storyDayWords(d) : '', d.time].filter(Boolean).join(sep)
}

// ---------- Ages ----------

/** What a character's "Age or birth date" field says: a birth date, or an age at a date (or where it was set). */
export type AgeFact =
  | { kind: 'born'; when: string }
  /** An age in years; `at`: the date it was at ("in 1815"), else `start` (at the story's start), else as of where it was set. */
  | { kind: 'age'; years: number; at: string; start: boolean }

// prettier-ignore
const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40,
  fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90
}

/** A whole number at the start of `text`, in figures or words ("34", "thirty-four"), with what follows it. */
function leadingNumber(text: string): { n: number; rest: string } | null {
  const fig = /^(\d{1,3})(?![\d/.:\w-])\s*(.*)$/s.exec(text)
  if (fig) return { n: Number(fig[1]), rest: fig[2] }
  const words = /^([a-z]+)(?:-([a-z]+)|\s+([a-z]+))?(?![\w-])\s*(.*)$/is.exec(text)
  if (!words) return null
  const tens = NUMBER_WORDS[words[1].toLowerCase()]
  if (tens === undefined) return null
  const second = words[2] ?? words[3]
  const unit = second ? NUMBER_WORDS[second.toLowerCase()] : undefined
  if (tens >= 20 && unit !== undefined && unit < 10) return { n: tens + unit, rest: words[4] }
  // A hyphen joins something else on ("forty-ish"): a guess.
  if (words[2]) return null
  return { n: tens, rest: `${words[3] ?? ''} ${words[4]}`.trim() }
}

/**
 * Reads a character's "Age or birth date" field. Null for anything vague ("mid-thirties", "about 40", "40s", "34 or
 * 35", "old"): nothing is worked out from a guess.
 */
export function readAge(text: string | null | undefined): AgeFact | null {
  const t = (text ?? '')
    .replace(/\s+/g, ' ')
    .replace(/[.\s]+$/, '')
    .trim()
  if (!t) return null
  const born = /\b(?:born|b\.)\s*(?:on|in)?\s*(.+)$/i.exec(t)
  if (born) {
    const when = born[1].split(/[;()]/)[0].trim()
    const p = parseWhen(when)
    return p && !p.step && !p.next && p.year !== null ? { kind: 'born', when } : null
  }
  // A number first, or it is a guess ("about 40", "mid-thirties", "old").
  const lead = leadingNumber(t.replace(/^aged?\s+/i, ''))
  if (!lead || lead.n > 999) return null
  const raw = lead.rest.replace(/^(?:years?|yrs?)(?:\s+old)?\b\s*/i, '').trim()
  // "34 (in 1820)" is "34 in 1820"; "34 (looks older)" is a remark.
  const rest = raw.replace(/^\((.*)\)$/, '$1').trim()
  if (!rest) return { kind: 'age', years: lead.n, at: '', start: false }
  if (/^(?:at|by)\s+the\s+(?:start|beginning|opening)\b|^when\s+the\s+story\s+(?:starts|begins|opens)\b/i.test(rest)) {
    return { kind: 'age', years: lead.n, at: '', start: true }
  }
  const at = /^(?:in|on|at)\s+(.+)$/i.exec(rest)
  if (at) {
    const when = at[1].split(/[;()]/)[0].trim()
    const p = parseWhen(when)
    return p && !p.step && !p.next && (p.year !== null || p.day !== null) ? { kind: 'age', years: lead.n, at: when, start: false } : null
  }
  // A remark after it ("34, looks older") says nothing of when; anything else ("40s", "34 or 35", "34-ish") is a guess.
  return /^[,;(]/.test(raw) && !/\b(?:or|about|around|roughly|ish)\b/i.test(raw)
    ? { kind: 'age', years: lead.n, at: '', start: false }
    : null
}

/** An age worked out for a date: `lo` to `hi` years (the same when it is known exactly), and what it rests on. */
export interface AgeAt {
  lo: number
  hi: number
  /** Only about right: worked out from months or years, not days. */
  about: boolean
}

/**
 * How old someone is at `now`: from a birth date (`born`), or from an age at a date (`years` at `then`). Null when the two
 * dates can't be compared (different calendars, or not enough known).
 */
export function ageFrom(base: { born: StoryDate } | { years: number; then: StoryDate }, now: StoryDate): AgeAt | null {
  if ('born' in base) {
    const b = base.born
    if (b.year === null || now.year === null || b.yearWord !== now.yearWord) return null
    const years = now.year - b.year
    // Both full dates on the same axis: exact.
    if (b.axis !== null && b.axis === now.axis && b.axis.startsWith('g')) {
      const [, bm, bd] = civilFromDays(b.n!)
      const [, nm, nd] = civilFromDays(now.n!)
      const age = years - (nm < bm || (nm === bm && nd < bd) ? 1 : 0)
      return age >= 0 ? { lo: age, hi: age, about: false } : null
    }
    if (b.month !== null && now.month !== null && Number.isInteger(b.month) && Number.isInteger(now.month) && b.month !== now.month) {
      const age = years - (now.month < b.month ? 1 : 0)
      return age >= 0 ? { lo: age, hi: age, about: false } : null
    }
    return years >= 1 ? { lo: years - 1, hi: years, about: false } : years === 0 ? { lo: 0, hi: 0, about: false } : null
  }
  const then = base.then
  const e = elapsedBetween(then, now)
  if (!e) return null
  // Someone who is N at `then` turns N + 1 on a day after it, within the year: N + the whole years since then, or one
  // more once a birthday may have come.
  const range = (whole: number, past: boolean, about: boolean): AgeAt | null => {
    const lo = base.years + whole
    return lo >= 0 ? { lo, hi: past ? lo + 1 : lo, about } : null
  }
  if (then.axis !== null && then.axis === now.axis && then.axis.startsWith('g')) {
    // Real dates: whole years by month and day, as a birthday counts them (1 March 1820 to 1 March 1823 is three).
    const [ty, tm, td] = civilFromDays(then.n!)
    const [ny, nm, nd] = civilFromDays(now.n!)
    const later = (m1: number, d1: number, m2: number, d2: number): boolean => m1 > m2 || (m1 === m2 && d1 > d2)
    if (e.days >= 0) {
      const whole = ny - ty - (later(tm, td, nm, nd) ? 1 : 0)
      return range(whole, !(nm === tm && nd === td), false)
    }
    // Back in time: as many whole years back, and one fewer before a birthday may have come.
    const whole = ny - ty + (later(nm, nd, tm, td) ? 1 : 0)
    return range(whole - (nm === tm && nd === td ? 0 : 1), !(nm === tm && nd === td), false)
  }
  if (e.months !== undefined) {
    // Only the months are known (a season, a month without its day): about right.
    const years = e.months / 12
    return range(Math.floor(years), true, true)
  }
  // Counted days ("Day 1" to "Day 1101") in years of the Common Era's length.
  const years = e.days / YEAR_DAYS
  return range(Math.floor(years), !Number.isInteger(years), false)
}

/** An age in words: "30", "36 or 37", "about 40". */
export const ageWords = (a: AgeAt): string => (a.about ? `about ${a.lo}` : a.lo === a.hi ? String(a.lo) : `${a.lo} or ${a.hi}`)

// ---------- For the writer’s briefing ----------

/** An age worked out for a scene, with what it rests on in plain words ("born 12 March 1790", "34 at the story's start"). */
export interface AgeHere {
  age: AgeAt
  basis: string
  /** From a birth date or year (rather than an age at a date). */
  born: boolean
  /** The age the field gives, for an age at a date. */
  given?: number
}

/** An earlier day worth counting from: a dated event that has happened, or the start of a chapter. */
export interface Landmark {
  /** "the siege of Varn", "the start of Ch 4: The Siege". */
  name: string
  date: StoryDate
}

/** What the writer's briefing says of the story calendar at a scene (memory/storyCalendar.ts sceneCalendar, told by ai/storyDate.ts). */
export interface SceneCalendar {
  here: StoryDate | null
  /** The scene before on the line (the memory's previous scene). */
  previous: StoryDate | null
  /** Earlier days worth counting from, events first, each the latest first. */
  landmarks: Landmark[]
  /** The characters on the scene card, with their ages here where the memory says enough. */
  ages: { name: string; age: AgeHere }[]
  /**
   * The scenes just before this one in its story that are on the same day, going back until one isn't (or can't be told),
   * latest first (memory review, 2026-10-20): clothes put on in them are still on here. Left out: none known.
   */
  today?: ID[]
}
