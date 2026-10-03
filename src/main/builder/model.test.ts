import { describe, expect, it } from 'vitest'
import type { ModelChoice, ProviderConfig, ThinkingLevel } from '@shared/types'
import { UserError } from '../util'
import { builderTarget, type ModelSources } from './model'

const choice: ModelChoice = {
  providerId: 'p1',
  modelId: 'fake/writer',
  label: 'Fake',
  contextLength: 32000,
  promptPrice: null,
  completionPrice: null
}
const provider = (over: Partial<ProviderConfig> = {}): ProviderConfig => ({
  id: 'p1',
  name: 'Fake',
  kind: 'custom',
  baseUrl: 'https://fake.example/v1',
  hasKey: true,
  ...over
})

function sources(
  o: { writer?: ModelChoice | null; builder?: ModelChoice | null; thinking?: ThinkingLevel; provider?: ProviderConfig | null; key?: string | null } = {}
): ModelSources {
  const p = o.provider === undefined ? provider() : o.provider
  return {
    settings: {
      models: { writer: o.writer === undefined ? choice : o.writer, memory: null, chat: null, builder: o.builder ?? null, speech: null, world: null, check: null, recipe: null },
      ...(o.thinking ? { thinking: { writer: 'off', memory: 'off', chat: 'off', builder: o.thinking, speech: 'off', world: 'off', check: 'off', recipe: 'off', sounds: 'off' } } : {})
    },
    getProvider: (id) => (p && p.id === id ? p : null),
    providerTarget: (c) => ({ id: c.id, name: c.name, kind: c.kind, baseUrl: c.baseUrl, apiKey: o.key === undefined ? 'sk-test' : o.key })
  }
}

const failure = (src: ModelSources): UserError => {
  try {
    builderTarget(src)
  } catch (e) {
    if (e instanceof UserError) return e
    throw e
  }
  throw new Error('expected a plain-words error')
}

describe('the model the builder uses', () => {
  it('is the writer model, with its provider and key', () => {
    const m = builderTarget(sources())
    expect(m.choice).toBe(choice)
    expect(m.target).toMatchObject({ id: 'p1', baseUrl: 'https://fake.example/v1', apiKey: 'sk-test' })
  })

  it('is the character builder model when one is chosen', () => {
    const own: ModelChoice = { ...choice, modelId: 'fake/builder', label: 'Builder' }
    expect(builderTarget(sources({ builder: own })).choice).toBe(own)
    expect(builderTarget(sources({ builder: own, writer: null })).choice).toBe(own)
  })

  it("asks with the character builder's Thinking level, Off when none is saved", () => {
    expect(builderTarget(sources()).thinking).toBe('off')
    expect(builderTarget(sources({ thinking: 'high' })).thinking).toBe('high')
  })

  it('says to choose a writer model when there is none', () => {
    const e = failure(sources({ writer: null }))
    expect(e.message).toBe('Choose a writer model first, in Settings › Models.')
    expect(e.code).toBe('no-writer-model')
  })

  it("says so when the writer model's provider has been removed", () => {
    const e = failure(sources({ provider: null }))
    expect(e.message).toMatch(/provider has been removed\. Choose a writer model in Settings › Models\./)
    expect(e.code).toBe('no-writer-model')
    expect(failure(sources({ provider: null, builder: choice })).message).toBe(
      "The character builder model's provider has been removed. Choose a character builder model in Settings › Models."
    )
  })

  it('asks for a key, except for a model running on this computer', () => {
    const e = failure(sources({ key: null }))
    expect(e.message).toBe('Fake needs an API key. Add it in Settings › Models.')
    expect(e.code).toBe('no-key')
    expect(failure(sources({ key: null, provider: provider({ kind: 'openrouter' }) })).message).toMatch(/^OpenRouter needs an API key/)
    expect(builderTarget(sources({ key: null, provider: provider({ baseUrl: 'http://localhost:1234/v1' }) })).target.apiKey).toBeNull()
  })
})
