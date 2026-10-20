// Build with AI zooms in (Adam, 2026-10-20, "Option A: Zoom in"): the whole story's line stays quiet (each chapter its
// name, how it stands and one next step), and a chapter or a scene opens as its own page in the same area, with a trail
// back ("Whole story › Ch 14 · The ford", "Whole story › Ch 14 › Sc 2"). The logic of it, with no React: which page a
// view shows, each chapter's and scene's one next step, a chapter's line of how it stands, the views and the trail.

import type { ID, Outline } from '@shared/types'
import type { View } from '@/lib/store'
import { chapterName, type LineChapter, type LineScene } from './hubLogic'
import type { BuildView, ChapterPanel, SceneTool } from './buildLogic'

/** The page Build with AI shows: a chapter, a scene (with its chapter), or (null) the whole story. */
export type Zoom = { kind: 'chapter'; chapterId: ID } | { kind: 'scene'; chapterId: ID; sceneId: ID }

/**
 * The view's page: `sceneId` a scene's page, else `chapterId` a chapter's page, else the whole story. One the story no
 * longer has falls back to its chapter, then to the whole story.
 */
export function zoomOf(view: Pick<BuildView, 'chapterId' | 'sceneId'>, outline: Pick<Outline, 'chapters' | 'scenes'>): Zoom | null {
  const has = (id: ID): boolean => outline.chapters.some((c) => c.id === id)
  if (view.sceneId) {
    const sc = outline.scenes.find((s) => s.id === view.sceneId)
    if (sc && has(sc.chapterId)) return { kind: 'scene', chapterId: sc.chapterId, sceneId: sc.id }
  }
  if (view.chapterId && has(view.chapterId)) return { kind: 'chapter', chapterId: view.chapterId }
  return null
}

/** A chapter's one next step on the whole story's line: Plan it, Write it, or Open. */
export type ChapterStep = 'plan' | 'write' | 'open'

/**
 * Plan it while it has no scenes or a scene with nothing on its card; Write it (the AI writes it whole) once every card
 * says something; Open once it has words (writing it whole would write its written scenes again).
 */
export function chapterStep(c: Pick<LineChapter, 'scenes' | 'words'>, emptyCards: number): ChapterStep {
  if (c.words > 0) return 'open'
  if (!c.scenes.length || emptyCards > 0) return 'plan'
  return 'write'
}

export const CHAPTER_STEP_WORDS: Record<ChapterStep, string> = { plan: 'Plan it', write: 'Write it', open: 'Open' }

/** A scene's one action on its chapter's page: Open once written, Fill the card while it says nothing, else Write it. */
export type SceneStep = 'open' | 'fill' | 'write'

export function sceneStep(s: Pick<LineScene, 'words'>, emptyCard: boolean): SceneStep {
  if (s.words > 0) return 'open'
  return emptyCard ? 'fill' : 'write'
}

const plural = (n: number, one: string): string => `${n.toLocaleString('en-GB')} ${n === 1 ? one : `${one}s`}`

/** How a chapter stands, in a line: "Planned · 4 scenes", "Being written · 2 of 4 scenes written · 3,100 words". */
export function chapterMeta(c: Pick<LineChapter, 'scenes' | 'words'>): string {
  if (!c.scenes.length) return 'Planned · no scenes yet'
  const done = c.scenes.filter((s) => s.words > 0).length
  if (!done) return `Planned · ${plural(c.scenes.length, 'scene')}`
  if (done < c.scenes.length) return `Being written · ${done} of ${plural(c.scenes.length, 'scene')} written · ${plural(c.words, 'word')}`
  return `Written · ${plural(c.scenes.length, 'scene')} · ${plural(c.words, 'word')}`
}

type Back = { view: View; label: string }

/** A chapter's page, with Write this chapter open (`open: 'write'`) or brought to its plan (`open: 'plan'`). */
export function chapterView(storyId: ID, chapterId: ID, o: { open?: ChapterPanel; back?: Back } = {}): BuildView {
  return { kind: 'planHub', storyId, section: 'line', chapterId, ...(o.open ? { open: o.open } : {}), ...(o.back ? { back: o.back } : {}) }
}

/** A scene's page, with its ideas or its interview open. */
export function sceneView(storyId: ID, sceneId: ID, o: { tool?: SceneTool; back?: Back } = {}): BuildView {
  return { kind: 'planHub', storyId, section: 'line', sceneId, ...(o.tool ? { tool: o.tool } : {}), ...(o.back ? { back: o.back } : {}) }
}

/** The whole story, at its story line, with the chapter Adam was in brought into view. */
export function wholeStoryView(storyId: ID, near: ID | null, back?: Back): BuildView {
  return { kind: 'planHub', storyId, section: 'line', ...(near ? { near } : {}), ...(back ? { back } : {}) }
}

/** One step of the trail; the last (where Adam is) has no view. */
export interface TrailStep {
  label: string
  view: BuildView | null
}

/** "Whole story › Ch 14 · The ford" on a chapter's page, "Whole story › Ch 14 › Sc 2" on a scene's. */
export function trailOf(storyId: ID, chapter: Pick<LineChapter, 'id' | 'no' | 'title'>, scene: Pick<LineScene, 'no'> | null, back?: Back): TrailStep[] {
  const whole: TrailStep = { label: 'Whole story', view: wholeStoryView(storyId, chapter.id, back) }
  if (!scene) return [whole, { label: chapterName(chapter), view: null }]
  return [whole, { label: `Ch ${chapter.no}`, view: chapterView(storyId, chapter.id, { back }) }, { label: `Sc ${scene.no}`, view: null }]
}
