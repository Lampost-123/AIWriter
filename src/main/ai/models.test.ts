import { describe, expect, it } from 'vitest'
import { normalizeBaseUrl, parseModelList } from './models'

describe('parseModelList', () => {
  it('reads OpenRouter context length and prices', () => {
    const list = parseModelList(
      {
        data: [
          { id: 'b/model', name: 'B: Model', context_length: 200000, pricing: { prompt: '0.000003', completion: '0.000015' }, top_provider: { max_completion_tokens: 64000 } },
          { id: 'openrouter/auto', name: 'Auto Router', context_length: 2000000, pricing: { prompt: '-1', completion: '-1' } },
          { id: 'a/free', name: 'A: Free', top_provider: { context_length: 8192 }, pricing: { prompt: '0', completion: '0' } }
        ]
      },
      'openrouter'
    )
    expect(list.map((m) => m.id)).toEqual(['a/free', 'openrouter/auto', 'b/model'])
    expect(list[2]).toEqual({ id: 'b/model', name: 'B: Model', contextLength: 200000, promptPrice: 0.000003, completionPrice: 0.000015, maxOutput: 64000 })
    expect(list[0].maxOutput).toBeNull()
    expect(list[1].promptPrice).toBeNull()
    expect(list[0]).toMatchObject({ contextLength: 8192, promptPrice: 0, completionPrice: 0 })
  })

  it('reads plain id lists from other providers, without prices', () => {
    const list = parseModelList(
      { object: 'list', data: [{ id: 'local-a', object: 'model' }, { id: 'local-b', context_window: 32768, max_completion_tokens: 8192 }, { id: 'local-a' }] },
      'custom'
    )
    expect(list).toEqual([
      { id: 'local-a', name: 'local-a', contextLength: null, promptPrice: null, completionPrice: null, maxOutput: null },
      { id: 'local-b', name: 'local-b', contextLength: 32768, promptPrice: null, completionPrice: null, maxOutput: 8192 }
    ])
  })

  it('copes with odd shapes', () => {
    expect(parseModelList(null, 'custom')).toEqual([])
    expect(parseModelList({ nothing: true }, 'custom')).toEqual([])
    expect(parseModelList([{ id: 'x' }, 'junk', null], 'custom').map((m) => m.id)).toEqual(['x'])
    expect(parseModelList({ models: [{ name: 'local-c' }] }, 'custom').map((m) => m.id)).toEqual(['local-c'])
  })
})

describe('normalizeBaseUrl', () => {
  it('keeps good URLs and trims trailing slashes', () => {
    expect(normalizeBaseUrl('https://api.deepseek.com/v1/')).toBe('https://api.deepseek.com/v1')
    expect(normalizeBaseUrl('  http://localhost:1234/v1  ')).toBe('http://localhost:1234/v1')
  })

  it('adds a scheme when it is missing', () => {
    expect(normalizeBaseUrl('localhost:11434/v1')).toBe('http://localhost:11434/v1')
    expect(normalizeBaseUrl('api.groq.com/openai/v1')).toBe('https://api.groq.com/openai/v1')
  })

  it('drops a pasted endpoint path', () => {
    expect(normalizeBaseUrl('https://api.openai.com/v1/chat/completions')).toBe('https://api.openai.com/v1')
    expect(normalizeBaseUrl('http://localhost:1234/v1/models')).toBe('http://localhost:1234/v1')
  })

  it('rejects things that are not web addresses', () => {
    expect(normalizeBaseUrl('')).toBeNull()
    expect(normalizeBaseUrl('ftp://example.com')).toBeNull()
    expect(normalizeBaseUrl('http://')).toBeNull()
  })
})
