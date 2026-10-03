// How much the outline helper suggests: the choices it offers, the size it starts at for a story, and
// keeping the three numbers sensible together. No React, so it is unit-tested.
import type { OutlineSize } from '@shared/contracts/outline'

const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i)

/** The most it asks for at once, as the main process allows (src/main/outline/prompts.ts, SIZE_LIMITS). */
export const SIZE_CHOICES = { acts: range(0, 6), chapters: range(1, 30), scenes: range(1, 6) }

/** Scene cards in all, at most: more than one answer can hold. */
export const MOST_SCENES = 100

/**
 * Where the helper starts: a whole story in three acts for a story with no chapters yet; otherwise a
 * few chapters more, in a new act when the story has acts, else chapters only.
 */
export function defaultSize(chapters: number, acts: number): OutlineSize {
  if (chapters === 0) return { acts: 3, chapters: 9, scenes: 3 }
  return { acts: acts > 0 ? 1 : 0, chapters: 3, scenes: 3 }
}

const clamp = (n: number, list: number[]): number => Math.min(list[list.length - 1], Math.max(list[0], Math.round(n) || list[0]))

/**
 * The size after one choice changes, keeping at least one chapter for each act and no more than
 * MOST_SCENES scene cards in all: the other number moves to fit.
 */
export function fitSize(size: OutlineSize, patch: Partial<OutlineSize>): OutlineSize {
  const next = {
    acts: clamp(patch.acts ?? size.acts, SIZE_CHOICES.acts),
    chapters: clamp(patch.chapters ?? size.chapters, SIZE_CHOICES.chapters),
    scenes: clamp(patch.scenes ?? size.scenes, SIZE_CHOICES.scenes)
  }
  if (next.acts > next.chapters) {
    if (patch.chapters !== undefined && patch.acts === undefined) next.acts = next.chapters
    else next.chapters = next.acts
  }
  if (next.chapters * next.scenes > MOST_SCENES) {
    if (patch.scenes !== undefined && patch.chapters === undefined) {
      next.chapters = Math.floor(MOST_SCENES / next.scenes)
      next.acts = Math.min(next.acts, next.chapters)
    } else next.scenes = Math.max(1, Math.floor(MOST_SCENES / next.chapters))
  }
  return next
}
