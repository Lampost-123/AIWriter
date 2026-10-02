// Lookups over a story's line for the world views: where each scene, story start and chapter end
// is on it, and where an entry first exists there (the same reading as memory/state.ts).
import type { ID } from '@shared/types'
import type { ExistsAt, Line, LineStep } from '../memory/types'

export interface Walk {
  steps: LineStep[]
  /** Step index of each scene on the line. */
  scene: Map<ID, number>
  /** Step index of each story's start, and of its start-of-story changes. */
  start: Map<ID, number>
  post: Map<ID, number>
  chapterEnd: Map<ID, number>
}

export function walkOf(line: Line): Walk {
  const w: Walk = { steps: line.steps, scene: new Map(), start: new Map(), post: new Map(), chapterEnd: new Map() }
  line.steps.forEach((step, i) => {
    if (step.type === 'scene') w.scene.set(step.sceneId, i)
    else if (step.type === 'start') w.start.set(step.storyId, i)
    else if (step.type === 'start-changes') w.post.set(step.storyId, i)
    else if (step.type === 'chapter-end') w.chapterEnd.set(step.chapterId, i)
  })
  return w
}

/**
 * The earliest step at which an entry exists on the line: -1 for the starting setup (and for an entry
 * with no first-exists points at all, as the memory reads it), null when it doesn't exist on it.
 */
export function existsStep(w: Walk, points: ExistsAt[] | undefined): number | null {
  if (!points?.length) return -1
  let best: number | null = null
  for (const p of points) {
    let at: number | undefined
    if (p.kind === 'world') at = -1
    else if (p.kind === 'story-pre' && p.storyId) at = w.start.get(p.storyId)
    else if (p.kind === 'story-post' && p.storyId) at = w.post.get(p.storyId)
    else if (p.kind === 'scene' && p.after) {
      const { at: where, refId } = p.after
      at =
        where === 'post'
          ? p.storyId
            ? w.post.get(p.storyId)
            : undefined
          : refId
            ? (where === 'chapter' ? w.chapterEnd : w.scene).get(refId)
            : undefined
    } else if (p.kind === 'scene' && p.sceneId) at = w.scene.get(p.sceneId)
    if (at !== undefined && (best === null || at < best)) best = at
  }
  return best
}

/** How many chapters end on the line after a step (a chapter of any story on it, side stories included). */
export function chaptersAfter(w: Walk, step: number): number {
  let n = 0
  for (const i of w.chapterEnd.values()) if (i > step) n++
  return n
}
