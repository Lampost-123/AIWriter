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

/**
 * A point on the slider inside a sentence: "Start of Book 1" reads "the start of Book 1"; a scene's place
 * stays as it is. Each number keeps to its word ("Sc 2"), so a sentence never wraps between them.
 */
export const inSentence = (label: string): string =>
  label.replace(/^(Start|End) of /, (_, w: string) => `the ${w.toLowerCase()} of `).replace(/ (?=\d)/g, '\u00a0')

/** The longest place on a slider (by its letters), to keep room for it as the slider moves. */
export const longestLabel = (stops: AsOfStop[]): string => stops.reduce((long, s) => (s.label.length > long.length ? s.label : long), '')
