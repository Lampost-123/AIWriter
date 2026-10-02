// Opening the outline helper for a story. Owned by the Outline part.
import type { ID } from '@shared/types'
import { useApp } from '@/lib/store'

/** Opens the outline helper for a story, opening the story in the binder first if another one is open. */
export function openOutlineHelper(storyId: ID): void {
  const app = useApp.getState()
  if (app.storyId !== storyId) app.selectStory(storyId)
  useApp.getState().navigate({ kind: 'outline', storyId })
}
