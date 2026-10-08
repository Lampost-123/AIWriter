// Pure helpers for the New look's timeline, "the river" (UI overhaul): where each scene and event sits along the world's
// time, the day and chapter bands over them, the time gaps between them in words, which scenes are told out of order,
// and what each lane draws (where a character is present, a thread opened and paid off). Tested in riverLogic.test.ts.
import type { ID } from '@shared/types'
import type { Timeline, TimelineChapter, TimelinePoint } from '@shared/contracts/worldViews'
import type { LaneMode } from './timelineLogic'

/** How the river is laid out: along the world's days (spaced by time where it can be read), or chapter by chapter in reading order. */
export type Zoom = 'day' | 'chapter'

const DAY = 1440

/** A point's in-world time, for spacing: its calendar ('y' for dates with a year) and minutes into it. */
export interface WorldTime {
  cal: string
  t: number
}

/**
 * A point's time from its sort key ([year, calendar, month, day, minute], null for a part not known). Null when it names
 * nothing to measure by (no year, month or day).
 */
export function timeOf(key: TimelinePoint['key']): WorldTime | null {
  if (!key) return null
  const [year, cal, month, day, minute] = key
  if (year === null && month === null && day === null) return null
  let t = 0
  if (year !== null && year !== undefined) t += year * 365.25 * DAY
  if (month !== null && month !== undefined) t += (month - 1) * 30.44 * DAY
  if (day !== null && day !== undefined) t += day * DAY
  if (minute !== null && minute !== undefined && minute >= 0) t += minute
  return { cal: cal === null || cal === undefined ? 'y' : `c${cal}`, t }
}

/** Minutes from one point to the next, when both can be measured in the same calendar; null otherwise. */
export function minutesBetween(a: WorldTime | null, b: WorldTime | null): number | null {
  if (!a || !b || a.cal !== b.cal) return null
  return Math.max(0, b.t - a.t)
}

/** The room a time gap adds between two cards, in pixels: none for none, a little for hours, more for days, capped for years. */
export function gapRoom(minutes: number | null, unit: number): number {
  if (!minutes || minutes <= 0) return 0
  return Math.round(Math.min(5, Math.log2(1 + minutes / 180)) * unit)
}

/**
 * A gap in plain words, for gaps of a day or more: "1 day later", "3 weeks later", "2 years later". '' for less. `days` is
 * how many calendar days apart (Day 1 at night to Day 3 in the morning is two days later, though under two days' time).
 */
export function gapWords(minutes: number | null, days = minutes === null ? 0 : Math.round(minutes / DAY)): string {
  if (minutes === null || minutes < DAY) return ''
  const say = (n: number, unit: string): string => `${n} ${unit}${n === 1 ? '' : 's'} later`
  if (days < 14) return say(days, 'day')
  if (days < 60) return say(Math.round(days / 7), 'week')
  if (days < 365 * 2 - 30) return say(Math.round(days / 30.44), 'month')
  return say(Math.round(days / 365.25), 'year')
}

/** How a scene is told: in step with the world, or out of order (a flashback, told after what happens later; or told early). */
export type Told = 'flashback' | 'early' | null

/**
 * Which scenes are told out of order, by index in world order. The scenes told in step are the longest run whose reading
 * order rises along the world's (so one scene moved doesn't mark everything after it); each other scene is a flashback
 * when it is read after a scene in step that happens later, otherwise told early. Events are never marked.
 */
export function toldOrder(points: Pick<TimelinePoint, 'kind' | 'order'>[]): Told[] {
  const scenes = points.flatMap((p, i) => (p.kind === 'scene' ? [i] : []))
  // Longest increasing run of reading order (patience sorting, with links back to rebuild it).
  const tails: number[] = []
  const back: number[] = new Array(scenes.length).fill(-1)
  scenes.forEach((pi, s) => {
    const o = points[pi].order
    let lo = 0
    let hi = tails.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (points[scenes[tails[mid]]].order < o) lo = mid + 1
      else hi = mid
    }
    back[s] = lo > 0 ? tails[lo - 1] : -1
    tails[lo] = s
  })
  const inStep = new Set<number>()
  for (let s = tails.length ? tails[tails.length - 1] : -1; s >= 0; s = back[s]) inStep.add(scenes[s])
  const out: Told[] = points.map(() => null)
  for (const pi of scenes) {
    if (inStep.has(pi)) continue
    // The next scene in step after it in the world: read before it means it's a flashback.
    let next = -1
    for (let j = pi + 1; j < points.length && next < 0; j++) if (inStep.has(j)) next = j
    out[pi] = next >= 0 && points[next].order < points[pi].order ? 'flashback' : 'early'
  }
  return out
}

