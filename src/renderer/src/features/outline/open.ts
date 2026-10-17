// Opening the outline helper for a story. Owned by the Outline part.
import type { ID } from '@shared/types'
import { useApp } from '@/lib/store'
import { checkBlank } from './helperStore'
import { noteChapterStory, startPlanInterview } from './planInterviewStore'

/**
 * Opens the outline helper for a story (2026-10-17: the Story builder's outline step), opening the story in the binder
 * first if another one is open. Whether the story has anything planned yet is asked first (a moment), so the page's
 * first frame says the right thing.
 */
export function openOutlineHelper(storyId: ID): void {
  const app = useApp.getState()
  if (app.storyId !== storyId) app.selectStory(storyId)
  void checkBlank(storyId).then(() => useApp.getState().navigate({ kind: 'outline', storyId }))
}

/** Opens the Story builder for a story, at the step it stands at. */
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
