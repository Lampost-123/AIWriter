// Reading the in-world date in a scene card's When box (or an event's When field), so the timeline can
// put scenes in the order things happen in the world. Pure functions, tested in when.test.ts.
//
// The box is free text in Adam's own words ("Day 12, Year 3, dusk", "the 3rd of March 1204", "two days
// later"), and custom calendars are out of scope, so this is forgiving: it picks out a year, a month (or a
// season), a day, a time of day, or a step from the scene before ("the next day"), and ignores words it
// doesn't know ("Day 12 of the siege"). It never invents a date: text it can't read is left undated and
// the timeline keeps it in reading order, marked "No date". The text Adam typed is always what is shown.
//
// Readings chosen (each is tested):
// - "Day 12" is a count of days (no month); "the 12th" or a bare 12 is a day of the month when a month
//   is known from the scene before.
// - A date that leaves out the larger units takes them from the dated scene before it in reading order:
//   "Day 14" after "Day 12, Year 3" is in Year 3. Nothing wraps round: "March" after "December, Year 2"
//   is March of Year 2, since only Adam knows whether the story jumped a year or looked back.
// - A time of day on its own ("Dusk") is later on the same day as the scene before, for ordering only:
//   it never counts as naming a day, so it can't make a clash.
// - Slashed dates are day/month/year unless the middle number can't be a month.
// - "Before" or "after" something the parser doesn't know ("the winter before the war") makes the
//   text unreadable, rather than misplacing it.

/** What a When text says, as far as it can be read. Unknown parts are null. */
export interface WhenParts {
  year: number | null
  /** 1 to 12, or a season's place among the months (spring 3.5 ... winter 12.5). */
  month: number | null
  /** A day of the month, or a count of days when `dayCount` ("Day 12"). */
  day: number | null
  dayCount: boolean
  /** Minutes after midnight: dawn 330, dusk 1110, midnight 1440. */
  minute: number | null
  /**
   * A step from the dated scene before: "the next day" is one day, "a year later" one year. Vague
   * steps ("days later") order the scene after the one before but don't name a day.
   */
  step: { unit: 'day' | 'year'; n: number; vague?: boolean } | null
  /** "Next spring", "the following March": the next time that month or season comes round after the scene before. */
  next: boolean
}

/** A When text placed among the others: a sort key, and the in-world day it names, if it names one. */
export interface PlacedWhen {
  /** [year, month, day, minute]; compare with compareKeys. */
  key: number[]
  /** The same string for every text that names the same in-world day; null when no day is named. */
  day: string | null
}

// prettier-ignore
const MONTHS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5, june: 6, jun: 6, july: 7, jul: 7,
  august: 8, aug: 8, september: 9, sep: 9, sept: 9, october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12
}

const SEASONS: Record<string, number> = { spring: 3.5, summer: 6.5, autumn: 9.5, fall: 9.5, winter: 12.5, midsummer: 6.5, midwinter: 12.5 }

/** Times of day in minutes after midnight. Two-word ones are joined with a space. */
// prettier-ignore
const TIMES: Record<string, number> = {
  'small hours': 180, 'before dawn': 270, 'first light': 330, dawn: 330, daybreak: 330, sunrise: 360, sunup: 360, morning: 540,
  breakfast: 480, forenoon: 630, noon: 720, midday: 720, lunch: 750, lunchtime: 750, afternoon: 900, teatime: 1020, sunset: 1110,
  sundown: 1110, dusk: 1110, twilight: 1125, evening: 1170, dinner: 1140, supper: 1170, nightfall: 1200, 'after dark': 1230,
  night: 1320, nighttime: 1320, bedtime: 1350, midnight: 1440, 'after midnight': 60
}

/** How early or late shifts a time of day or a season. */
const EARLY_LATE: Record<string, { time: number; season: number }> = {
  early: { time: -90, season: -0.6 },
  late: { time: 90, season: 0.6 },
  mid: { time: 0, season: 0 }
}