/** One card on the river: which point, and where. */
export interface RiverItem {
  /** Index into the timeline's points. */
  i: number
  x: number
  w: number
}

/** A band over the river: a day, or a chapter. */
export interface RiverBand {
  key: string
  label: string
  /** "Ch 3" over the label, in chapter bands. */
  eyebrow: string
  x0: number
  x1: number
  /** Every other band is shaded a little, so neighbours read apart. */
  alt: boolean
}

export interface RiverLayout {
  items: RiverItem[]
  /** The river's width, from its left edge to the end of the last card and some room after it. */
  width: number
  bands: RiverBand[]
  /** Time gaps of a day or more, in words, at the middle of each gap. */
  gaps: { x: number; label: string }[]
  /** The card width used (it grows when the river would be shorter than the window). */
  cardW: number
}

export interface RiverSize {
  cardW: number
  /** The widest a card grows when there are few. */
  cardMax: number
  eventW: number
  gap: number
  /** Pixels per step of time gap (gapRoom). */
  unit: number
  /** Room before the first card and after the last. */
  pad: number
  /** The width the river fills at least (the window's). */
  minWidth: number
}

/** The chapter label in a band: "Ch 3", with the story's name when the timeline runs across stories. */
export function chapterEyebrow(c: TimelineChapter, manyStories: boolean): string {
  return manyStories ? `${c.story} · Ch ${c.no}` : `Ch ${c.no}`
}

/** The order cards are shown in: the timeline's (the world's) by day, reading order by chapter. */
export function shownOrder(points: Pick<TimelinePoint, 'order'>[], zoom: Zoom): number[] {
  const idx = points.map((_, i) => i)
  return zoom === 'day' ? idx : idx.sort((a, b) => points[a].order - points[b].order)
}

function place(
  t: Timeline,
  order: number[],
  zoom: Zoom,
  s: RiverSize,
  cardW: number,
  spread: number,
  squeeze = 1
): Omit<RiverLayout, 'cardW'> & { timeRoom: number } {
  let timeRoom = 0
  const items: RiverItem[] = []
  const gaps: { x: number; label: string }[] = []
  let x = s.pad
  let prevTime: WorldTime | null = null
  let prevChapter: ID | null | undefined
  order.forEach((i, n) => {
    const p = t.points[i]
    const w = p.kind === 'event' ? s.eventW : cardW
    const time = timeOf(p.key)
    if (n > 0) {
      const prev = items[n - 1]
      let room = s.gap + spread
      if (zoom === 'day') {
        const mins = minutesBetween(prevTime, time)
        const g = Math.floor(gapRoom(mins, s.unit) * squeeze)
        room += g
        timeRoom += g
        // A new calendar (a book that counts its days afresh): a clear break.
        if (prevTime && time && prevTime.cal !== time.cal) room += s.unit * 3
        const words = gapWords(mins, prevTime && time ? Math.floor(time.t / DAY) - Math.floor(prevTime.t / DAY) : undefined)
        if (words) gaps.push({ x: prev.x + prev.w + room / 2, label: words })
      } else if (p.chapterId && prevChapter && p.chapterId !== prevChapter) room += s.unit * 2
      x = prev.x + prev.w + room
    }
    items.push({ i, x, w })
    if (time) prevTime = time
    if (p.chapterId) prevChapter = p.chapterId
  })
  const last = items[items.length - 1]
  const width = last ? last.x + last.w + s.pad : s.pad * 2
  return { items, width, gaps, bands: bandsOf(t, items, zoom, s.gap), timeRoom }
}

/** The day (or chapter) bands over a laid-out river. */
interface OpenBand {
  key: string
  from: RiverItem
  to: RiverItem
  label: string
  eyebrow: string
}

