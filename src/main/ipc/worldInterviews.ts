// The handlers for src/shared/contracts/worldInterviews.ts (the interviews by topic). The work is in
// src/main/worldInterviews/*; this file connects it to the open world, the settings and the window.
import type { Handlers } from './index'
import type { WorldInterviewsApi } from '@shared/contracts/worldInterviews'
import * as world from '../world'
import * as repo from '../db/repo'
import * as providers from '../ai/providers'
import { jobModel } from '../ai/jobModel'
import { getSettings, getWritingPrefs } from '../settings'
import { emit } from '../events'
import { memoryStatus } from '../keeper'
import { askTopicQuestions, suggestFromTopic, type InterviewDeps } from '../worldInterviews/jobs'
import { interviewProgress, keepSuggestion } from '../worldInterviews/keep'

const modelSources = () => ({ settings: getSettings(), getProvider: providers.getProvider, providerTarget: providers.providerTarget })

/** The World builder model (its job, 'world': the character builder model, then the writer model, until Adam picks one). */
function deps(): InterviewDeps {
  const model = jobModel('world', modelSources())
  return { db: world.db(), model, emit, onKeyRejected: () => providers.markCheck(model.target.id, false), prefs: getWritingPrefs() }
}

export const worldInterviewsHandlers: Handlers<keyof WorldInterviewsApi> = {
  askTopicQuestions: (input) => askTopicQuestions(deps(), input),
  suggestFromTopic: (input) => suggestFromTopic(deps(), input),
  keepTopicSuggestion: (input) => {
    const db = world.db()
    const kept = keepSuggestion(db, input)
    repo.touchWorld(db)
    // Lists and pages showing these pages reload, and the top bar's note says the memory changed.
    emit('memory:changed', { sceneId: null, entryIds: kept.entryId ? [kept.entryId] : [] })
    emit('memory:status', memoryStatus())
    return kept
  },
  getInterviewProgress: (where) => interviewProgress(world.db(), typeof where?.storyId === 'string' && where.storyId ? where.storyId : null)
}
