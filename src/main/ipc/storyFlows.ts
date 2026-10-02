// Milestone 3: the handlers for src/shared/contracts/storyFlows.ts (one part owns both files). The work
// is done in src/main/storyFlows/*: each call starts it in the background and returns at once, and the
// 'story:flow' event says how it went.
import type { Handlers } from './index'
import type { StoryFlowsApi } from '@shared/contracts/storyFlows'
import * as world from '../world'
import { loadShapeSafe } from '../keeper/places'
import { flowRuns } from '../storyFlows/lines'
import { listStoryFlows, startStoryFlow, stopStoryFlow } from '../storyFlows'

export const storyFlowsHandlers: Handlers<keyof StoryFlowsApi> = {
  fillTimeGap: (storyId) => startStoryFlow({ flow: 'time-gap', storyId }),
  draftStartingCast: (storyId, entryIds) => startStoryFlow({ flow: 'starting-cast', storyId, entryIds: [...(entryIds ?? [])] }),
  sortStartChanges: (newStoryId, bookId) => startStoryFlow({ flow: 'when', storyId: newStoryId, bookId }),
  listStoryFlows: (storyId) => listStoryFlows(storyId),
  stopStoryFlow: (storyId, flow) => stopStoryFlow(storyId, flow),
  listStoryFlowRuns: () => {
    const db = world.db()
    return flowRuns(db, loadShapeSafe(db))
  }
}
