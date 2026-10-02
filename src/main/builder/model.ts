// Which model the builder uses, in one place: the character builder model in Settings › Models, or the
// writer model while that is left as "Same as the writer model", with the same checks and the same
// plain words as drafting, and the character builder's own Thinking level (Off unless Adam changes it).
// No Electron imports: the caller passes the settings and the providers.

import type { ID, ModelChoice, ProviderConfig, Settings, ThinkingLevel } from '@shared/types'
import type { ChatTarget } from '../ai/client'
import { isLocalUrl, providerWho } from '../ai/errors'
import { UserError } from '../util'

/** The model the builder writes with and how to reach it. */
export interface BuilderModel {
  target: ChatTarget & { id: ID }
  choice: ModelChoice
  /** How much the model is asked to think (the character builder's Thinking in Settings › Models); Off when not said. */
  thinking?: ThinkingLevel
}

export interface ModelSources {
  settings: Pick<Settings, 'models'> & Partial<Pick<Settings, 'thinking'>>
  getProvider(id: ID): ProviderConfig | null
  providerTarget(p: ProviderConfig): ChatTarget & { id: ID }
}

/** The builder's model, or a plain-words UserError saying what to set up in Settings › Models. */
export function builderTarget(src: ModelSources): BuilderModel {
  const own = src.settings.models.builder ?? null
  const choice = own ?? src.settings.models.writer
  if (!choice) throw new UserError('Choose a writer model first, in Settings › Models.', 'no-writer-model')
  const provider = src.getProvider(choice.providerId)
  if (!provider) {
    throw new UserError(
      own
        ? "The character builder model's provider has been removed. Choose a character builder model in Settings › Models."
        : "The writer model's provider has been removed. Choose a writer model in Settings › Models.",
      'no-writer-model'
    )
  }
  const target = src.providerTarget(provider)
  if (!target.apiKey && !(provider.kind === 'custom' && isLocalUrl(provider.baseUrl))) {
    throw new UserError(`${providerWho(provider)} needs an API key. Add it in Settings › Models.`, 'no-key')
  }
  return { target, choice, thinking: src.settings.thinking?.builder ?? 'off' }
}