// prettier-ignore
const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen',
  'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 }
// prettier-ignore
const ORDINALS = ['zeroth', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh',
  'twelfth', 'thirteenth', 'fourteenth', 'fifteenth', 'sixteenth', 'seventeenth', 'eighteenth', 'nineteenth']
// prettier-ignore
const TENTHS: Record<string, number> = {
  twentieth: 20, thirtieth: 30, fortieth: 40, fiftieth: 50, sixtieth: 60, seventieth: 70, eightieth: 80, ninetieth: 90
}

/** Words that tie the date to something else ("the winter before the war"): the text can only be read if what follows is a time. */
const TIES = new Set(['before', 'after', 'since', 'until', 'till', 'prior', 'ago', 'following', 'preceding'])

interface Num {
  value: number
  ordinal: boolean
  /** Tokens it took. */
  used: number
}

/** A number written in figures or words at tokens[i], with how many tokens it took ("twenty first" is two). */
function readNumber(tokens: string[], i: number): Num | null {
  const t = tokens[i]
  if (t === undefined) return null
  const fig = /^(\d{1,6})(st|nd|rd|th)?$/.exec(t)
  if (fig) return { value: Number(fig[1]), ordinal: !!fig[2], used: 1 }
  const one = ONES.indexOf(t)
  if (one >= 0) return { value: one, ordinal: false, used: 1 }
  const ord = ORDINALS.indexOf(t)
  if (ord >= 0) return { value: ord, ordinal: true, used: 1 }
  if (t in TENTHS) return { value: TENTHS[t], ordinal: true, used: 1 }
  if (t in TENS) {
    const next = tokens[i + 1]
    const unit = next ? ONES.indexOf(next) : -1
    if (unit > 0 && unit < 10) return { value: TENS[t] + unit, ordinal: false, used: 2 }
    const unitOrd = next ? ORDINALS.indexOf(next) : -1
    if (unitOrd > 0 && unitOrd < 10) return { value: TENS[t] + unitOrd, ordinal: true, used: 2 }
    return { value: TENS[t], ordinal: false, used: 1 }
  }
  if (t === 'a' || t === 'an') {
    // "a day later", "a week later": only as the start of a step, checked by the caller.
    return { value: 1, ordinal: false, used: 1 }
  }
  return null
}

