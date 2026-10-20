// Writing temperature (Settings › Models): the stored value made safe, each provider's range, and the plain words
// for a model that won't use it.
import { describe, expect, it } from 'vitest'
import { defaultSettings, writerTemperature } from './defaults'
import { cleanWritingTemperature, isClaude, isDeepSeek, temperatureCeiling, temperatureIgnored, writingTemperatureFor } from './temperature'

describe('Writing temperature in settings', () => {
  it('is Auto (null) by default, and settings saved before it read as Auto', () => {
    expect(defaultSettings('/lib').writingTemperature).toBeNull()
    expect(cleanWritingTemperature(undefined)).toBeNull()
    expect(cleanWritingTemperature(null)).toBeNull()
  })

  it('keeps a number from 0 to 2 in steps of 0.05, and turns anything else to Auto', () => {
    expect(cleanWritingTemperature(1.5)).toBe(1.5)
    expect(cleanWritingTemperature(0)).toBe(0)
    expect(cleanWritingTemperature(1.53)).toBe(1.55)
    expect(cleanWritingTemperature(0.1 + 0.2)).toBe(0.3)
    expect(cleanWritingTemperature(-1)).toBe(0)
    expect(cleanWritingTemperature(9)).toBe(2)
    expect(cleanWritingTemperature('1.5')).toBeNull()
    expect(cleanWritingTemperature(Number.NaN)).toBeNull()
    expect(cleanWritingTemperature(Infinity)).toBeNull()
  })
})

describe('Each provider’s range', () => {
  it('knows DeepSeek by its own API or by the model’s name', () => {
    expect(isDeepSeek('https://api.deepseek.com/v1', 'deepseek-chat')).toBe(true)
    expect(isDeepSeek('https://api.deepseek.com', 'anything')).toBe(true)
    expect(isDeepSeek('https://openrouter.ai/api/v1', 'deepseek/deepseek-chat-v3.1')).toBe(true)
    expect(isDeepSeek('https://openrouter.ai/api/v1', 'openai/gpt-5')).toBe(false)
  })

  it('gives Claude 0 to 1 and the rest 0 to 2', () => {
    expect(isClaude('https://api.anthropic.com/v1', 'claude-sonnet-4-5')).toBe(true)
    expect(temperatureCeiling('https://api.anthropic.com/v1', 'claude-sonnet-4-5')).toBe(1)
    expect(temperatureCeiling('https://openrouter.ai/api/v1', 'anthropic/claude-opus-4.1')).toBe(1)
    expect(temperatureCeiling('https://api.deepseek.com/v1', 'deepseek-chat')).toBe(2)
    expect(temperatureCeiling('http://localhost:1234/v1', 'qwen3-14b')).toBe(2)
  })

  it('Auto keeps the creativity’s temperature; Custom takes its place within the range', () => {
    const ds = { baseUrl: 'https://api.deepseek.com/v1' }
    const claude = { baseUrl: 'https://api.anthropic.com/v1' }
    expect(writingTemperatureFor(writerTemperature('balanced'), null, ds, 'deepseek-chat')).toEqual({ temperature: 1, own: false })
    expect(writingTemperatureFor(writerTemperature('steady'), undefined, ds, 'deepseek-chat')).toEqual({ temperature: 0.6, own: false })
    expect(writingTemperatureFor(1, 1.5, ds, 'deepseek-chat')).toEqual({ temperature: 1.5, own: true })
    expect(writingTemperatureFor(1, 1.5, claude, 'claude-sonnet-4-5')).toEqual({ temperature: 1, own: true })
    expect(writingTemperatureFor(1, 0.7, claude, 'claude-sonnet-4-5')).toEqual({ temperature: 0.7, own: true })
  })
})

describe('A model that won’t use it', () => {
  const ds = 'https://api.deepseek.com/v1'
  it('says so for a model that sets its own temperature', () => {
    expect(temperatureIgnored({ baseUrl: 'https://openrouter.ai/api/v1', modelId: 'openai/o3', sampling: false }, 'off')).toMatch(/sets its own temperature/)
  })
  it('says so for DeepSeek while it thinks: its reasoner always, a chat model with the writer’s Thinking on', () => {
    expect(temperatureIgnored({ baseUrl: ds, modelId: 'deepseek-reasoner' }, 'off')).toMatch(/always thinks/)
    expect(temperatureIgnored({ baseUrl: 'https://openrouter.ai/api/v1', modelId: 'deepseek/deepseek-r1' }, 'off')).toMatch(/always thinks/)
    expect(temperatureIgnored({ baseUrl: ds, modelId: 'deepseek-chat' }, 'medium')).toMatch(/Thinking to Off/)
    expect(temperatureIgnored({ baseUrl: ds, modelId: 'deepseek-chat' }, 'off')).toBeNull()
    expect(temperatureIgnored({ baseUrl: ds, modelId: 'deepseek-chat' }, 'auto')).toBeNull()
  })
  it('says nothing for a model that takes it', () => {
    expect(temperatureIgnored({ baseUrl: 'https://api.openai.com/v1', modelId: 'gpt-4.1', sampling: true }, 'high')).toBeNull()
  })
})
