// Keep reading: the scene reading carries on into once one ends. Pure, so it is unit-tested.
import type { Chapter, ID, SceneMeta } from '@shared/types'

/** The next scene of the story with words in it, in reading order (chapter by chapter); null at the end. */
export function sceneAfter(outline: { chapters: Pick<Chapter, 'id' | 'position'>[]; scenes: SceneMeta[] }, sceneId: ID): SceneMeta | null {
  const chapterAt = new Map(outline.chapters.map((c) => [c.id, c.position]))
  const ordered = outline.scenes
    .filter((s) => chapterAt.has(s.chapterId))
    .sort((a, b) => chapterAt.get(a.chapterId)! - chapterAt.get(b.chapterId)! || a.position - b.position)
  const at = ordered.findIndex((s) => s.id === sceneId)
  if (at < 0) return null
  return ordered.slice(at + 1).find((s) => s.wordCount > 0) ?? null
}
