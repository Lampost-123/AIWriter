import { describe, expect, it } from 'vitest'
import type { ModelChoice, ProviderConfig } from './types'
import { DEEPSEEK_OTHER_LIMIT, DEEPSEEK_V4_LIMIT, publishedReadingLimit, withReadingLimits } from './readingLimits'

const choice = (providerId: string, modelId: string, contextLength: number | null = null): ModelChoice => ({
  providerId,
  modelId,
  label: modelId,
  contextLength,
  promptPrice: null,
  completionPrice: null
})

const providers: Pick<ProviderConfig, 'id' | 'kind' | 'baseUrl'>[] = [
  { id: 'ds', kind: 'custom', baseUrl: 'https://api.deepseek.com/v1' },
  { id: 'ds-bare', kind: 'custom', baseUrl: 'https://api.deepseek.com' },
  { id: 'lm', kind: 'custom', baseUrl: 'http://localhost:1234/v1' },
  { id: 'or', kind: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1' }
]

describe('publishedReadingLimit', () => {
  it("knows DeepSeek's own API: a million tokens for its V4 models, 64,000 for anything else there", () => {
    expect(publishedReadingLimit('https://api.deepseek.com/v1', 'deepseek-flash')).toEqual({ tokens: DEEPSEEK_V4_LIMIT, by: 'DeepSeek' })
    expect(publishedReadingLimit('https://api.deepseek.com', 'deepseek-v4-pro')?.tokens).toBe(1_000_000)
    expect(publishedReadingLimit('https://API.deepseek.com/v1', 'deepseek-v4-flash')?.tokens).toBe(1_000_000)
    expect(publishedReadingLimit('https://api.deepseek.com/v1', 'deepseek-v4.1-flash')?.tokens).toBe(1_000_000)
    expect(publishedReadingLimit('https://api.deepseek.com/v1', 'deepseek-chat')?.tokens).toBe(DEEPSEEK_OTHER_LIMIT)
    expect(publishedReadingLimit('https://api.deepseek.com/v1', 'deepseek-reasoner')?.tokens).toBe(64_000)
    // Never a name that only starts the same way.
    expect(publishedReadingLimit('https://api.deepseek.com/v1', 'deepseek-flashy')?.tokens).toBe(64_000)
  })

  it('says nothing for other addresses, or without a model', () => {
    expect(publishedReadingLimit('http://localhost:1234/v1', 'deepseek-flash')).toBeNull()
    expect(publishedReadingLimit('https://api.deepseek.com.evil.example/v1', 'deepseek-flash')).toBeNull()
    expect(publishedReadingLimit('https://openrouter.ai/api/v1', 'deepseek/deepseek-v4-flash')).toBeNull()
    expect(publishedReadingLimit(undefined, 'deepseek-flash')).toBeNull()
    expect(publishedReadingLimit('https://api.deepseek.com/v1', '  ')).toBeNull()
  })
})

describe('withReadingLimits', () => {
  it('fills in a missing limit the maker publishes, and leaves every other model alone', () => {
    const models = {
      writer: choice('ds', 'deepseek-flash'),
      memory: choice('ds-bare', 'deepseek-chat'),
      check: choice('ds', 'deepseek-flash', 32_000),
      builder: choice('lm', 'local-model'),
      chat: choice('or', 'deepseek/deepseek-v4-flash'),
      speech: null
    }
    const out = withReadingLimits(models, providers)
    expect(out.writer?.contextLength).toBe(1_000_000)
    expect(out.memory?.contextLength).toBe(64_000)
    // A limit Adam typed (or the provider gave) is kept.
    expect(out.check?.contextLength).toBe(32_000)
    // Not known for a local server or an OpenRouter model (OpenRouter says it itself).
    expect(out.builder?.contextLength).toBeNull()
    expect(out.chat?.contextLength).toBeNull()
    expect(out.speech).toBeNull()
    // The rest of each choice is unchanged, and the input isn't touched.
    expect(out.writer).toEqual({ ...models.writer, contextLength: 1_000_000 })
    expect(models.writer.contextLength).toBeNull()
  })

  it('gives back the same object when there is nothing to fill in', () => {
    const models = { writer: choice('lm', 'local-model'), memory: choice('ds', 'deepseek-flash', 128_000) }
    expect(withReadingLimits(models, providers)).toBe(models)
    // A provider since removed: nothing to go on.
    const gone = { writer: choice('nowhere', 'deepseek-flash') }
    expect(withReadingLimits(gone, providers)).toBe(gone)
  })
})
