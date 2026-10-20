// The handlers for src/shared/contracts/planHub.ts (the Plan hub, 2026-10-20). The work is in src/main/planHub/*; this
// file connects it to the open world, the settings (the chat and brainstorm model) and the window.
import type { Handlers } from './index'
import type { PlanHubApi } from '@shared/contracts/planHub'
import * as world from '../world'
import * as providers from '../ai/providers'
import { jobModel } from '../ai/jobModel'
import { getSettings } from '../settings'
import { emit } from '../events'
import { UserError } from '../util'
import { planHubFacts } from '../planHub/facts'
import { planUpdateScenes, startPlanUpdate } from '../planHub/update'
import type { JobDeps } from '../outline/jobs'

function jobDeps(): JobDeps {
  const model = jobModel('chat', { settings: getSettings(), getProvider: providers.getProvider, providerTarget: providers.providerTarget })
  return { db: world.db(), model, emit, onKeyRejected: () => providers.markCheck(model.target.id, false) }
}

const storyIdOf = (v: unknown): string => {
  const id = typeof v === 'string' ? v : ''
  if (!id) throw new UserError('That story isn’t here any more. It may have been deleted.', 'no-story')
  return id
}

export const planHubHandlers: Handlers<keyof PlanHubApi> = {
  planHubFacts: (storyId) => planHubFacts(world.db(), storyIdOf(storyId)),
  planUpdateScenes: (sceneIds) => planUpdateScenes(world.db(), Array.isArray(sceneIds) ? sceneIds.map(String) : []),
  startPlanUpdate: (input) => startPlanUpdate(jobDeps(), { ...input, storyId: storyIdOf(input?.storyId) })
}
