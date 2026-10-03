// The writer model for the style guide's helpers: the sample passage and the polish pass use the writer model,
// each with its own Thinking (Off unless Adam changes it), never the writer's.
import { describe, expect, it } from 'vitest'
import type { ModelChoice, ProviderConfig, Settings } from '@shared/types'
import { defaultSettings } from '@shared/defaults'
import { jobModel, writerModelFor, type ModelSources } from './jobModel'

const provider = { id: 'p1', kind: 'openrouter', name: 'OpenRouter', baseUrl: 'https://example.test/api/v1' } as ProviderConfig
const writer = { providerId: 'p1', modelId: 'fake/writer', label: 'Fake writer' } as ModelChoice

function sources(thinking: Partial<Settings['thinking']> = {}): ModelSources {
  const settings = defaultSettings('/library')
  return {
    settings: { models: { ...settings.models, writer }, thinking: { ...settings.thinking, ...thinking } },
    getProvider: (id) => (id === 'p1' ? provider : null),
    providerTarget: (p) => ({ id: p.id, name: p.name, kind: p.kind, baseUrl: p.baseUrl, apiKey: 'key' })
  }
}

describe('writerModelFor', () => {
  it('uses the writer model with the job’s own Thinking, Off by default', () => {
    const src = sources({ writer: 'high' })
    expect(defaultSettings('/library').thinking.sample).toBe('off')
    expect(defaultSettings('/library').thinking.polish).toBe('off')
    const sample = writerModelFor('sample', src)
    expect(sample.choice.modelId).toBe('fake/writer')
    expect(sample.job).toBe('writer')
    expect(sample.thinking).toBe('off')
    expect(writerModelFor('polish', src).thinking).toBe('off')
    expect(jobModel('writer', src).thinking).toBe('high')
  })

  it('follows each job’s Thinking choice', () => {
    const src = sources({ sample: 'low', polish: 'medium' })
    expect(writerModelFor('sample', src).thinking).toBe('low')
    expect(writerModelFor('polish', src).thinking).toBe('medium')
  })

  it('asks for a writer model first when there is none', () => {
    const src = sources()
    src.settings.models.writer = null
    expect(() => writerModelFor('sample', src)).toThrow('Choose a writer model first, in Settings › Models.')
  })
})
