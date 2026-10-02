// Which model the story flows use, in one place. The flows are memory work (the spec gives them to the
// memory model), so they use the memory model (the writer model when none is chosen) and the memory's
// Thinking in Settings › Models, as the memory keeper does, with the same plain-words errors.

import { getSettings } from '../settings'
import { getProvider, providerTarget } from '../ai/providers'
import { isLocalUrl, providerWho } from '../ai/errors'
import { NO_FLOW_MODEL, type FlowModel } from './call'

/** The model for the story flows and how to reach it, or why there is none, in plain words. */
export function flowTarget(): FlowModel | { error: string } {
  const s = getSettings()
  const choice = s.models.memory ?? s.models.writer
  if (!choice) return { error: NO_FLOW_MODEL }
  const provider = getProvider(choice.providerId)
  if (!provider) {
    return {
      error: s.models.memory
        ? 'The memory model came from a provider that has been removed. Pick another memory model in Settings › Models.'
        : "The writer model's provider has been removed. Choose a memory model in Settings › Models, then try again."
    }
  }
  const target = providerTarget(provider)
  if (!target.apiKey && !(provider.kind === 'custom' && isLocalUrl(provider.baseUrl))) {
    return { error: `${providerWho(provider)} needs an API key. Add it in Settings › Models, then try again.` }
  }
  return { target, choice, thinking: s.thinking?.memory ?? 'off' }
}
