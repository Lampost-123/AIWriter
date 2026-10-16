// How much a model can read at once when its provider's model list doesn't say (Adam, 2026-10-15, after the long story
// memory research: "AI Write forgets a lot between scenes and chapters"). OpenRouter gives every model's reading limit;
// most other services give none, and AI Write then assumed 16,000 tokens, which squeezed everything the writer is told
// of the story. DeepSeek's own API, which setup recommends first, is one of them in its older replies, though its models
// read far more. So a limit the model's maker publishes stands in for the guess: only where the provider says nothing,
// and never more than the maker says. Pure, and shared: the main side fills a missing limit in (settings.ts,
// ai/models.ts), and Settings › Models says where the number came from.

import type { ModelChoice, ProviderConfig } from './types'
import { isAnthropicApi } from './urls'

/** A reading limit the model's maker publishes, in tokens, with who publishes it ("DeepSeek"). */
export interface PublishedLimit {
  tokens: number
  by: string
}

/** DeepSeek's own API, as the DeepSeek preset in Settings › Models connects it. */
const DEEPSEEK_API = /^https?:\/\/api\.deepseek\.com(\/|$)/i
/**
 * DeepSeek's Models & Pricing page (api-docs.deepseek.com/quick_start/pricing, read 2026-10-15): deepseek-flash
 * (DeepSeek-V4.1-Flash) and deepseek-v4-pro read 1M tokens, and the retired deepseek-v4-flash names are still taken (V4.1
 * Flash answers them). Counted as a round million, a little under the most it may mean.
 */
const DEEPSEEK_V4 = /^deepseek-(?:flash|v4)(?![\w])/i
export const DEEPSEEK_V4_LIMIT = 1_000_000
/**
 * Any other model on DeepSeek's API (deepseek-chat, deepseek-reasoner, a name not known yet): every model it has offered
 * since V3 reads at least 64,000 tokens, so that much is safe, and four times the guess.
 */
export const DEEPSEEK_OTHER_LIMIT = 64_000

/**
 * Anthropic's models overview (docs.claude.com): every Claude model on its own API reads at least 200,000 tokens
 * (some read more with a beta switch AI Write doesn't send).
 */
export const CLAUDE_LIMIT = 200_000

/** The reading limit the maker publishes for this model on this provider address; null when not known here. */
export function publishedReadingLimit(baseUrl: string | null | undefined, modelId: string): PublishedLimit | null {
  const id = modelId.trim()
  if (!baseUrl || !id) return null
  if (isAnthropicApi(baseUrl)) return /^claude-/i.test(id) ? { tokens: CLAUDE_LIMIT, by: 'Anthropic' } : null
  if (!DEEPSEEK_API.test(baseUrl.trim())) return null
  return { tokens: DEEPSEEK_V4.test(id) ? DEEPSEEK_V4_LIMIT : DEEPSEEK_OTHER_LIMIT, by: 'DeepSeek' }
}

/**
 * Each job's model with its reading limit filled in where it is missing and its maker publishes one. A limit already
 * there (the provider's own, or one Adam typed) is kept as it is. Returns the same object when nothing changes.
 */
export function withReadingLimits<M extends Record<string, ModelChoice | null>>(
  models: M,
  providers: Pick<ProviderConfig, 'id' | 'kind' | 'baseUrl'>[]
): M {
  let out: M | null = null
  for (const [job, choice] of Object.entries(models)) {
    if (!choice || (choice.contextLength != null && choice.contextLength > 0)) continue
    const provider = providers.find((p) => p.id === choice.providerId)
    if (!provider || provider.kind !== 'custom') continue
    const known = publishedReadingLimit(provider.baseUrl, choice.modelId)
    if (!known) continue
    out = out ?? { ...models }
    ;(out as Record<string, ModelChoice | null>)[job] = { ...choice, contextLength: known.tokens }
  }
  return out ?? models
}