/** Splits a When text into lower-case words, keeping dates and clock times whole. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/\b([ap])\.\s?m\.?(?=\s|$|[,;)])/g, '$1m')
    .replace(/(\d)\s*(am|pm)\b/g, '$1$2')
    .split(/[\s,;()]+/)
    .flatMap((w) => {
      const word = w.replace(/^[.'"!?]+|[.'"!?:]+$/g, '')
      if (/^-?\d{1,6}-\d{1,2}-\d{1,2}$/.test(word) || /^\d{1,2}\/\d{1,2}\/\d{1,6}$/.test(word)) return [word]
      if (/^\d{1,2}[:.]\d{2}(am|pm)?$/.test(word)) return [word.replace('.', ':')]
      return word.split(/[-/]+/)
    })
    .filter(Boolean)
}

// prettier-ignore
const STEP_UNITS: Record<string, { unit: 'day' | 'year'; n: number }> = {
  day: { unit: 'day', n: 1 }, days: { unit: 'day', n: 1 }, week: { unit: 'day', n: 7 }, weeks: { unit: 'day', n: 7 },
  fortnight: { unit: 'day', n: 14 }, fortnights: { unit: 'day', n: 14 }, year: { unit: 'year', n: 1 }, years: { unit: 'year', n: 1 },
  night: { unit: 'day', n: 1 }, nights: { unit: 'day', n: 1 }, hour: { unit: 'day', n: 0 }, hours: { unit: 'day', n: 0 },
  minute: { unit: 'day', n: 0 }, minutes: { unit: 'day', n: 0 }, moment: { unit: 'day', n: 0 }, moments: { unit: 'day', n: 0 }
}
const LATER = new Set(['later', 'after', 'afterwards', 'afterward', 'on'])
const EARLIER = new Set(['earlier', 'before', 'previously', 'prior'])

/** A time of day at tokens[i] ("dusk", "late evening", "first light", "3pm", "15:30"), with the tokens it took. */
function readTime(tokens: string[], i: number): { minute: number; used: number } | null {
  const t = tokens[i]
  const shift = EARLY_LATE[t]
  if (shift && tokens[i + 1]) {
    const inner = readTime(tokens, i + 1)
    if (inner && !/\d/.test(tokens[i + 1])) return { minute: inner.minute + shift.time, used: inner.used + 1 }
  }
  const two = `${t} ${tokens[i + 1] ?? ''}`
  if (two in TIMES) return { minute: TIMES[two], used: 2 }
  if (t in TIMES) return { minute: TIMES[t], used: 1 }
  const clock = /^(\d{1,2})(?::(\d{2}))?(am|pm)?$/.exec(t)
  if (clock && (clock[2] !== undefined || clock[3])) {
    let h = Number(clock[1])
    const m = Number(clock[2] ?? 0)
    if (h > 24 || m > 59) return null
    if (clock[3] === 'pm' && h < 12) h += 12
    if (clock[3] === 'am' && h === 12) h = 0
    return { minute: h * 60 + m, used: 1 }
  }
  // "three o'clock", "3 o'clock"
  const n = readNumber(tokens, i)
  if (n && !n.ordinal && n.value >= 1 && n.value <= 12 && /^(o'clock|oclock)$/.test(tokens[i + n.used] ?? '')) {
    return { minute: n.value * 60, used: n.used + 1 }
  }
  if (n && !n.ordinal && n.value <= 12 && tokens[i + n.used] === 'o' && tokens[i + n.used + 1] === 'clock') {
    return { minute: n.value * 60, used: n.used + 2 }
  }
  return null
}

// When boxes repeat ("The next day") and are read again on every visit to the timeline, so each
// text is read once. Callers never change what comes back.
const read = new Map<string, WhenParts | null>()

/** Reads a When text. Null when nothing in it can be read as a date or time. */
export function parseWhen(text: string): WhenParts | null {
  const known = read.get(text)
  if (known !== undefined) return known
  if (read.size > 20_000) read.clear()
  const p = parseText(text)
  read.set(text, p)
  return p
}

function parseText(text: string): WhenParts | null {
  const tokens = tokenize(text)
  if (!tokens.length) return null
  const p: WhenParts = { year: null, month: null, day: null, dayCount: false, minute: null, step: null, next: false }
  const used = new Array<boolean>(tokens.length).fill(false)
  const take = (i: number, n: number): void => {
    for (let k = i; k < i + n; k++) used[k] = true
  }
  let found = false
  let blocked = false

  for (let i = 0; i < tokens.length; i++) {
    if (used[i]) continue
    const t = tokens[i]

    // ----- Whole dates -----
    const iso = /^(-?\d{1,6})-(\d{1,2})-(\d{1,2})$/.exec(t)
    if (iso && Number(iso[2]) >= 1 && Number(iso[2]) <= 12) {
      p.year = Number(iso[1])
      p.month = Number(iso[2])
      p.day = Number(iso[3])
      take(i, 1)
      found = true
      continue
    }
    const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{1,6})$/.exec(t)
    if (slash) {
      const [a, b] = [Number(slash[1]), Number(slash[2])]
      const [d, m] = b > 12 && a <= 12 ? [b, a] : [a, b]
      if (m >= 1 && m <= 12) {
        p.day = d
        p.month = m
        p.year = Number(slash[3])
        take(i, 1)
        found = true
        continue
      }
    }

    // ----- Steps from the scene before -----
    if (t === 'tomorrow' || t === 'yesterday') {
      p.step = { unit: 'day', n: t === 'tomorrow' ? 1 : -1 }
      take(i, 1)
      found = true
      continue
    }
    if ((t === 'next' || t === 'following') && tokens[i + 1]) {
      const next = tokens[i + 1]
      const time = readTime(tokens, i + 1)
      if (next === 'day' || next === 'night' || time) {
        p.step = { unit: 'day', n: 1 }
        if (time && next !== 'day') p.minute = time.minute
        take(i, 1 + (time ? time.used : 1))
        found = true
        continue
      }
      if (next === 'week' || next === 'year') {
        p.step = { unit: next === 'year' ? 'year' : 'day', n: next === 'year' ? 1 : 7 }
        take(i, 2)
        found = true
        continue
      }
      const month = MONTHS[next] ?? SEASONS[next]
      if (month !== undefined && p.month === null) {
        p.month = month
        p.next = true
        take(i, 2)
        found = true
        continue
      }
    }
    if (t === 'day' && (tokens[i + 1] === 'after' || tokens[i + 1] === 'before') && !tokens[i + 2]) {
      p.step = { unit: 'day', n: tokens[i + 1] === 'after' ? 1 : -1 }
      take(i, 2)
      found = true
      continue
    }
    if ((t === 'same' && tokens[i + 1] === 'day') || (t === 'that' && tokens[i + 1] === 'day')) {
      p.step = { unit: 'day', n: 0 }
      take(i, 2)
      found = true
      continue
    }
    if (t === 'later' && tokens[i + 1] === 'that') {
      const time = readTime(tokens, i + 2)
      if (tokens[i + 2] === 'day' || time) {
        p.step = { unit: 'day', n: 0 }
        if (time) p.minute = time.minute
        take(i, 2 + (time ? time.used : 1))
        found = true
        continue
      }
    }
    if (t === 'that') {
      const time = readTime(tokens, i + 1)
      if (time) {
        p.step = { unit: 'day', n: 0 }
        p.minute = time.minute
        take(i, 1 + time.used)
        found = true
        continue
      }
    }
    {
      // "two days later", "a week after", "three years earlier", "hours later"
      const n = readNumber(tokens, i)
      const at = n ? i + n.used : i
      const unit = STEP_UNITS[tokens[at]]
      const dir = tokens[at + 1]
      if (unit && dir && (LATER.has(dir) || EARLIER.has(dir)) && (n || /s$/.test(tokens[at]))) {
        // "the day after the battle": a tie to something unknown, not a step.
        if (!(dir === 'after' || dir === 'before') || !tokens[at + 2]) {
          const count = n && !n.ordinal ? n.value : 1
          p.step = { unit: unit.unit, n: unit.n * count * (EARLIER.has(dir) ? -1 : 1), vague: !n && unit.n !== 0 }
          take(i, at + 2 - i)
          found = true
          continue
        }
      }
    }
    if ((t === 'the' || t === 'a') && tokens[i + 1] && tokens[i + 2] === 'after' && !tokens[i + 3]) {
      // "the morning after"
      const time = readTime(tokens, i + 1)
      if (time) {
        p.step = { unit: 'day', n: 1 }
        p.minute = time.minute
        take(i, 3)
        found = true
        continue
      }
    }

    // ----- Times of day -----
    const time = readTime(tokens, i)
    if (time && p.minute === null) {
      p.minute = time.minute
      take(i, time.used)
      found = true
      continue
    }

    // ----- Labelled units: "Day 12", "Year three", "Month 4" -----
    if ((t === 'day' || t === 'year' || t === 'month' || t === 'y' || t === 'd') && tokens[i + 1]) {
      const n = readNumber(tokens, i + 1)
      if (n && !(tokens[i + 1] === 'a' || tokens[i + 1] === 'an')) {
        if (setUnit(p, t, n.value)) {
          take(i, 1 + n.used)
          found = true
          continue
        }
      }
    }
    {
      const yd = /^([yd])(\d{1,6})$/.exec(t)
      if (yd && setUnit(p, yd[1], Number(yd[2]))) {
        take(i, 1)
        found = true
        continue
      }
    }
    // "the 12th day", "third year", "4th month of Year 3"
    {
      const n = readNumber(tokens, i)
      const unit = n ? tokens[i + n.used] : undefined
      if (n && n.ordinal && (unit === 'day' || unit === 'year' || unit === 'month')) {
        if (setUnit(p, unit, n.value)) {
          take(i, n.used + 1)
          found = true
          continue
        }
      }
    }

    // ----- Months and seasons -----
    if (t in MONTHS) {
      p.month = MONTHS[t]
      take(i, 1)
      found = true
      // A day just before ("12 March", "the 12th of March").
      let b = i - 1
      while (b >= 0 && (tokens[b] === 'of' || tokens[b] === 'the') && !used[b]) b--
      const before = b >= 0 && !used[b] ? readNumber(tokens, b) : null
      if (before && before.used === 1 && before.value >= 1 && before.value <= 31 && p.day === null && tokens[b] !== 'a') {
        p.day = before.value
        take(b, i - b)
      }
      // A day and a year just after ("March 12th, 1204", "March 1204").
      let a = i + 1
      if (tokens[a] === 'the') a++
      const after = a < tokens.length && !used[a] ? readNumber(tokens, a) : null
      if (after && tokens[a] !== 'a' && tokens[a] !== 'an') {
        if (after.value >= 1 && after.value <= 31 && p.day === null && !/^\d{3,}$/.test(tokens[a])) {
          p.day = after.value
          take(a, after.used)
          a += after.used
          if (tokens[a] === 'of') a++
          const year = a < tokens.length && !used[a] ? readNumber(tokens, a) : null
          if (year && !year.ordinal && /^\d+$/.test(tokens[a]) && p.year === null) {
            p.year = year.value
            take(a, 1)
          }
        } else if (!after.ordinal && p.year === null && /^\d+$/.test(tokens[a])) {
          p.year = after.value
          take(a, 1)
        }
      }
      continue
    }
    const shift = EARLY_LATE[t]
    const season = SEASONS[shift ? (tokens[i + 1] ?? '') : t]
    if (season !== undefined && p.month === null) {
      p.month = season + (shift ? shift.season : 0)
      take(i, shift ? 2 : 1)
      found = true
      continue
    }

    // ----- Before Christ and the like, after a year -----
    if ((t === 'bc' || t === 'bce' || t === 'b') && p.year !== null && p.year > 0) {
      p.year = -p.year
      take(i, 1)
      continue
    }

    if (TIES.has(t)) blocked = true
  }

  // ----- Bare numbers: a day, then a year -----
  for (let i = 0; i < tokens.length; i++) {
    if (used[i]) continue
    const n = /^\d/.test(tokens[i]) ? readNumber(tokens, i) : null
    if (!n) continue
    if (n.value >= 1 && n.value <= 31 && p.day === null && (n.ordinal || p.year !== null || p.month !== null || tokens[i].length <= 2)) {
      p.day = n.value
    } else if (p.year === null && !n.ordinal) {
      p.year = n.value
      if (/^(bc|bce)$/.test(tokens[i + 1] ?? '')) p.year = -p.year
    } else continue
    used[i] = true
    found = true
  }

  // "Before" or "after" something unknown ties the text to an event this can't place, unless it names
  // a year or a day of its own ("Year 312 after the Founding").
  if (!found || (blocked && p.year === null && p.day === null)) return null
  return p
}