function bandsOf(t: Timeline, items: RiverItem[], zoom: Zoom, gap: number): RiverBand[] {
  const chapters = new Map<ID, TimelineChapter>(t.chapters.map((c) => [c.id, c]))
  const many = new Set(t.chapters.map((c) => c.storyId)).size > 1
  const bands: RiverBand[] = []
  const open: { band: OpenBand | null } = { band: null }
  const close = (): void => {
    const b = open.band
    if (!b) return
    bands.push({
      key: b.key,
      label: b.label,
      eyebrow: b.eyebrow,
      x0: b.from.x - gap / 2,
      x1: b.to.x + b.to.w + gap / 2,
      alt: bands.length % 2 === 1
    })
    open.band = null
  }
  for (const it of items) {
    const p = t.points[it.i]
    // An event sits in the band it falls in, by day; by chapter it joins the chapter it's read in.
    const key: string | null = zoom === 'day' ? p.day : p.kind === 'event' ? (open.band?.key ?? null) : p.chapterId
    if (!key) {
      if (zoom === 'day' || p.kind !== 'event') close()
      continue
    }
    const cur = open.band
    if (cur && cur.key === key) {
      cur.to = it
      if (!cur.label && zoom === 'day') cur.label = p.dayLabel
      continue
    }
    close()
    const c: TimelineChapter | undefined = zoom === 'chapter' ? chapters.get(key) : undefined
    open.band = {
      key,
      from: it,
      to: it,
      label: zoom === 'day' ? p.dayLabel : c?.title || (c ? `Chapter ${c.no}` : ''),
      eyebrow: c ? chapterEyebrow(c, many) : ''
    }
  }
  close()
  return bands
}

/**
 * Lays the river out: each card's place along it, the bands over them, and the gaps in words. When the cards would end
 * short of the window, they grow (up to cardMax) and then spread out, so the river always fills it.
 */
export function layoutRiver(t: Timeline, zoom: Zoom, s: RiverSize): RiverLayout {
  const order = shownOrder(t.points, zoom)
  let cardW = s.cardW
  let laid = place(t, order, zoom, s, cardW, 0)
  // A little too long for the window: the time gaps give a little (keeping their proportions) rather than make it scroll.
  let squeeze = 1
  if (laid.width > s.minWidth && laid.timeRoom > 0 && 1 - (laid.width - s.minWidth) / laid.timeRoom >= 0.4) {
    squeeze = 1 - (laid.width - s.minWidth) / laid.timeRoom
    laid = place(t, order, zoom, s, cardW, 0, squeeze)
  }
  const scenes = t.points.filter((p) => p.kind === 'scene').length
  if (laid.width < s.minWidth && scenes) {
    cardW = Math.min(s.cardMax, cardW + Math.floor((s.minWidth - laid.width) / scenes))
    laid = place(t, order, zoom, s, cardW, 0, squeeze)
  }
  if (laid.width < s.minWidth && order.length > 1) {
    const spread = Math.min(s.unit * 8, Math.floor((s.minWidth - laid.width) / (order.length - 1)))
    laid = place(t, order, zoom, s, cardW, spread, squeeze)
  }
  const { timeRoom: _room, ...out } = laid
  return { ...out, width: Math.max(out.width, s.minWidth), cardW }
}

/** The cards in a stretch of the river (plus `over` pixels either side), as a range of item indexes [from, to). */
export function visibleRange(items: RiverItem[], left: number, right: number, over = 0): [number, number] {
  const lo = left - over
  const hi = right + over
  let a = 0
  let b = items.length
  while (a < b) {
    const m = (a + b) >> 1
    if (items[m].x + items[m].w < lo) a = m + 1
    else b = m
  }
  let end = a
  while (end < items.length && items[end].x <= hi) end++
  return [a, end]
}

/** What a lane draws at a card. */
export type LaneMarkKind = 'pov' | 'present' | 'event' | 'opened' | 'developed' | 'resolved' | 'both'

export interface LanePath {
  /** By item index (in the river's order). */
  marks: { item: number; kind: LaneMarkKind }[]
  /** Runs of cards next to each other where the character is present, or where a thread is open: drawn thick. */
  runs: [number, number][]
  /** The first and last item with a mark: the lane's thin line runs between them. */
  first: number
  last: number
  /** A plot thread still open at the end: its line trails off past its last mark. */
  openEnd: boolean
}

/**
 * What a lane draws along the river. A character: a mark where it is the point of view or present (or in an event), with
 * thick runs where it's in scenes one after another (an event it isn't in doesn't break a run). A plot thread: opened
 * where it's first set up, developed where it's set up again, resolved where it's paid off, thick while it's open.
 */
