// Pure helpers for the story tree: grouping, reading order, neighbours, and the
// bookkeeping behind drag and drop. No React, so they're unit-tested.

import type { Chapter, ID, Outline, SceneMeta } from '@shared/types'

export interface ChapterGroup {
  chapter: Chapter
  scenes: SceneMeta[]
  words: number
}

/** Chapters in order, each with its scenes in order and its total word count. */
export function groupOutline(outline: Outline): ChapterGroup[] {
  const byChapter = new Map<ID, SceneMeta[]>()
  for (const c of outline.chapters) byChapter.set(c.id, [])
  for (const s of outline.scenes) byChapter.get(s.chapterId)?.push(s)
  return outline.chapters.map((chapter) => {
    const scenes = (byChapter.get(chapter.id) ?? []).slice().sort((a, b) => a.position - b.position)
    return { chapter, scenes, words: scenes.reduce((n, s) => n + s.wordCount, 0) }
  })
}

/** Scene ids in reading order. */
export const readingOrder = (outline: Outline): ID[] => groupOutline(outline).flatMap((g) => g.scenes.map((s) => s.id))

/**
 * The scene to open after `removed` scenes disappear while `openId` is open:
 * the next scene in reading order, else the previous one, else none.
 * Returns `openId` unchanged when it isn't being removed.
 */
export function neighbourAfterRemoval(order: ID[], removed: ID[], openId: ID | null): ID | null {
  if (!openId || !removed.includes(openId)) return openId
  const gone = new Set(removed)
  const i = order.indexOf(openId)
  if (i < 0) return order.find((id) => !gone.has(id)) ?? null
  for (let j = i + 1; j < order.length; j++) if (!gone.has(order[j])) return order[j]
  for (let j = i - 1; j >= 0; j--) if (!gone.has(order[j])) return order[j]
  return null
}

/** The scene before and after `id` in reading order (for breadcrumbs and keyboard moves). */
export function siblings(order: ID[], id: ID): { prev: ID | null; next: ID | null } {
  const i = order.indexOf(id)
  return { prev: i > 0 ? order[i - 1] : null, next: i >= 0 && i < order.length - 1 ? order[i + 1] : null }
}

// ---------- Drag and drop ----------

/** Chapter id -> scene ids, the shape drag and drop works on. */
export type Containers = Record<ID, ID[]>

export interface TreeOrder {
  chapters: ID[]
  scenes: Containers
}

export function treeOrder(outline: Outline): TreeOrder {
  const groups = groupOutline(outline)
  const scenes: Containers = {}
  for (const g of groups) scenes[g.chapter.id] = g.scenes.map((s) => s.id)
  return { chapters: groups.map((g) => g.chapter.id), scenes }
}

export function findChapterOf(scenes: Containers, sceneId: ID): ID | undefined {
  for (const [chapterId, ids] of Object.entries(scenes)) if (ids.includes(sceneId)) return chapterId
  return undefined
}

/** Moves a scene into `toChapter` at `index` (clamped). Returns a new object; unchanged input if nothing moves. */
export function moveSceneTo(scenes: Containers, sceneId: ID, toChapter: ID, index: number): Containers {
  const from = findChapterOf(scenes, sceneId)
  if (!from || !scenes[toChapter]) return scenes
  const without = scenes[from].filter((id) => id !== sceneId)
  const target = from === toChapter ? without : scenes[toChapter].slice()
  const at = Math.max(0, Math.min(index, target.length))
  if (from === toChapter && scenes[from].indexOf(sceneId) === at) return scenes
  target.splice(at, 0, sceneId)
  return from === toChapter ? { ...scenes, [from]: target } : { ...scenes, [from]: without, [toChapter]: target }
}

export function arrayMove<T>(list: T[], from: number, to: number): T[] {
  const out = list.slice()
  const [item] = out.splice(from, 1)
  out.splice(to, 0, item)
  return out
}

/** Where a scene ended up: its chapter and its index there (what api.moveScene takes). */
export function scenePlace(scenes: Containers, sceneId: ID): { chapterId: ID; index: number } | null {
  const chapterId = findChapterOf(scenes, sceneId)
  return chapterId ? { chapterId, index: scenes[chapterId].indexOf(sceneId) } : null
}

/** The outline rearranged to a new order (for an optimistic update before the reload). */
export function applyTreeOrder(outline: Outline, order: TreeOrder): Outline {
  const chapterById = new Map(outline.chapters.map((c) => [c.id, c]))
  const sceneById = new Map(outline.scenes.map((s) => [s.id, s]))
  const chapters = order.chapters.flatMap((id, position) => {
    const c = chapterById.get(id)
    return c ? [{ ...c, position }] : []
  })
  const scenes = order.chapters.flatMap((chapterId) =>
    (order.scenes[chapterId] ?? []).flatMap((id, position) => {
      const s = sceneById.get(id)
      return s ? [{ ...s, chapterId, position }] : []
    })
  )
  return { ...outline, chapters, scenes }
}

/** Word counts shown in the binder: blank for nothing written yet. */
export const formatWords = (n: number): string => (n > 0 ? n.toLocaleString('en-GB') : '')
