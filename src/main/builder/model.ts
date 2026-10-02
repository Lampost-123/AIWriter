// Which model the builder uses, in one place. Until the builder has its own job in Settings › Models
// (with a Thinking level, off by default), it uses the writer model, with the same checks and the same
// plain words as drafting. No Electron imports: the caller passes the settings and the providers.

import type { ID, ModelChoice, ProviderConfig, Settings } from '@shared/types'
import type { ChatTarget } from '../ai/client'
import { isLocalUrl, providerWho } from '../ai/errors'
import { UserError } from '../util'

/** The model the builder writes with and how to reach it. */
export interface BuilderModel {
  target: ChatTarget & { id: ID }
  choice: ModelChoice
}

export interface ModelSources {
  settings: Pick<Settings, 'models'>
  getProvider(id: ID): ProviderConfig | null
  providerTarget(p: ProviderConfig): ChatTarget & { id: ID }
}

/** The builder's model, or a plain-words UserError saying what to set up in Settings › Models. */
export function builderTarget(src: ModelSources): BuilderModel {
  const choice = src.settings.models.writer
  if (!choice) throw new UserError('Choose a writer model first, in Settings › Models.', 'no-writer-model')
  const provider = src.getProvider(choice.providerId)
  if (!provider) {
    throw new UserError("The writer model's provider has been removed. Choose a writer model in Settings › Models.", 'no-writer-model')
  }
  const target = src.providerTarget(provider)
  if (!target.apiKey && !(provider.kind === 'custom' && isLocalUrl(provider.baseUrl))) {
    throw new UserError(`${providerWho(provider)} needs an API key. Add it in Settings › Models.`, 'no-key')
  }
  return { target, choice }
}