export function lanePath(points: TimelinePoint[], items: RiverItem[], laneId: ID, mode: LaneMode): LanePath | null {
  const marks: LanePath['marks'] = []
  const runs: [number, number][] = []
  let openEnd = false
  if (mode === 'characters') {
    let run: [number, number] | null = null
    items.forEach((it, n) => {
      const p = points[it.i]
      const here = p.povId === laneId || p.presentIds.includes(laneId)
      if (here) marks.push({ item: n, kind: p.kind === 'event' ? 'event' : p.povId === laneId ? 'pov' : 'present' })
      if (p.kind === 'event' && !here) return
      if (here && p.kind === 'scene') {
        if (run) run[1] = n
        else run = [n, n]
      } else if (run) {
        runs.push(run)
        run = null
      }
    })
    if (run) runs.push(run)
  } else {
    let opened: number | null = null
    items.forEach((it, n) => {
      const p = points[it.i]
      const up = p.setsUpIds.includes(laneId)
      const off = p.paysOffIds.includes(laneId)
      if (!up && !off) return
      if (up && off) {
        marks.push({ item: n, kind: opened === null ? 'both' : 'resolved' })
        if (opened !== null) runs.push([opened, n])
        opened = null
        return
      }
      if (up) {
        marks.push({ item: n, kind: opened === null ? 'opened' : 'developed' })
        if (opened === null) opened = n
        return
      }
      marks.push({ item: n, kind: 'resolved' })
      runs.push([opened ?? n, n])
      opened = null
    })
    if (opened !== null) {
      runs.push([opened, items.length - 1])
      openEnd = true
    }
  }
  if (!marks.length) return null
  return { marks, runs, first: marks[0].item, last: openEnd ? items.length - 1 : marks[marks.length - 1].item, openEnd }
}

/** A lane's height: the lanes share the room under the cards, between a readable least and a most. */
export function laneHeight(room: number, lanes: number, min = 56, max = 148): number {
  if (lanes <= 0) return max
  return Math.max(min, Math.min(max, Math.floor(room / lanes)))
}

/** A card's width for a river this wide: about six and a half to the window, within limits. */
export function cardWidth(viewWidth: number): number {
  return Math.max(196, Math.min(268, Math.round(viewWidth / 6.5)))
}

/** What the filter keeps: points with any picked character, plot thread or place (everything when nothing is picked). */
export function matchesFilter(p: TimelinePoint, ids: ReadonlySet<ID>): boolean {
  if (!ids.size) return true
  if (p.locationId && ids.has(p.locationId)) return true
  for (const id of p.presentIds) if (ids.has(id)) return true
  for (const id of p.setsUpIds) if (ids.has(id)) return true
  for (const id of p.paysOffIds) if (ids.has(id)) return true
  return false
}

/** The card the arrow keys move to from `at` (by item index), or null for a key that doesn't move. */
export function stepTo(at: number, key: string, count: number, page = 4): number | null {
  const to =
    key === 'ArrowRight' || key === 'ArrowDown'
      ? at + 1
      : key === 'ArrowLeft' || key === 'ArrowUp'
        ? at - 1
        : key === 'PageDown'
          ? at + page
          : key === 'PageUp'
            ? at - page
            : key === 'Home'
              ? 0
              : key === 'End'
                ? count - 1
                : null
  return to === null ? null : Math.max(0, Math.min(count - 1, to))
}

/** The time of day a key names, for the little sky on a card: null when no time is named. */
export function skyOf(key: TimelinePoint['key']): 'dawn' | 'day' | 'dusk' | 'night' | null {
  const m = key?.[4]
  if (m === null || m === undefined || m < 0) return null
  const h = (m % 1440) / 60
  if (h >= 4.5 && h < 7.5) return 'dawn'
  if (h >= 7.5 && h < 17.5) return 'day'
  if (h >= 17.5 && h < 20.5) return 'dusk'
  return 'night'
}

/** "299 words", "1,204 words", "No words yet". */
export const wordsLabel = (n: number): string => (n ? `${n.toLocaleString('en-GB')} ${n === 1 ? 'word' : 'words'}` : 'No words yet')

/** A scene's status in words. */
export const STATUS_WORDS: Record<TimelinePoint['status'], string> = {
  planned: 'Planned',
  drafted: 'Drafted',
  revised: 'Revised',
  done: 'Done'
}

/** Lanes in the order each first comes along the river (by day or by chapter); ones never on it keep their place at the end. */
export function byFirstAppearance<T extends { id: ID }>(t: Timeline, lanes: T[], mode: LaneMode, zoom: Zoom): T[] {
  const first = new Map<ID, number>()
  shownOrder(t.points, zoom).forEach((i, n) => {
    const p = t.points[i]
    const ids = mode === 'characters' ? [...(p.povId ? [p.povId] : []), ...p.presentIds] : [...p.setsUpIds, ...p.paysOffIds]
    for (const id of ids) if (!first.has(id)) first.set(id, n)
  })
  return lanes
    .map((l, k) => ({ l, k, at: first.get(l.id) ?? Infinity }))
    .sort((a, b) => a.at - b.at || a.k - b.k)
    .map((x) => x.l)
}
