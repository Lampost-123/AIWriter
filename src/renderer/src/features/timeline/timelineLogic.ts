// Pure helpers for the timeline (the river, TimelineRiver.tsx): which characters or plot threads can have a lane,
// which show before Adam picks his own, and each card's name in words. Tested in timelineLogic.test.ts; the river's own
// layout is in riverLogic.ts.
import type { ID } from '@shared/types'
import type { Timeline, TimelineEntry, TimelinePoint } from '@shared/contracts/worldViews'

/** Lanes follow characters (who is in each scene) or plot threads (where each is set up and paid off). */
export type LaneMode = 'characters' | 'threads'

/** How many lanes show before Adam picks his own. */
export const DEFAULT_LANES = 6

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
 * busiest few until he makes one.
 */
export function shownLanes(t: Timeline, mode: LaneMode, chosen: ID[] | undefined, fit = DEFAULT_LANES): TimelineEntry[] {
  const choices = laneChoices(t, mode)
  if (!chosen) return choices.slice(0, fit).map((c) => c.entry)
  const want = new Set(chosen)
  return choices.filter((c) => want.has(c.entry.id)).map((c) => c.entry)
}

/** A card's accessible name: what it is, when, and any clash it is part of. */
export function rowLabel(p: TimelinePoint, clashes: Timeline['clashes']): string {
  const when = p.when ? p.when : 'No date'
  const what = p.kind === 'scene' ? `${p.place}, ${p.title}` : `Event: ${p.title}`
  const clash = p.clashes.map((i) => clashes[i]?.text).filter(Boolean)
  return [`${what}. ${when}${p.dated ? '' : p.when ? ' (no date)' : ''}.`, ...clash].join(' ')
}
