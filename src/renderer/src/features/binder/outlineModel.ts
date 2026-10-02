// Pure helpers for the story tree: grouping, reading order, neighbours, and the
// bookkeeping behind drag and drop. No React, so they're unit-tested.

import type { Act, Chapter, ID, Outline, SceneMeta } from '@shared/types'
import type { ChapterPlace } from '@shared/contracts/outline'

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

// ---------- Acts (milestone 4) ----------

/** A run of chapters in the binder: an act's, or (`act` null) the chapters with no act. */
export interface ChapterRun {
  act: Act | null
  chapters: ID[]
}

/** The act a chapter is in, or null (none, or one that is gone). */
export function actOf(outline: Outline, chapterId: ID): ID | null {
  const actId = outline.chapters.find((c) => c.id === chapterId)?.actId ?? null
  return actId && (outline.acts ?? []).some((a) => a.id === actId) ? actId : null
}

/**
 * The chapters as the binder shows them, in the order given: those with no act first (when there are
 * any), then each act with its chapters. A story without acts is one run with no act, as it always was.
 */
export function chapterRuns(outline: Outline, chapters: ID[]): ChapterRun[] {
  const acts = outline.acts ?? []
  if (!acts.length) return [{ act: null, chapters }]
  const live = new Set(acts.map((a) => a.id))
  const act = new Map(outline.chapters.map((c) => [c.id, c.actId && live.has(c.actId) ? c.actId : null]))
  const loose = chapters.filter((id) => !act.get(id))
  return [...(loose.length ? [{ act: null, chapters: loose }] : []), ...acts.map((a) => ({ act: a, chapters: chapters.filter((id) => act.get(id) === a.id) }))]
}

/** The chapters in the order the binder shows them (each act's together), as `chapterRuns` lays them out. */
export const shownOrder = (outline: Outline, chapters: ID[]): ID[] => chapterRuns(outline, chapters).flatMap((r) => r.chapters)

/**
 * Where "Move to act" puts a chapter: at the start of a later act or the end of an earlier one, so it
 * moves as little as it can. Null when it is already in that act.
 */
export function moveToActPlace(outline: Outline, chapterId: ID, actId: ID): ChapterPlace | null {
  const acts = (outline.acts ?? []).map((a) => a.id)
  const from = actOf(outline, chapterId)
  if (from === actId || !acts.includes(actId)) return null
  return from !== null && acts.indexOf(actId) < acts.indexOf(from) ? { actId } : { actId, index: 0 }
}

/**
 * Whether "Start a new act here" does anything for this chapter: it has no act, or it comes after the
 * first chapter of its act (the first one starts its act already).
 */
export function canStartActAt(outline: Outline, chapterId: ID): boolean {
  const from = actOf(outline, chapterId)
  const ids = outline.chapters.map((c) => c.id)
  if (!from) return ids.includes(chapterId)
  const run = chapterRuns(outline, ids).find((r) => r.act?.id === from)
  return !!run && run.chapters.indexOf(chapterId) > 0
}

/**
 * The outline with a new act starting at a chapter, as the server makes it (startActAt), before the
 * reload: the act just after the chapter's own act (or before every act), holding `chapterIds`.
 */
export function withActStartedAt(outline: Outline, act: Act, chapterIds: ID[]): Outline {
  const acts = (outline.acts ?? []).filter((a) => a.id !== act.id)
  const from = chapterIds.length ? actOf(outline, chapterIds[0]) : null
  acts.splice(from ? acts.findIndex((a) => a.id === from) + 1 : 0, 0, act)
  const moving = new Set(chapterIds)
  return {
    ...outline,
    acts: acts.map((a, position) => ({ ...a, position })),
    chapters: outline.chapters.map((c) => (moving.has(c.id) ? { ...c, actId: act.id } : c))
  }
}

/**
 * The outline with a chapter moved as the server will move it (an optimistic update before the reload):
 * into `place.actId` just after `afterId`, else just before `beforeId`, else at `index` among that act's
 * chapters, else at its end; with every act's chapters together and fresh positions.
 */
export function placeChapterIn(outline: Outline, chapterId: ID, place: ChapterPlace): Outline {
  const moving = outline.chapters.find((c) => c.id === chapterId)
  if (!moving) return outline
  const actId = place.actId ?? null
  const chapters = outline.chapters.map((c) => (c.id === chapterId ? { ...c, actId } : c))
  const runs = chapterRuns({ ...outline, chapters }, outline.chapters.map((c) => c.id).filter((id) => id !== chapterId))
  let run = runs.find((r) => (r.act?.id ?? null) === actId)
  if (!run && actId) return outline
  if (!run) {
    // The first chapter with no act: they come first.
    run = { act: null, chapters: [] }
    runs.unshift(run)
  }
  const list = run.chapters
  let at = list.length
  if (place.afterId && list.includes(place.afterId)) at = list.indexOf(place.afterId) + 1
  else if (place.beforeId && list.includes(place.beforeId)) at = list.indexOf(place.beforeId)
  else if (place.index != null && Number.isFinite(place.index)) at = Math.max(0, Math.min(Math.floor(place.index), list.length))
  list.splice(at, 0, chapterId)
  const byId = new Map(chapters.map((c) => [c.id, c]))
  return { ...outline, chapters: runs.flatMap((r) => r.chapters).map((id, position) => ({ ...byId.get(id)!, position })) }
}

/** Word counts shown in the binder: blank for nothing written yet. */
export const formatWords = (n: number): string => (n > 0 ? n.toLocaleString('en-GB') : '')
