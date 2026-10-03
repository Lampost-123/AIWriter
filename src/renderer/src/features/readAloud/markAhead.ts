// Mark who says what keeps the AI's notes a little ahead of the reading: each plan says where the reading asks for
// its clips again (ReadingPlan.markAhead), and the main process then has the AI note the next part of the scene.
// Owned by the Read aloud part.
import type { PlannedClip, ReadingPlan } from '@shared/contracts/readAloud'

export type MarkAhead = NonNullable<ReadingPlan['markAhead']>

/**
 * True when a clip starting now has reached that place: a clip in its paragraph that ends past it, or a clip in a
 * later paragraph (`order`: each paragraph's place on the page). A place whose paragraph has gone counts as reached.
 */
export function reachedMarkAhead(clip: Pick<PlannedClip, 'pid' | 'to'>, at: MarkAhead, order: ReadonlyMap<string, number>): boolean {
  if (clip.pid === at.pid) return clip.to > at.at
  const mine = order.get(clip.pid)
  const theirs = order.get(at.pid)
  return mine != null && (theirs == null || mine > theirs)
}
