// Opening the outline helper for a story. Owned by the Outline part.
import type { ID } from '@shared/types'
import { useApp } from '@/lib/store'
import { checkBlank } from './helperStore'
import { startPlanInterview } from './planInterviewStore'

/**
 * Opens the outline helper for a story, opening the story in the binder first if another one is open.
 * Whether the story has anything planned yet is asked first (a moment), so the page's first frame says
 * the right thing.
 */
export function openOutlineHelper(storyId: ID): void {
  const app = useApp.getState()
  if (app.storyId !== storyId) app.selectStory(storyId)
  void checkBlank(storyId).then(() => useApp.getState().navigate({ kind: 'outline', storyId }))
}

/** "Interview me about this chapter": the chapter's planning page, with the interview's first question on its way. */
export function openChapterInterview(storyId: ID, chapterId: ID): void {
  const app = useApp.getState()
  if (app.storyId !== storyId) app.selectStory(storyId)
  startPlanInterview({ kind: 'chapter', chapterId })
  useApp.getState().navigate({ kind: 'outline', storyId, chapterId })
}
