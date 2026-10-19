// Time claims in a scene's words, held to the story calendar (free rules, 2026-10-19). A 30,000-word live test on
// DeepSeek Flash found the commonest big slips were the timeline: months, years and travel times the writer made up.
// Reading dates by rule beats asking an AI judge, so these are found with no AI call, and each says nothing unless the
// record is sure and the words plainly say so:
// - a month, a day of the month, a year, a weekday or a season the narration gives as now ("It was a raw March morning",
//   "It was the third of March", "It was 1823", "It was a Tuesday", "It was high summer", a dateline "Linmouth, March
//   1847") that the calendar or the scene card says otherwise (12 June 1820: June, a Monday, summer). Only in narration,
//   only in those plain frames: "last March", "next spring", "in May he had…" and anything said in dialogue remember or
//   plan, and are left alone. A season only against a real month, or one the card names, and only when the two can't
//   both be so (spring in June may be late spring; spring in October can't);
// - in a story that counts its days ("Day 3") where no card and no codex entry names a month or a year, any month or
//   year given as now: the writer made it up (worth a look, never a must);
// - a month or a year said beside a dated event that is dated otherwise ("the fire last March" when the codex has the
//   fire in June 1819), in dialogue too: that contradicts a known date;
// - how long since something ("three weeks since the fire", "it's been four days since we left Linmouth", "the fire, two
//   years ago") against the calendar: a dated event, the last scene at a place left, or a year. Within a quarter either
//   way (twice that with "nearly", "about" and the like); "feels like three weeks" is nobody's sum;
// - how a scene opens ("The next morning", "That night", "Three days later") against how far its card is from the scene
//   before's;
// - a journey's length ("Carrow is a day's ride from Linmouth") against what the codex's place entries say of the same
//   two places, by the same means (or one not said), when one is at least twice the other.
// Each finding quotes its words and, where it is obvious, says what they should be (the month, weekday, year, season or
// length the calendar has). Pure: checks/freeContext.ts reads the world.

import type { IssueSource } from '@shared/contracts/checks'
import type { ID } from '@shared/types'
import { MONTH_NAMES } from '../worldViews/when'
import { elapsedBetween, elapsedWords, type StoryDate } from '../memory/calendar'
import { quoteSpans, type QuoteSpan } from './speakers'
import { COUNT, HEDGE, countOf, joins, lengthWords, placeChain, placesIn, routesIn, sentencesOf, type Route, type RoutePlace } from '../storyIndex/routes'

/** What a time claim is about. */
export type TimeClaimKind = 'month' | 'day' | 'year' | 'weekday' | 'season' | 'invented' | 'event-date' | 'elapsed' | 'opening' | 'journey'

/** An event the codex dates (its When), on this scene's calendar. */
export interface DatedEvent {
  id: ID
  name: string
  aliases: string[]
  date: StoryDate
}

/** An earlier scene, with its date and where it is in plain words ("Ch 1, Sc 2"). */
export interface EarlierScene {
  sceneId: ID
  label: string
  date: StoryDate
}

/** What the time claims are held to, for one scene (checks/freeContext.ts). */
export interface TimeContext {
  /** The scene's date on the story calendar; null when it isn't known. */
  date: StoryDate | null
  /**
   * The month it is in, where that is sure: a real date, a counted day the cards place on the real calendar, or a month or
   * season the card's own When names (1 to 12, or a season: spring 3.5 … winter 12.5). Null otherwise.
   */
  month: number | null
  /** The day of the month, where known exactly. */
  day: number | null
  /** The year, as a number (never a world's "Year 3"). */
  year: number | null
  /** The day of the week, where the calendar knows it ("Monday"). */
  weekday: string | null
  /** The scene before it in its story, when its date is known. */
  previous: EarlierScene | null
  /** The story counts its days and no card names a real month or year. */
  counted: boolean
  /** Months (1 to 12) and years the codex or the story's cards name: never made up. */
  knownMonths: ReadonlySet<number>
  knownYears: ReadonlySet<number>
  /** Events the codex dates. */
  events: DatedEvent[]
  /** The last scene before this one at a place (or a place inside it), with its date. */
  lastAt: (placeId: ID) => EarlierScene | null
  /** The codex's places, and the places each is in. */
  places: RoutePlace[]
  parents: ReadonlyMap<ID, ID | null>
  /** The scene card's place; null for none. */
  here: ID | null
  /** What the codex's place entries say of how long it takes between places. */
  routes: (Route & { entryId: ID; entryName: string })[]
}

/** One time claim that doesn't fit. */
export interface TimeFinding {
  kind: TimeClaimKind
  /** Where the claim's words are in the text. */
  start: number
  end: number
  words: string
  message: string
  /** The claim's words put right, when that is obvious. */
  fix: string | null
  severity: 'warning' | 'minor'
  sources: IssueSource[]
}

