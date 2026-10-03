// Which scene is being read aloud, by name: the chapter and scene the reading bar shows ("Chapter 3 · The Ferry"),
// and the scene (and its chapter) the binder marks with a speaker. Pure, so it is unit-tested.
import type { ID, Outline } from '@shared/types'
import { chapterLabel } from '@/features/transfer/transferLogic'
import type { ReadingBar } from './session'

/**
 * The scene being read aloud now: while the bar gets lines ready, plays, waits or is paused (and while Keep reading
 * opens the next scene). Not once reading has stopped, finished or hit a problem; null then.
 */
export function playingScene(state: { sceneId: ID | null; bar: ReadingBar | null }): ID | null {
  const phase = state.bar?.phase
  return phase === 'starting' || phase === 'playing' || phase === 'waiting' || phase === 'paused' ? state.sceneId : null
}

/** What the binder's speaker says: "Playing aloud", or "Reading aloud, paused". */
export const playingLabel = (paused: boolean): string => (paused ? 'Reading aloud, paused' : 'Playing aloud')

/**
 * The chapter and scene being read: the chapter by its number ("Chapter 2", short enough for the bar) and in full
 * ("Chapter 2: The Crossing", for its tooltip), and the scene's title. Null when the outline doesn't have the scene.
 */
export function playingPlace(
  outline: Outline | null,
  sceneId: ID | null
): { chapterId: ID; chapter: string; chapterName: string; scene: string } | null {
  const scene = sceneId ? outline?.scenes.find((s) => s.id === sceneId) : undefined
  const at = scene && outline ? outline.chapters.findIndex((c) => c.id === scene.chapterId) : -1
  if (!scene || !outline || at < 0) return null
  return {
    chapterId: scene.chapterId,
    chapter: `Chapter ${at + 1}`,
    chapterName: chapterLabel(outline, scene.chapterId),
    scene: scene.title.trim() || 'Untitled scene'
  }
}
