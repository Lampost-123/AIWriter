// Writing by hand: the pure parts of word counts and the daily goal (tested in goalLogic.test.ts).
import type { WritingDay } from '@shared/types'

/** Words on a page, and words read in a minute: both 250. */
export const WORDS_PER_PAGE = 250

/** "about 4 pages, 4 min read"; "under a page, under a minute" for a few words; "no words yet" for none. */
export function sizeNote(words: number): string {
  if (words <= 0) return 'no words yet'
  const n = Math.round(words / WORDS_PER_PAGE)
  if (n < 1) return 'under a page, under a minute'
  return `about ${n.toLocaleString()} ${n === 1 ? 'page' : 'pages'}, ${n.toLocaleString()} min read`
}

/** "1 word", "1,234 words". */
export const wordsLabel = (n: number): string => `${n.toLocaleString()} ${n === 1 ? 'word' : 'words'}`

/** A local date as the days are kept: "2026-10-03". */
export function localDate(d: Date = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** The local date `n` days before `date` (both "2026-10-03"). */
export function daysBefore(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return localDate(new Date(y, m - 1, d - n))
}

/** How long days are kept: about a year. */
export const KEEP_DAYS = 366

/** The days, and each day's running totals as counted this session (which may dip below none for a moment). */
export interface DayTally {
  days: WritingDay[]
  running: Record<string, { typed: number; ai: number }>
}

/**
 * Adds counted words to a day (made if need be). The day keeps a running total, so a big delete undone straight
 * away comes back exactly; what is kept (and shown) never goes below none. Days of no words, or older than about a
 * year before `today`, go.
 */
export function addWords(t: DayTally, date: string, typed: number, ai: number, today: string): DayTally {
  const oldest = daysBefore(today, KEEP_DAYS)
  const stored = t.days.find((d) => d.date === date)
  const was = t.running[date] ?? { typed: stored?.typed ?? 0, ai: stored?.ai ?? 0 }
  const now = { typed: was.typed + typed, ai: was.ai + ai }
  const day = { date, typed: Math.max(0, now.typed), ai: Math.max(0, now.ai) }
  const days = [...t.days.filter((d) => d.date !== date), ...(date >= oldest ? [day] : [])]
    .filter((d) => d.date >= oldest && (d.typed > 0 || d.ai > 0))
    .map((d) => ({ ...d, typed: Math.max(0, d.typed), ai: Math.max(0, d.ai) }))
    .sort((x, y) => x.date.localeCompare(y.date))
  return { days, running: { ...t.running, [date]: now } }
}

/** A day's words (none when it isn't there). */
export const dayOf = (days: WritingDay[], date: string): WritingDay => days.find((d) => d.date === date) ?? { date, typed: 0, ai: 0 }

/**
 * The streak: days in a row the target was met, up to today (today counts once it is met; until then the streak
 * runs to yesterday). Typed words count towards the target. Null with no target.
 */
export function streakOf(days: WritingDay[], daily: number | null, today: string): { days: number; todayMet: boolean } | null {
  if (!daily || daily <= 0) return null
  const typed = new Map(days.map((d) => [d.date, d.typed]))
  const met = (date: string): boolean => (typed.get(date) ?? 0) >= daily
  const todayMet = met(today)
  let n = todayMet ? 1 : 0
  for (let date = daysBefore(today, 1); met(date) && n <= KEEP_DAYS; date = daysBefore(date, 1)) n++
  return { days: n, todayMet }
}

/** The streak in words: "3 days in a row", or what to do to start one. */
export function streakNote(s: { days: number; todayMet: boolean } | null): string | null {
  if (!s) return null
  if (s.days === 0) return 'Meet today’s target to start a streak.'
  const run = `${s.days.toLocaleString()} ${s.days === 1 ? 'day' : 'days'} in a row`
  return s.todayMet ? run : `${run}. Meet today’s target to keep it going.`
}

/** A daily target as typed into Settings: a whole number of words, or null for none (empty, 0 or nonsense). */
export function parseTarget(text: string): number | null {
  const n = Number(String(text).replace(/[,\s]/g, ''))
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.min(100_000, Math.round(n))
}
