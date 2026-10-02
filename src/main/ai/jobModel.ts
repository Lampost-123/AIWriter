// Which model a milestone 4 AI job uses, in one place, with the same checks and plain words as drafting:
//   writer  the writer model: Variants, Beat by beat and the AI tools for selected words write prose.
//   chat    "Chat and brainstorm" (Ask the world, the outline helper, next scene ideas): its own model in
//           Settings › Models, or the writer model while that is left as "Same as the writer model".
//   speech  "Read aloud" (who says each line and how, voice suggestions): its own model, or the memory
//           model while left as "Same as the memory model" (which is the writer model until Adam picks one).
// Each job asks its model to think as that job's own Thinking says (Off unless Adam changes it).
// No Electron imports: the caller passes the settings and the providers.

import type { ID, Job, ModelChoice, ProviderConfig, Settings, ThinkingLevel } from '@shared/types'
import type { ChatTarget } from './client'
import {
  describeFailure,
  isLocalUrl,
  looksLikeContextTooLong,
  looksLikeRefusal,
  looksLikeReplyLimitRejected,
  providerWho,
  type Failure
} from './errors'
import { UserError } from '../util'

export type ModelJob = 'writer' | 'chat' | 'speech'

/** A job's model and how to reach it. */
export interface JobModel {
  job: ModelJob
  target: ChatTarget & { id: ID }
  choice: ModelChoice
  /** How much the model is asked to think (the job's own Thinking in Settings › Models). */
  thinking: ThinkingLevel
}

export interface ModelSources {
  settings: Pick<Settings, 'models'> & Partial<Pick<Settings, 'thinking'>>
  getProvider(id: ID): ProviderConfig | null
  providerTarget(p: ProviderConfig): ChatTarget & { id: ID }
}

/** What Settings › Models calls each job's model. */
export const MODEL_NAMES: Record<Job, string> = {
  writer: 'writer model',
  memory: 'memory model',
  chat: 'chat and brainstorm model',
  builder: 'character builder model',
  speech: 'read aloud model'
}

/** Where each job's model comes from while Adam hasn't picked one of its own, nearest first. */
const FALLBACKS: Record<ModelJob, Job[]> = {
  writer: ['writer'],
  chat: ['chat', 'writer'],
  speech: ['speech', 'memory', 'writer']
}

/** The job's model, or a plain-words UserError saying what to set up in Settings › Models. */
export function jobModel(job: ModelJob, src: ModelSources): JobModel {
  const from = FALLBACKS[job].find((j) => !!src.settings.models[j]) ?? null
  const choice = from ? src.settings.models[from] : null
  if (!from || !choice) throw new UserError('Choose a writer model first, in Settings › Models.', 'no-writer-model')
  const provider = src.getProvider(choice.providerId)
  if (!provider) {
    const name = MODEL_NAMES[from]
    throw new UserError(`The ${name}'s provider has been removed. Choose a ${name} in Settings › Models.`, 'no-writer-model')
  }
  const target = src.providerTarget(provider)
  if (!target.apiKey && !(provider.kind === 'custom' && isLocalUrl(provider.baseUrl))) {
    throw new UserError(`${providerWho(provider)} needs an API key. Add it in Settings › Models.`, 'no-key')
  }
  return { job, target, choice, thinking: src.settings.thinking?.[job] ?? 'off' }
}

const SETTINGS = 'Settings › Models'

/** What went wrong talking to a job's model, in plain words that name that model (drafting's own messages talk about scenes). */
export function jobFailure(f: Failure, model: Pick<JobModel, 'job' | 'target' | 'choice' | 'thinking'>): string {
  const name = MODEL_NAMES[model.job]
  const who = providerWho(model.target)
  const thinkingName = model.job === 'writer' ? 'the writer model’s Thinking' : `the ${name.replace(/ model$/, '')} Thinking`
  switch (f.type) {
    case 'refused':
      return `The ${name} turned this down. Try different words, or pick another ${name} in ${SETTINGS}.`
    case 'empty':
      // A model that thinks before answering can spend the whole reply on thinking, which is hidden.
      if (f.thinking && model.thinking === 'off') {
        return `The ${name} thinks even with Thinking off, and used up its room before it answered. Pick another ${name} in ${SETTINGS}.`
      }
      if (f.thinking)
        return `The ${name} used up its room thinking and didn't answer. Set ${thinkingName} to Off in ${SETTINGS}, or pick another ${name}.`
      return `${who} sent back an empty reply. Try again, or pick another ${name} in ${SETTINGS}.`
    case 'dropped':
      return `The connection to ${who} dropped before the AI had finished. Try again in a moment.`
    case 'http':
      if ((f.status === 400 || f.status === 422) && looksLikeRefusal(f.message) && !looksLikeContextTooLong(f.message)) {
        return `The ${name} turned this down. Try different words, or pick another ${name} in ${SETTINGS}.`
      }
      if (f.status === 413 || ((f.status === 400 || f.status === 422) && looksLikeContextTooLong(f.message))) {
        return `This is more than the ${name} can read at once. Pick a model that can read more in ${SETTINGS}.`
      }
      if (looksLikeReplyLimitRejected(f.status, f.message) && f.status !== 402) {
        return `This model can't write that much in one reply. Pick another ${name} in ${SETTINGS}.`
      }
  }
  const provider = { name: model.target.name, kind: model.target.kind, baseUrl: model.target.baseUrl, hasKey: !!model.target.apiKey }
  return describeFailure(f, provider, { during: 'draft', modelId: model.choice.modelId })
    .replace(/ The text that arrived is kept\.$/, '')
    .replace(/This model refused the scene\./, `The ${name} turned this down.`)
    .replace(/writer model/g, name)
}
