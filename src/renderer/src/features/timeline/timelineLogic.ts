// Pure helpers for the timeline screen: which lanes to show, what each row shows in a lane, and the
// bands that group points on the same in-world day. Tested in timelineLogic.test.ts.
import type { ID } from '@shared/types'
import type { Timeline, TimelineEntry, TimelinePoint } from '@shared/contracts/worldViews'

/** Lanes follow characters (who is in each scene) or plot threads (where each is set up and paid off). */
export type LaneMode = 'characters' | 'threads'

/** How many lanes show before Adam picks his own, when there is room. */
export const DEFAULT_LANES = 6

/** The timeline's columns, in pixels: When, then the scene (at least INFO_MIN, at most INFO_MAX), then the lanes. */
export const WHEN_W = 184
export const INFO_MIN = 300
export const INFO_MAX = 520
export const LANE_W = 68

/** How many lanes show before Adam picks his own: as many as fit beside the scenes, up to DEFAULT_LANES. Unmeasured, the most. */
export function lanesThatFit(width: number): number {
  if (width <= 0) return DEFAULT_LANES
  return Math.max(1, Math.min(DEFAULT_LANES, Math.floor((width - WHEN_W - INFO_MIN) / LANE_W)))
}

/** How wide the scene column is beside this many lanes: what is left, within its limits (lanes after it may go off the side). */
export function infoWidth(width: number, lanes: number): number {
  return lanes ? Math.max(INFO_MIN, Math.min(INFO_MAX, width - WHEN_W - lanes * LANE_W)) : Math.max(INFO_MIN, width - WHEN_W)
}

/** What a point shows in a lane. */
export type Mark = 'pov' | 'present' | 'setUp' | 'paidOff' | 'both' | null

export function markOf(p: TimelinePoint, laneId: ID, mode: LaneMode): Mark {
  if (mode === 'characters') return p.povId === laneId ? 'pov' : p.presentIds.includes(laneId) ? 'present' : null
  const up = p.setsUpIds.includes(laneId)
  const off = p.paysOffIds.includes(laneId)
  return up && off ? 'both' : up ? 'setUp' : off ? 'paidOff' : null
}

/** Every possible lane with how many points it has, busiest first (then by name). */
export function laneChoices(t: Timeline, mode: LaneMode): { entry: TimelineEntry; count: number }[] {
  const kind = mode === 'characters' ? 'character' : 'thread'
  const counts = new Map<ID, number>()
  for (const p of t.points) {
    const ids = mode === 'characters' ? p.presentIds : [...new Set([...p.setsUpIds, ...p.paysOffIds])]
    for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return t.entries
    .filter((e) => e.kind === kind && counts.has(e.id))
    .map((entry) => ({ entry, count: counts.get(entry.id)! }))
    .sort((a, b) => b.count - a.count || a.entry.name.localeCompare(b.entry.name))
}

/**
 * The lanes to show: Adam's choice (those still on the timeline, in the order offered), or the
 * busiest few that fit until he makes one.
 */
export function shownLanes(t: Timeline, mode: LaneMode, chosen: ID[] | undefined, fit = DEFAULT_LANES): TimelineEntry[] {
  const choices = laneChoices(t, mode)
  if (!chosen) return choices.slice(0, fit).map((c) => c.entry)
  const want = new Set(chosen)
  return choices.filter((c) => want.has(c.entry.id)).map((c) => c.entry)
}

/** For each lane, the first and last row it has a mark in (the lane's line runs between them). */
export function laneSpans(points: TimelinePoint[], lanes: ID[], mode: LaneMode): Map<ID, { first: number; last: number }> {
  const spans = new Map<ID, { first: number; last: number }>()
  points.forEach((p, i) => {
    for (const id of lanes) {
      if (!markOf(p, id, mode)) continue
      const s = spans.get(id)
      if (s) s.last = i
      else spans.set(id, { first: i, last: i })
    }
  })
  return spans
}

/** Where a row sits in a run of points on the same in-world day (runs of one aren't marked). */
export type Band = 'none' | 'first' | 'middle' | 'last'

export function dayBands(points: TimelinePoint[]): Band[] {
  return points.map((p, i) => {
    if (!p.day) return 'none'
    const prev = points[i - 1]?.day === p.day
    const next = points[i + 1]?.day === p.day
    return prev && next ? 'middle' : prev ? 'last' : next ? 'first' : 'none'
  })
}

/** A row's accessible name: what it is and what clicking it does. */
export function rowLabel(p: TimelinePoint, clashes: Timeline['clashes']): string {
  const when = p.when ? p.when : 'No date'
  const what = p.kind === 'scene' ? `${p.place}, ${p.title}` : `Event: ${p.title}`
  const clash = p.clashes.map((i) => clashes[i]?.text).filter(Boolean)
  return [`${what}. ${when}${p.dated ? '' : p.when ? ' (no date)' : ''}.`, ...clash].join(' ')
}

/** "1 clash", "3 clashes". */
export const clashCount = (n: number): string => `${n} ${n === 1 ? 'clash' : 'clashes'}`
