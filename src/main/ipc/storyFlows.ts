// Milestone 3: the handlers for src/shared/contracts/storyFlows.ts (one part owns both files).
import type { Handlers } from './index'
import type { StoryFlowsApi } from '@shared/contracts/storyFlows'
import { UserError } from '../util'

const notYet = (): never => {
  throw new UserError('This isn’t ready yet.')
}

export const storyFlowsHandlers: Handlers<keyof StoryFlowsApi> = {
  fillTimeGap: notYet,
  draftStartingCast: notYet,
  sortStartChanges: notYet
}
