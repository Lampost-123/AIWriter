// Anthropic's own API (the Anthropic preset): asked OpenAI's way, with its key also as x-api-key and an API version,
// and creativity as temperature alone, since its newer models turn down temperature and top_p together.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { startFakeProvider, type FakeProvider } from '../../../tests/fake-provider/server.mjs'
import { ANTHROPIC_VERSION, forgetParams, requestHeaders, requestJson, streamChat, type ChatBody, type ChatTarget } from './client'

const ANTHROPIC = 'https://api.anthropic.com/v1'

let fake: FakeProvider

beforeAll(async () => {
  fake = await startFakeProvider({ delayMs: 1, words: 20 })
})
afterAll(() => fake.close())
beforeEach(() => {
  fake.reset()
  forgetParams()
})

const anthropic = (): ChatTarget => ({ name: 'Anthropic', kind: 'custom', baseUrl: ANTHROPIC, apiKey: 'sk-ant-test' })
const body: ChatBody = { model: 'claude-sonnet-4-5', messages: [{ role: 'user', content: 'Write.' }], temperature: 0.85, top_p: 0.95, max_tokens: 400 }

/** Sends what was meant for Anthropic to the fake provider instead, keeping each request's address and headers. */
function viaFake(): { fetchImpl: typeof fetch; seen: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] } {
  const seen: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = []
  const fetchImpl: typeof fetch = async (url, init) => {
    seen.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string>, body: JSON.parse(String(init?.body ?? '{}')) })
    return fetch(String(url).replace(ANTHROPIC, fake.url), init)
  }
  return { fetchImpl, seen }
}

describe("Anthropic's own API", () => {
  it('gets the key as x-api-key too, with the API version; other services do not', () => {
    expect(requestHeaders(anthropic())).toMatchObject({ Authorization: 'Bearer sk-ant-test', 'x-api-key': 'sk-ant-test', 'anthropic-version': ANTHROPIC_VERSION })
    const other = requestHeaders({ kind: 'custom', apiKey: 'k', baseUrl: 'https://api.deepseek.com/v1' })
    expect('x-api-key' in other).toBe(false)
    expect('anthropic-version' in other).toBe(false)
    expect('x-api-key' in requestHeaders({ kind: 'custom', apiKey: 'k', baseUrl: 'https://api.anthropic.com.evil.example/v1' })).toBe(false)
  })

  it('is sent creativity as temperature alone', async () => {
    const p = viaFake()
    const outcome = await streamChat({ target: anthropic(), body, signal: new AbortController().signal, onText: () => undefined, delays: [5], fetchImpl: p.fetchImpl, thinking: 'off' })
    expect(outcome.status).toBe('complete')
    expect(p.seen[0].url).toBe(`${ANTHROPIC}/chat/completions`)
    expect(p.seen[0].headers['x-api-key']).toBe('sk-ant-test')
    expect(p.seen[0].body.temperature).toBe(0.85)
    expect('top_p' in p.seen[0].body).toBe(false)
  })

  it('still gets top_p elsewhere', async () => {
    await streamChat({ target: { ...anthropic(), baseUrl: fake.url }, body, signal: new AbortController().signal, onText: () => undefined, delays: [5], thinking: 'off' })
    expect(fake.lastRequest()!.body.top_p).toBe(0.95)
  })

  it('asks its model list with the key in x-api-key', async () => {
    const p = viaFake()
    await requestJson(anthropic(), 'models?limit=1000', { fetchImpl: p.fetchImpl })
    expect(p.seen[0].url).toBe(`${ANTHROPIC}/models?limit=1000`)
    expect(p.seen[0].headers['x-api-key']).toBe('sk-ant-test')
    expect(p.seen[0].headers['anthropic-version']).toBe(ANTHROPIC_VERSION)
  })
})
