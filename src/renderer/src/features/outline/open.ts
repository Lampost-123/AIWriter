// Opening the places to plan a story. Owned by the Outline part.
// 2026-10-20: the Plan hub (features/planHub) is the one place to plan with AI; the outline helper, the Story builder's
// Outline step, the palette's and the story menu's entries and the binder's buttons all open it.
import type { ID } from '@shared/types'
import { useApp, type View } from '@/lib/store'
import type { HubScopeId } from '@/features/planHub/hubLogic'
import { checkBlank } from './helperStore'
import { noteChapterStory, startPlanInterview } from './planInterviewStore'

/**
 * Opens the Plan hub for a story, opening the story in the binder first if another one is open. Whether the story has
 * anything planned yet is asked first (a moment), so the page's first frame says the right thing. `at`: the part to plan
 * ("the next scene"); `back`: the page it was opened from, for its Back link (the Story builder's steps).
 */
export function openPlanHub(storyId: ID, o: { at?: HubScopeId; back?: { view: View; label: string } } = {}): void {
  const app = useApp.getState()
  if (app.storyId !== storyId) app.selectStory(storyId)
  void checkBlank(storyId).then(() =>
    useApp.getState().navigate({ kind: 'planHub', storyId, ...(o.at ? { at: o.at } : {}), ...(o.back ? { back: o.back } : {}) })
  )
}

/** The outline helper: the Plan hub now (2026-10-20). */
export const openOutlineHelper = (storyId: ID): void => openPlanHub(storyId)

/** Opens the Story builder for a story, at its first steps (the idea, then the cast and world). */
export function openStoryBuilderFor(storyId: ID): void {
  const app = useApp.getState()
  if (app.storyId !== storyId) app.selectStory(storyId)
  useApp.getState().navigate({ kind: 'storyBuilder', storyId })
}

/** "Interview me about this chapter": the chapter's planning page, with the interview's first question on its way. */
export function openChapterInterview(storyId: ID, chapterId: ID): void {
  const app = useApp.getState()
  if (app.storyId !== storyId) app.selectStory(storyId)
  noteChapterStory(chapterId, storyId)
  startPlanInterview({ kind: 'chapter', chapterId })
  useApp.getState().navigate({ kind: 'outline', storyId, chapterId })
}