// ---------- Words ----------

const MONTH = String.raw`(January|February|March|April|May|June|July|August|September|October|November|December)`
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
// prettier-ignore
const ORDINALS = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh',
  'twelfth', 'thirteenth', 'fourteenth', 'fifteenth', 'sixteenth', 'seventeenth', 'eighteenth', 'nineteenth', 'twentieth',
  'twenty-first', 'twenty-second', 'twenty-third', 'twenty-fourth', 'twenty-fifth', 'twenty-sixth', 'twenty-seventh',
  'twenty-eighth', 'twenty-ninth', 'thirtieth', 'thirty-first']
// prettier-ignore
const SMALL_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen']

const monthNo = (w: string): number => MONTH_NAMES.findIndex((m) => m.toLowerCase() === w.toLowerCase()) + 1

/** The seasons, each with the months it may be said in (a month either side: spring in June may be late spring). */
const SEASON_MONTHS: Record<string, number[]> = {
  spring: [2, 3, 4, 5, 6],
  summer: [5, 6, 7, 8, 9],
  autumn: [8, 9, 10, 11, 12],
  winter: [11, 12, 1, 2, 3]
}
/** The months each season is (for a season the card names). */
const SEASON_CORE: Record<string, number[]> = { spring: [3, 4, 5], summer: [6, 7, 8], autumn: [9, 10, 11], winter: [12, 1, 2] }
const seasonOfWord = (w: string): string => {
  const s = w.toLowerCase()
  return s === 'midsummer' ? 'summer' : s === 'midwinter' ? 'winter' : s === 'fall' ? 'autumn' : s
}
/** The season a month is in (a season's place among the months, spring 3.5, is its own). */
function seasonOfMonth(m: number): string {
  const n = Math.round(m) % 12
  return n >= 3 && n <= 5 ? 'spring' : n >= 6 && n <= 8 ? 'summer' : n >= 9 && n <= 11 ? 'autumn' : 'winter'
}

const cap = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s)
const sameCase = (was: string, now: string): string => (/^\p{Lu}/u.test(was) ? cap(now) : now)
const clean = (s: string): string => s.replace(/\s+/g, ' ').trim()

/** A length of days in words for a fix: "four days", "a day", "three weeks"; null when no plain words fit. */
function daysWords(days: number): string | null {
  if (days === 1) return 'a day'
  if (days > 1 && days < SMALL_WORDS.length) return `${SMALL_WORDS[days]} days`
  if (days >= 14 && days < 70 && days % 7 === 0) return `${SMALL_WORDS[days / 7]} weeks`
  return null
}

// ---------- Where the words are ----------

const inAny = (spans: readonly QuoteSpan[], at: number): boolean => spans.some((q) => q.start <= at && at < q.end)

/**
 * Words that say the time isn't the one now, or isn't sure ("not March yet", "nearly spring"), or that "it" is a thing
 * with a date of its own ("It was dated the third of March", "It was built in 1790").
 */
const NOT_NOW =
  /\b(?:not|never|no|nearly|almost|hardly|barely|scarcely|close\s+to|like|as\s+if|dated|written|signed|stamped|postmarked|marked|printed|carved|inscribed|engraved|built|founded|made|born|married|buried|named|called|sent|posted)\b/i

