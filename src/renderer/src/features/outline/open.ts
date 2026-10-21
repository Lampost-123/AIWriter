// Opening the places to plan a story. Owned by the Outline part.
// 2026-10-20: Build with AI (features/planHub, the Plan hub before) is the one area for building every part of a story
// with the AI; the outline helper, the Story builder, a chapter's plan, the palette's and the story menu's entries and the
// binder's buttons all open a section of it.
import type { ID } from '@shared/types'
import { useApp, type View } from '@/lib/store'
import type { HubScopeId } from '@/features/planHub/hubLogic'
import type { BuildSection, ChapterPanel, SceneTool } from '@/features/planHub/buildLogic'
import { checkBlank } from './helperStore'
import { noteChapterStory, startPlanInterview } from './planInterviewStore'
import { askIdeas, ideasFor } from './ideasStore'

export interface BuildAt {
  /** The section to show first (left out: a new story's idea, else the story line). */
  section?: BuildSection
  /** The part to plan ("the next scene"). */
  at?: HubScopeId
  /** A chapter's own page, brought to its plan or with Write this chapter open. */
  chapterId?: ID
  open?: ChapterPanel
  /** A scene's own page, with its ideas or its interview open. */
  sceneId?: ID
  tool?: SceneTool
  /** The page it was opened from, for its Back link. */
  back?: { view: View; label: string }
}

/**
 * Opens Build with AI for a story, opening the story in the binder first if another one is open. Whether the story has
 * anything planned yet is asked first (a moment), so the page's first frame says the right thing.
 */
export function openPlanHub(storyId: ID, o: BuildAt = {}): void {
  const app = useApp.getState()
  if (app.storyId !== storyId) app.selectStory(storyId)
  const view: View = { kind: 'planHub', storyId }
  for (const k of ['section', 'at', 'chapterId', 'open', 'sceneId', 'tool', 'back'] as const) if (o[k] !== undefined) Object.assign(view, { [k]: o[k] })
  void checkBlank(storyId).then(() => useApp.getState().navigate(view))
}

/** Build with AI: its name since 2026-10-20 (the Plan hub before). */
export const openBuild = openPlanHub

/** "Interview me about this chapter": the chapter's own page in Build with AI, at its plan, the first question on its way. */
export function openChapterInterview(storyId: ID, chapterId: ID): void {
  noteChapterStory(chapterId, storyId)
  startPlanInterview({ kind: 'chapter', chapterId })
  openPlanHub(storyId, { section: 'line', chapterId, open: 'plan' })
}

/** "Plan a chapter": the chapter's own page in Build with AI, at its plan. */
export function openChapterPlan(storyId: ID, chapterId: ID): void {
  noteChapterStory(chapterId, storyId)
  openPlanHub(storyId, { section: 'line', chapterId, open: 'plan' })
}

/**
 * Next scene ideas or Interview me from the Plan area or the palette: the open scene, while it is planned and not
 * written, on its own page in Build with AI with its ideas or interview open; else the story line at "the next scene".
 */
export function openSceneTool(storyId: ID, sceneId: ID | null, tool: SceneTool, written: boolean): void {
  if (sceneId && !written) {
    if (tool === 'interview') startPlanInterview({ kind: 'scene', sceneId })
    // Ideas asked for at once, unless some are showing already (as the palette always did).
    const ideas = tool === 'ideas' ? ideasFor(sceneId) : null
    if (tool === 'ideas' && (!ideas || ideas.hidden || ideas.status === 'error')) void askIdeas(sceneId)
    openPlanHub(storyId, { section: 'line', sceneId, tool })
  } else openPlanHub(storyId, { section: 'line', at: 'next-scene' })
}

/** "Build this chapter with AI" (the binder, the chapter card, the palette): the chapter's own page in Build with AI. */
export function openChapterPage(storyId: ID, chapterId: ID): void {
  noteChapterStory(chapterId, storyId)
  openPlanHub(storyId, { section: 'line', chapterId })
}

/** "Build this scene with AI" (the binder, the scene card, the palette): the scene's own page in Build with AI. */
export function openScenePage(storyId: ID, sceneId: ID): void {
  openPlanHub(storyId, { section: 'line', sceneId })
}
