// When next scene ideas are offered, and what a used idea may change. No React, so it is unit-tested.
import type { SceneCard } from '@shared/types'

/**
 * An empty scene card: nothing yet on what happens (no beats, goal, conflict, outcome or notes). Who is
 * in it, where and when may be filled in: the ideas build on those.
 */
export const cardIsEmpty = (card: SceneCard): boolean =>
  !card.beats.some((b) => b.trim()) && ![card.goal, card.conflict, card.outcome, card.notes].some((t) => t.trim())

/** A title the scene was given when it was made ("Scene 3"), which a used idea's title can replace. */
export const isPlainTitle = (title: string): boolean => /^\s*(scene\s*\d*|untitled scene)?\s*$/i.test(title)