/** "It was", "Today is", "The year was", "It's now": a sentence giving the time as now. */
const FRAME = /(?<![\p{L}])(?:it|today|this|the\s+(?:year|date|month|season))\s+(?:was|is|['’]s)\s+(?:now\s+|already\s+|still\s+|by\s+then\s+|at\s+last\s+|finally\s+|once\s+more\s+)?/giu
/** Where what a frame says ends: a stop, or a tie to something else ("It was March when they came" is a memory). */
const CLAUSE_END = /[;:.!?—–()]|,\s+(?:and|but|when|as|while|so)\b|\s+(?:when|before|after|since|until|till|as|while|and|but|that|because|which|who)\b/iu
/** Words the frame may have after its time: a time of day, "again", a year, a place. */
const AFTER_TIME =
  /^(?:\s+(?:morning|afternoon|evening|night|day|dawn|dusk|noon|midday|week|sun|light|again|now|already|at\s+last|once\s+more|(?:in|at|on|of)\s+(?:the\s+)?(?:\p{Lu}[\p{L}'’-]*|\d{3,4})(?:\s+\p{Lu}[\p{L}'’-]*)*))*\s*,?\s*$/u

/** What a frame gives as now: a month, a day of the month, a year, a weekday, a season, with where each word is. */
interface Said {
  month?: { n: number; at: number; word: string }
  day?: { n: number; at: number; word: string }
  year?: { n: number; at: number; word: string }
  weekday?: { name: string; at: number; word: string }
  season?: { name: string; at: number; word: string }
}

/**
 * What a frame's words give as now, or null when they aren't plainly a time ("It was a Tuesday crowd", "It was not
 * March yet"). `words` start just after "It was" and run to the end of its clause; `base` is where they start in the text.
 */
function readFrame(words: string, base: number): Said | null {
  if (NOT_NOW.test(words)) return null
  const out: Said = {}
  let last = -1
  const take = (re: RegExp, fn: (m: RegExpExecArray) => void): void => {
    const m = re.exec(words)
    if (!m) return
    fn(m)
    last = Math.max(last, m.index + m[0].length)
  }
  take(new RegExp(String.raw`(?<![\p{L}])${MONTH}(?![\p{L}])`, 'u'), (m) => (out.month = { n: monthNo(m[1]), at: base + m.index, word: m[1] }))
  take(/(?<![\p{L}])(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)(?![\p{L}])/u, (m) => (out.weekday = { name: m[1], at: base + m.index, word: m[1] }))
  take(/(?<![\p{L}])((?:mid)?(?:spring|summer|autumn|winter)|midsummer|midwinter|Spring|Summer|Autumn|Winter|Midsummer|Midwinter)(?![\p{L}])/u, (m) => {
    out.season = { name: seasonOfWord(m[1]), at: base + m.index, word: m[1] }
  })
  take(/(?<![\p{L}\p{N}])(1\d{3}|2\d{3})(?![\p{L}\p{N}])/u, (m) => (out.year = { n: Number(m[1]), at: base + m.index, word: m[1] }))
  if (out.month) {
    // "the third of March", "3rd March", "March 3rd", "3 March"
    const ord = new RegExp(String.raw`(?<![\p{L}])(${ORDINALS.slice(1).join('|')}|\d{1,2}(?:st|nd|rd|th)?)\s+(?:of\s+)?${out.month.word}\b`, 'iu').exec(words)
    const after = new RegExp(String.raw`\b${out.month.word}\s+(\d{1,2})(?:st|nd|rd|th)?(?![\p{N}])`, 'u').exec(words)
    const m = ord ?? after
    if (m) {
      const raw = m[1]
      const n = /^\d/.test(raw) ? parseInt(raw, 10) : ORDINALS.indexOf(raw.toLowerCase())
      if (n >= 1 && n <= 31) out.day = { n, at: base + m.index + m[0].indexOf(raw), word: /^\d/.test(raw) ? raw.replace(/(st|nd|rd|th)$/, '') : raw }
      last = Math.max(last, m.index + m[0].length)
    }
  }
  if (!out.month && !out.weekday && !out.season && !out.year) return null
  // A season or month that names something ("a summer dress", "a Tuesday crowd") isn't the time: only a time of day,
  // "again", a year or a place may follow.
  if (!AFTER_TIME.test(words.slice(last))) return null
  return out
}

/** A dateline: a short line that is only a date (and a place before it): "Linmouth, March 1847", "14th March, 1847". */
const DATELINE = new RegExp(
  String.raw`^(?:\p{Lu}[\p{L}'’ -]{1,30},\s*)?(?:(?:the\s+)?(?:\d{1,2}(?:st|nd|rd|th)?)\s+(?:of\s+)?)?${MONTH}(?:\s+\d{1,2}(?:st|nd|rd|th)?)?,?\s+(\d{4})\.?$|^(?:\p{Lu}[\p{L}'’ -]{1,30},\s*)?(?:(?:early|late|mid)[\s-])?(Spring|Summer|Autumn|Winter|spring|summer|autumn|winter)(?:\s+of)?,?\s+(\d{4})\.?$`,
  'u'
)

// ---------- The checks ----------

/** Every time claim in a text that doesn't fit (see the top of this file), in order. `opening`: how much of the text is the scene's opening (0: none of it). */
export function timeClaims(text: string, ctx: TimeContext, opening = 0): TimeFinding[] {
  if (!text.trim()) return []
  const quotes = quoteSpans(text)
  const out: TimeFinding[] = []
  const add = (f: TimeFinding): void => {
    if (!out.some((o) => o.start < f.end && f.start < o.end)) out.push(f)
  }
  for (const f of datelines(text, ctx)) add(f)
  for (const s of sentencesOf(text)) {
    const sentence = text.slice(s.start, s.end)
    // A quick look first: most sentences name no date, no length and no journey.
    const dated = DATED.test(sentence)
    if (dated && !inAny(quotes, s.start)) for (const f of nowClaims(sentence, s.start, ctx, quotes)) add(f)
    if (dated && ctx.events.length) for (const f of eventDates(sentence, s.start, ctx)) add(f)
    if (LENGTHY.test(sentence)) {
      if (/\b(?:since|ago)\b/i.test(sentence)) for (const f of elapsedClaims(sentence, s.start, ctx)) add(f)
      if (ctx.routes.length) for (const f of journeyClaims(sentence, s.start, ctx)) add(f)
    }
    if (s.start < opening && !inAny(quotes, s.start)) for (const f of openingClaims(sentence, s.start, ctx)) add(f)
  }
  return out.sort((a, b) => a.start - b.start)
}

/** A month, a weekday, a season or a year somewhere in some words. */
const DATED = new RegExp(String.raw`${MONTH}|\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|[Ss]pring|[Ss]ummer|[Aa]utumn|[Ww]inter|[Mm]idsummer|[Mm]idwinter)\b|(?<![\p{L}\p{N}])[12]\d{3}(?![\p{L}\p{N}])`, 'u')
/** A length of time somewhere in some words. */
const LENGTHY = /\b(?:hours?|days?|nights?|weeks?|fortnights?|months?|years?)\b/i

/** The scene's date in words, for a message: "12 June 1820", "Day 8". */
const dateWords = (ctx: TimeContext): string => ctx.date?.date || (ctx.date?.day ? `Day ${ctx.date.day}` : '')

/** A month, weekday, year or season given as now (a frame, or a dateline), against what the calendar has. */
function judgeSaid(said: Said, ctx: TimeContext): TimeFinding[] {
  const out: TimeFinding[] = []
  const when = dateWords(ctx)
  const on = when ? ` (${when})` : ''
  const one = (kind: TimeClaimKind, w: { at: number; word: string }, message: string, fix: string | null, severity: 'warning' | 'minor' = 'warning'): void => {
    out.push({ kind, start: w.at, end: w.at + w.word.length, words: w.word, message, fix, severity, sources: [] })
  }
  // A story that counts its days, with no month or year on any card or in the codex: one given as now is made up.
  if (ctx.counted) {
    if (said.month && !ctx.knownMonths.has(said.month.n))
      one(
        'invented',
        said.month,
        `The story counts its days${on} and no scene card or codex entry names a month, so ${said.month.word} is new here. Keep it, or take it out?`,
        null,
        'minor'
      )
    if (said.year && !ctx.knownYears.has(said.year.n))
      one(
        'invented',
        said.year,
        `The story counts its days${on} and no scene card or codex entry names a year, so ${said.year.word} is new here. Keep it, or take it out?`,
        null,
        'minor'
      )
  }
  const m = ctx.month
  if (said.month && m !== null) {
    const n = said.month.n
    if (Number.isInteger(m)) {
      // The last day or two of a month may run into the next, and the first into the one before.
      const edge =
        ctx.day !== null &&
        ((n === (m % 12) + 1 && ctx.day >= 28) || (m === (n % 12) + 1 && ctx.day <= 1))
      if (n !== m && !edge)
        one('month', said.month, `This says it is ${said.month.word}, but by the scene cards this scene is in ${MONTH_NAMES[m - 1]}${on}.`, MONTH_NAMES[m - 1])
      else if (n === m && said.day && ctx.day !== null && Math.abs(said.day.n - ctx.day) >= 2) {
        const right = /^\d/.test(said.day.word) ? String(ctx.day) : sameCase(said.day.word, ORDINALS[ctx.day])
        one('day', said.day, `This says it is the ${ORDINALS[said.day.n]} of ${said.month.word}, but by the scene cards this scene is on ${when || `the ${ORDINALS[ctx.day]}`}.`, right)
      }
    } else {
      // The card names a season: a month in it, or a month either side, fits.
      const season = seasonOfMonth(m)
      if (!SEASON_MONTHS[season].includes(n))
        one('month', said.month, `This says it is ${said.month.word}, but the scene card says ${season}.`, null)
    }
  }
  if (said.year && ctx.year !== null && said.year.n !== ctx.year) {
    const edge = ctx.month === 12 && (ctx.day ?? 0) >= 31 && said.year.n === ctx.year + 1
    if (!edge) one('year', said.year, `This says it is ${said.year.word}, but by the scene cards this scene is in ${ctx.year}${on}.`, String(ctx.year))
  }
  if (said.weekday && ctx.weekday && said.weekday.name !== ctx.weekday) {
    // A night scene may run past midnight into the next day.
    const next = WEEKDAYS[(WEEKDAYS.indexOf(ctx.weekday) + 1) % 7]
    const late = !!ctx.date?.span && ctx.date.span[1] > 1440 && said.weekday.name === next
    if (!late) one('weekday', said.weekday, `This says it is ${said.weekday.word}, but by the scene cards this scene is on a ${ctx.weekday}${on}.`, ctx.weekday)
  }
  if (said.season && m !== null) {
    const fits = Number.isInteger(m) ? SEASON_MONTHS[said.season.name].includes(m) : SEASON_CORE[seasonOfMonth(m)].some((x) => SEASON_MONTHS[said.season!.name].includes(x))
    if (!fits) {
      const right = seasonOfMonth(m)
      const where = Number.isInteger(m) ? `by the scene cards this scene is in ${MONTH_NAMES[m - 1]}${on}` : `the scene card says ${right}`
      one('season', said.season, `This says it is ${said.season.word}, but ${where}.`, sameCase(said.season.word, right))
    }
  }
  return out
}

/** A month, weekday, year or season the narration gives as now ("It was a raw March morning"). */
function nowClaims(sentence: string, base: number, ctx: TimeContext, quotes: readonly QuoteSpan[]): TimeFinding[] {
  const out: TimeFinding[] = []
  FRAME.lastIndex = 0
  for (const m of sentence.matchAll(FRAME)) {
    const from = (m.index ?? 0) + m[0].length
    if (inAny(quotes, base + (m.index ?? 0))) continue
    const rest = sentence.slice(from)
    const cut = CLAUSE_END.exec(rest)
    // "It was March when they came", "It was a Tuesday before the letter came": a memory of then, not now.
    if (cut && /^[\s,]*(?:when|before|after|since|until|till|who|that|which)\b/i.test(rest.slice(cut.index))) continue
    const words = cut ? rest.slice(0, cut.index) : rest
    if (words.split(/\s+/).filter(Boolean).length > 9) continue
    const said = readFrame(words, base + from)
    if (said) out.push(...judgeSaid(said, ctx))
  }
  return out
}

/** A line that is only a date ("Linmouth, March 1847"), given as now. */
function datelines(text: string, ctx: TimeContext): TimeFinding[] {
  const out: TimeFinding[] = []
  let at = 0
  for (const line of text.split('\n')) {
    const t = line.trim()
    const start = at + line.indexOf(t)
    at += line.length + 1
    if (!t || t.length > 60) continue
    const m = DATELINE.exec(t)
    if (!m) continue
    const said: Said = {}
    if (m[1]) said.month = { n: monthNo(m[1]), at: start + t.indexOf(m[1]), word: m[1] }
    const year = m[2] ?? m[4]
    if (year) said.year = { n: Number(year), at: start + t.lastIndexOf(year), word: year }
    if (m[3]) said.season = { name: seasonOfWord(m[3]), at: start + t.indexOf(m[3]), word: m[3] }
    out.push(...judgeSaid(said, ctx))
  }
  return out
}

// ---------- Dated events ----------

/** Little words that say nothing of which event: "the", "of", "at". */
const LITTLE = new Set(['the', 'a', 'an', 'of', 'at', 'in', 'on', 'to', 'and', 'for', 'with', 'from', 'by', 'great', 'old', 'first', 'last'])
const wordsOf = (s: string): string[] =>
  (s.toLowerCase().replace(/[’‘]/g, "'").match(/[\p{L}\p{N}']+/gu) ?? []).map((w) => w.replace(/'s$/, '').replace(/(?<=\p{L}{3})s$/u, ''))

/**
 * Where the words name the event (its name or another name: every word that picks it out, in one stretch of at most
 * eight words), or -1.
 */
function eventAt(words: string, e: Pick<DatedEvent, 'name' | 'aliases'>): number {
  const tokens = [...words.matchAll(/[\p{L}\p{N}’'‘]+/gu)].map((m) => ({ w: wordsOf(m[0])[0] ?? '', at: m.index ?? 0 }))
  for (const n of [e.name, ...e.aliases]) {
    const need = wordsOf(n).filter((w) => w.length >= 3 && !LITTLE.has(w))
    if (!need.length) continue
    for (let i = 0; i < tokens.length; i++) {
      if (!need.includes(tokens[i].w)) continue
      const near = tokens.slice(i, i + 8).map((t) => t.w)
      if (need.every((w) => near.includes(w))) return tokens[i].at
    }
  }
  return -1
}

/** The event's name for a sentence: "the mill fire", "Thaw Day". */
const eventName = (e: DatedEvent): string => e.name.trim().replace(/^The\b/, 'the')

/** Words between a date and an event that make the date another time: "in March, a year after the fire". */
const OTHER_TIME = /\b(?:after|before|since|until|till|ago|later|earlier|from|following)\b/i

/** A month or year said beside a dated event that is dated otherwise: "the fire, last March" (the fire was in June). */
function eventDates(sentence: string, base: number, ctx: TimeContext): TimeFinding[] {
  const out: TimeFinding[] = []
  const named = ctx.events.map((e) => ({ e, at: eventAt(sentence, e) })).filter((x) => x.at >= 0)
  if (named.length !== 1) return out
  const { e, at: eventStart } = named[0]
  const d = e.date
  /** True when a date at `at` is close by the event's words, with nothing between that makes it another time. */
  const beside = (at: number): boolean => {
    const [a, b] = at < eventStart ? [at, eventStart] : [eventStart, at]
    const between = sentence.slice(a, b)
    return b - a <= 60 && !OTHER_TIME.test(between.replace(/^\S+/, ''))
  }
  const source: IssueSource[] = [{ kind: 'entry', entryId: e.id, name: e.name, field: 'when' }]
  // A month, read as a month only with words of time around it ("last March", "in May", "March 1819").
  const month = new RegExp(
    String.raw`(?:(?<![\p{L}])(?:[Ii]n|[Oo]f|[Ll]ast|[Tt]hat|[Ee]arly|[Ll]ate|[Mm]id|[Tt]he)\s+|-)${MONTH}(?![\p{L}])|(?<![\p{L}])${MONTH}\s+(?:\d{1,2}(?:st|nd|rd|th)?|of\s+\d{4}|\d{4})`,
    'u'
  ).exec(sentence)
  const word = month ? (month[1] ?? month[2]) : null
  if (month && word && d.month !== null && Number.isInteger(d.month) && monthNo(word) !== d.month) {
    const at = (month.index ?? 0) + month[0].indexOf(word)
    if (beside(at))
      out.push({
        kind: 'event-date',
        start: base + at,
        end: base + at + word.length,
        words: word,
        message: `This puts ${eventName(e)} in ${word}, but the codex dates it ${d.date || MONTH_NAMES[d.month - 1]}.`,
        fix: MONTH_NAMES[d.month - 1],
        severity: 'warning',
        sources: source
      })
  }
  const year = /(?<![\p{L}\p{N}])(1\d{3}|2\d{3})(?![\p{L}\p{N}])/u.exec(sentence)
  if (year && d.year !== null && !d.yearWord && Number(year[1]) !== d.year && beside(year.index)) {
    out.push({
      kind: 'event-date',
      start: base + year.index,
      end: base + year.index + year[1].length,
      words: year[1],
      message: `This puts ${eventName(e)} in ${year[1]}, but the codex dates it ${d.date || String(d.year)}.`,
      fix: String(d.year),
      severity: 'warning',
      sources: source
    })
  }
  return out
}

// ---------- How long since ----------

const SPAN_UNIT = String.raw`(day|night|week|fortnight|month|year)s?`
/** A length of time: the whole words, then hedge, count, unit and "and a half". */
const LENGTH = String.raw`((?:(${HEDGE})\s+)?(${COUNT})\s+${SPAN_UNIT}(\s+and\s+a\s+half)?)`
/** Days in each unit (a month and a year on average). */
const UNIT_DAYS: Record<string, number> = { day: 1, night: 1, week: 7, fortnight: 14, month: 30.44, year: 365.24 }
/** Words that make a length nobody's sum: "it feels like three weeks", "must be a month". */
const NOBODYS_SUM = /(?:feels?|felt|seems?|seemed)\s+like\s+$|as\s+(?:if|though)\s+$|(?:must|might|could)\s+(?:be|have\s+been)\s+$|\b(?:perhaps|maybe|surely)\s+$/i

/** "three weeks since the fire", "four days had passed since we left Linmouth": the length, and what it counts from. */
const SINCE = new RegExp(
  String.raw`(?<![\p{L}])${LENGTH}\s+(?:had\s+(?:passed|gone\s+by|gone)\s+|have\s+(?:passed|gone\s+by)\s+|now\s+|already\s+)?since\s+([^,;.!?—–”"’]{2,80})`,
  'giu'
)
/** "two years ago". */
const AGO = new RegExp(String.raw`(?<![\p{L}])${LENGTH}\s+ago\b`, 'giu')
/** "we left Linmouth", "Mara had left the Wheatsheaf". */
const LEFT =
  /^(?:(?:we|they|he|she|i|you|\p{Lu}[\p{L}'’-]+(?:\s+and\s+\p{Lu}[\p{L}'’-]+)?)\s+)?(?:had\s+|['’]d\s+)?(?:left|departed(?:\s+from)?|quit|set\s+out\s+from|sailed\s+from|rode\s+(?:out\s+)?(?:of|from)|fled|came\s+away\s+from)\s+(.+)$/iu

/** What a length is counted from: a dated event, the last scene at a place left, or a year. */
interface From {
  /** Its date (null for a bare year). */
  date: StoryDate | null
  /** In words: "the mill fire (Day 2)", "the scene at Linmouth (Ch 1, Sc 3, Day 2)", "1815". */
  what: string
  /** For a bare year: the years from it to this scene's year. */
  years?: number
  sources: IssueSource[]
}

/** What `words` count from (the words after "since"; for "ago", the whole sentence), or null when it isn't known. */
function fromWhat(words: string, ctx: TimeContext, ago: boolean): From | null {
  const t = words.trim()
  const year = ago ? /\bin\s+(1\d{3}|2\d{3})\b/i.exec(t) : /^(?:in\s+)?(1\d{3}|2\d{3})\b/i.exec(t)
  if (year) return ctx.year !== null ? { date: null, what: year[1], years: ctx.year - Number(year[1]), sources: [] } : null
  const left = ago ? null : LEFT.exec(t)
  if (left) {
    const rest = left[1].trim()
    const place = placesIn(rest, ctx.places).find((p) => p.start <= 4)
    const at = place ? ctx.lastAt(place.id) : null
    if (!place || !at) return null
    const name = ctx.places.find((p) => p.id === place.id)?.name ?? rest
    return {
      date: at.date,
      what: `the scene at ${name} (${at.label}${at.date.date ? `, ${at.date.date}` : ''})`,
      sources: [{ kind: 'scene', sceneId: at.sceneId, label: at.label }]
    }
  }
  const events = ctx.events.filter((e) => eventAt(t, e) >= 0)
  if (events.length !== 1) return null
  const e = events[0]
  return { date: e.date, what: `${eventName(e)}${e.date.date ? ` (${e.date.date})` : ''}`, sources: [{ kind: 'entry', entryId: e.id, name: e.name, field: 'when' }] }
}

/** How far off a length may be: a quarter either way (at least a day), more for months and years, twice as much when hedged. */
function tolerance(claimDays: number, unit: string, hedged: boolean, rough: boolean): number {
  const base =
    unit === 'year'
      ? Math.max(120, claimDays * 0.2)
      : unit === 'month'
        ? Math.max(10, claimDays * 0.25)
        : unit === 'week' || unit === 'fortnight'
          ? Math.max(2, claimDays * 0.25)
          : Math.max(1, Math.round(claimDays * 0.25))
  return (base + (rough ? 31 : 0)) * (hedged ? 2 : 1)
}

/** "three weeks since the fire", "the fire, two years ago", "four days since we left Linmouth", against the calendar. */
function elapsedClaims(sentence: string, base: number, ctx: TimeContext): TimeFinding[] {
  const out: TimeFinding[] = []
  if (!ctx.date) return out
  const here = dateWords(ctx)
  const judge = (m: RegExpMatchArray, from: From | null, ago: boolean): void => {
    const [, said, hedge, count, unitRaw, half] = m
    const unit = unitRaw.toLowerCase()
    const n = countOf(count)
    const at = m.index ?? 0
    if (n === null || !from) return
    // "It feels like three weeks", "three weeks or so": nobody's sum.
    if (NOBODYS_SUM.test(sentence.slice(Math.max(0, at - 30), at)) || /^\s*,?\s*or\s+(?:so|more|less|two|three|four)\b/i.test(sentence.slice(at + said.length)))
      return
    const claim = (n + (half ? 0.5 : 0)) * UNIT_DAYS[unit]
    let actual: number
    let rough: boolean
    let gap: string
    if (from.years !== undefined) {
      if (unit !== 'year' && unit !== 'month') return
      actual = from.years * UNIT_DAYS.year
      rough = true
      gap = from.years === 1 ? 'a year' : `${from.years} years`
      if (from.years < 0) return
    } else {
      const e = elapsedBetween(from.date, ctx.date)
      if (!e || e.days < 0) return
      actual = e.days
      rough = e.months !== undefined
      gap = elapsedWords(e)
    }
    if (Math.abs(actual - claim) <= tolerance(claim, unit, !!hedge, rough)) return
    const right = from.years === undefined && !rough ? daysWords(actual) : null
    const words = clean(said)
    const scene = here ? ` (${here})` : ''
    const message =
      from.years !== undefined
        ? `This says ${from.what} was ${words.toLowerCase()} ${ago ? 'ago' : 'before'}, but this scene is in ${ctx.year}: ${gap}.`
        : ago
          ? `This says ${from.what} was ${words.toLowerCase()} ago, but by the story calendar it was ${gap} before this scene${scene}.`
          : `This says ${words.toLowerCase()} since ${from.what}, but by the story calendar it is ${gap} to this scene${scene}.`
    out.push({
      kind: 'elapsed',
      start: base + at,
      end: base + at + said.length,
      words: said,
      message,
      fix: right ? sameCase(said, right) : null,
      severity: 'warning',
      sources: from.sources
    })
  }
  SINCE.lastIndex = 0
  for (const m of sentence.matchAll(SINCE)) judge(m, fromWhat(m[6], ctx, false), false)
  AGO.lastIndex = 0
  for (const m of sentence.matchAll(AGO)) judge(m, fromWhat(sentence, ctx, true), true)
  return out
}

// ---------- How a scene opens ----------

const OPEN_NEXT = /^(?:it\s+was\s+)?((?:the\s+next|next|the\s+following)\s+(morning|day|afternoon|evening|night|dawn))\b/i
const OPEN_SAME = /^(?:it\s+was\s+)?((?:that\s+(?:same\s+)?|later\s+that\s+|the\s+same\s+|by\s+that\s+)(morning|day|afternoon|evening|night))\b/i
const OPEN_LATER = new RegExp(String.raw`^((?:(${HEDGE})\s+)?(${COUNT})\s+(day|night|week|fortnight|month|year)s?(\s+and\s+a\s+half)?\s+(?:later|on|after\s+that|afterwards?|had\s+passed))\b`, 'iu')

/** "The next morning", "That night", "Three days later" opening the scene, against how far its card is from the scene before's. */
function openingClaims(sentence: string, base: number, ctx: TimeContext): TimeFinding[] {
  const prev = ctx.previous
  if (!ctx.date || !prev || ctx.date.back) return []
  const e = elapsedBetween(prev.date, ctx.date)
  if (!e || e.months !== undefined || e.days < 0) return []
  const d = e.days
  const lead = sentence.length - sentence.trimStart().length
  const s = sentence.slice(lead).replace(/^["“‘']/, '')
  const offset = base + lead + (sentence.slice(lead).length - s.length)
  const before = `${prev.label}${prev.date.date ? `: ${prev.date.date}${prev.date.time ? `, ${prev.date.time}` : ''}` : ''}`
  const gap = d === 0 ? 'the same day as the scene before' : `${elapsedWords(e)} after the scene before`
  const found = (words: string, fix: string | null): TimeFinding => {
    const at = offset + s.indexOf(words)
    return {
      kind: 'opening',
      start: at,
      end: at + words.length,
      words,
      message: `This scene opens “${words}”, but by the scene cards it is ${gap} (${before}).`,
      fix,
      severity: 'warning',
      sources: [{ kind: 'scene', sceneId: prev.sceneId, label: prev.label }]
    }
  }
  const timeFix = (words: string, time: string): string | null => {
    if (d === 0) return sameCase(words, time === 'day' ? 'later that day' : `later that ${time}`)
    if (d === 1) return sameCase(words, `the next ${time}`)
    const w = daysWords(d)
    return w ? sameCase(words, `${w} later`) : null
  }
  let m = OPEN_NEXT.exec(s)
  if (m) {
    // After a scene in the small hours, "the next morning" may be the same day.
    const smallHours = prev.date.minute !== null && prev.date.minute < 300
    if ((d === 0 && !smallHours) || d >= 2) return [found(m[1], timeFix(m[1], m[2].toLowerCase()))]
    return []
  }
  m = OPEN_SAME.exec(s)
  if (m) {
    // "That night" for a scene in the small hours after the one before.
    const afterMidnight = d === 1 && ctx.date.minute !== null && ctx.date.minute < 300
    if (d >= 1 && !afterMidnight) return [found(m[1], timeFix(m[1], m[2].toLowerCase()))]
    return []
  }
  m = OPEN_LATER.exec(s)
  if (m) {
    const n = countOf(m[3])
    const unit = m[4].toLowerCase()
    if (n === null) return []
    const claim = (n + (m[5] ? 0.5 : 0)) * UNIT_DAYS[unit]
    if (Math.abs(d - claim) > tolerance(claim, unit, !!m[2], false)) {
      const w = daysWords(d)
      return [found(m[1], w ? sameCase(m[1], `${w} later`) : null)]
    }
  }
  return []
}

// ---------- Journeys ----------

/** A journey's length the words give between two places, against what the codex's place entries say of them. */
function journeyClaims(sentence: string, base: number, ctx: TimeContext): TimeFinding[] {
  if (!ctx.routes.length) return []
  const out: TimeFinding[] = []
  for (const r of routesIn(sentence, ctx.places, ctx.here)) {
    const a = placeChain(r.a, ctx.parents)
    const b = placeChain(r.b, ctx.parents)
    const known = ctx.routes.filter((k) => joins(k, a, b))
    const same = known.filter((k) => k.mode !== null && k.mode === r.mode)
    const fair = same.length ? same : known.filter((k) => k.mode === null || r.mode === null)
    if (!fair.length) continue
    // The one nearest what the words say: only when even that is twice as long or half as long (three times, hedged).
    const ratio = (k: Route): number => Math.max(k.hours, r.hours) / Math.min(k.hours, r.hours)
    const k = fair.reduce((x, y) => (ratio(y) < ratio(x) ? y : x))
    if (ratio(k) < (r.hedged || k.hedged ? 3 : 2)) continue
    const at = sentence.indexOf(r.words)
    const names = new Map(ctx.places.map((p) => [p.id, p.name]))
    out.push({
      kind: 'journey',
      start: base + at,
      end: base + at + r.words.length,
      words: r.words,
      message: `This says ${clean(r.words)} between ${names.get(r.a) ?? 'here'} and ${names.get(r.b) ?? 'here'}, but the codex entry for ${k.entryName} says about ${lengthWords(k.hours, k.unit)}${k.how ? ` ${k.how}` : ''}.`,
      fix: null,
      severity: 'warning',
      sources: [{ kind: 'entry', entryId: k.entryId, name: k.entryName, field: null }]
    })
  }
  return out
}