/** Sets a labelled unit ("Day 12", "Year 3"); false when it is already set. */
function setUnit(p: WhenParts, unit: string, value: number): boolean {
  if (unit === 'year' || unit === 'y') {
    if (p.year !== null) return false
    p.year = value
    return true
  }
  if (unit === 'month') {
    if (p.month !== null || value < 1 || value > 12) return false
    p.month = value
    return true
  }
  if (p.day !== null) return false
  p.day = value
  p.dayCount = true
  return true
}

const NONE = -Infinity

/** Compares two keys from placeWhens. */
export function compareKeys(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? NONE
    const y = b[i] ?? NONE
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

interface Known {
  year: number | null
  month: number | null
  day: number | null
  dayCount: boolean
  minute: number | null
}

const dayString = (k: Known): string => `${k.year ?? '?'}|${k.dayCount ? 'n' : (k.month ?? '?')}|${k.day}`

/**
 * Places When texts given in reading order: each readable one gets a sort key, using the dated text
 * before it for anything it leaves out; unreadable ones (and steps with nothing to step from) get null.
 */
export function placeWhens(texts: string[]): (PlacedWhen | null)[] {
  let prev: Known | null = null
  return texts.map((text) => {
    const p = parseWhen(text)
    if (!p) return null
    let k: Known
    let namesDay: boolean
    if (p.step) {
      if (!prev) return null
      if (p.step.unit === 'day') {
        if (prev.day === null) return null
        k = { year: prev.year, month: prev.month, day: prev.day + p.step.n, dayCount: prev.dayCount, minute: p.minute }
      } else {
        if (prev.year === null) return null
        k = { year: prev.year + p.step.n, month: p.month, day: p.day, dayCount: p.dayCount, minute: p.minute }
      }
      namesDay = k.day !== null && !p.step.vague
    } else if (p.next) {
      // The next time the month or season comes round: this year if it is still to come, else the next.
      if (!prev || prev.year === null) return null
      const later = prev.month !== null && !prev.dayCount && p.month! > prev.month
      k = { year: later ? prev.year : prev.year + 1, month: p.month, day: p.day, dayCount: false, minute: p.minute }
      namesDay = k.day !== null
    } else if (p.year === null && p.month === null && p.day === null) {
      // A time of day on its own: later on the same day as the scene before, for ordering only.
      if (!prev) return null
      k = { ...prev, minute: p.minute }
      namesDay = false
    } else {
      k = { year: p.year, month: p.month, day: p.day, dayCount: p.dayCount, minute: p.minute }
      if (prev) {
        // Larger units the text leaves out come from the dated scene before.
        if (k.year === null && (k.month !== null || k.day !== null)) k.year = prev.year
        if (k.month === null && k.day !== null && !k.dayCount && prev.month !== null && !prev.dayCount) k.month = prev.month
      }
      namesDay = k.day !== null
    }
    // A time left out on the same day as the scene before keeps that scene's time, so reading order decides.
    const sameDay = prev && prev.day !== null && dayString(prev) === dayString(k) && k.day !== null
    const minute = k.minute ?? (sameDay ? (prev!.minute ?? -1) : -1)
    prev = { ...k, minute }
    return {
      key: [k.year ?? NONE, k.dayCount ? NONE : (k.month ?? NONE), k.day ?? NONE, minute],
      day: namesDay ? dayString(k) : null
    }
  })
}

// prettier-ignore
const TIME_WORDS = new Set([
  ...Object.keys(TIMES).flatMap((t) => t.split(' ')),
  'early', 'late', 'at', 'in', 'the', 'on', 'around', 'about', 'by', 'o', 'clock', "o'clock", 'oclock', 'am', 'pm', 'later', 'that'
])

/**
 * The words of a When text that name the day, without its time of day, for sentences such as
 * "Mara is in Ashford and the Mill on Day 12": "Day 12, Year 3, dusk" gives "Day 12, Year 3".
 */
export function dayWords(text: string): string {
  const parts = text
    .split(/,|;|\bat\b/i)
    .map((s) => s.trim())
    .filter(Boolean)
  const kept = parts.filter((part) => {
    const words = part
      .toLowerCase()
      .replace(/\b(\d{1,2})([:.]\d{2})?\s*([ap]\.?\s?m\.?)/g, '')
      .split(/[\s-]+/)
      .filter(Boolean)
    return words.some((w) => !TIME_WORDS.has(w) && !/^\d{1,2}:\d{2}$/.test(w))
  })
  return kept.join(', ').replace(/\s+/g, ' ').trim()
}
