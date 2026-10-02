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

/**
 * What "Use this" puts on the card. An empty one takes the idea's line on what happens as its goal, and
 * its beats. One Adam has started keeps his words: his goal stays, and the idea's beats go after his
 * (leaving out any he already has). `kept`: something of his stayed.
 */
export function ideaOnCard(
  card: Pick<SceneCard, 'goal' | 'beats'>,
  idea: { summary: string; beats: string[] }
): { goal: string; beats: string[]; kept: boolean } {
  const mine = card.beats.map((b) => b.trim()).filter(Boolean)
  const has = new Set(mine.map((b) => b.toLowerCase()))
  const theirs = idea.beats.map((b) => b.trim()).filter((b) => b && !has.has(b.toLowerCase()))
  const goal = card.goal.trim()
  return { goal: goal ? card.goal : idea.summary.trim(), beats: [...mine, ...theirs], kept: !!goal || mine.length > 0 }
}
