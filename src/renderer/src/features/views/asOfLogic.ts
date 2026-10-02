// Pure helpers for as-of sliders (milestone 3). Tested in asOfLogic.test.ts.
import type { AsOf, AsOfStop, Story } from '@shared/types'

/** The same point (the story it is seen in aside). */
export function sameAsOf(a: AsOf | null | undefined, b: AsOf | null | undefined): boolean {
  if (!a || !b) return false
  if (a.kind !== b.kind || a.storyId !== b.storyId) return false
  return a.kind !== 'scene' || (b.kind === 'scene' && a.sceneId === b.sceneId)
}

/** Where a point is among the stops; -1 when it isn't one of them. */
export const stopIndex = (stops: AsOfStop[], at: AsOf | null | undefined): number => stops.findIndex((s) => sameAsOf(s.at, at))

/** The stop for a scene, or the start of its story's stops when the scene has none yet. */
export function stopForScene(stops: AsOfStop[], sceneId: string | null | undefined): AsOfStop | null {
  if (!stops.length) return null
  return (sceneId ? stops.find((s) => s.sceneId === sceneId) : undefined) ?? stops[stops.length - 1]
}

/** The next stop (forwards or back) where the entry changes; null when there is none. */
export function nextChange(stops: AsOfStop[], from: number, step: 1 | -1): number | null {
  for (let i = from + step; i >= 0 && i < stops.length; i += step) if (stops[i].changes > 0) return i
  return null
}

/** Whether the world has a story that isn't simply the next book (a side story, prequel or own version). */
export const hasOtherKinds = (stories: Pick<Story, 'kind'>[]): boolean => stories.some((s) => s.kind !== 'continues')
