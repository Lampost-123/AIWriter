// min_p (Part F): sent with the Balanced and Adventurous creativity, only to OpenRouter, and asked again
// without it when the model (or the service behind OpenRouter) turns it down.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { CREATIVITY_PRESETS } from '@shared/defaults'
import { startFakeProvider, type FakeProvider } from '../../../tests/fake-provider/server.mjs'
import { forgetParams, knownParams, streamChat, type ChatBody, type ChatTarget, type StreamChatOptions } from './client'

let fake: FakeProvider

beforeAll(async () => {
  fake = await startFakeProvider({ delayMs: 1, words: 30 })
})
afterAll(() => fake.close())
beforeEach(() => {
  fake.reset()
  forgetParams()
})

const openRouter = (): ChatTarget => ({ name: 'OpenRouter', kind: 'openrouter', baseUrl: fake.url, apiKey: 'good' })
const custom = (): ChatTarget => ({ name: 'Fake', kind: 'custom', baseUrl: fake.url, apiKey: 'good' })
const body = (model: string, min_p: number | null = 0.05): ChatBody => ({
  model,
  messages: [{ role: 'user', content: 'Write.' }],
  temperature: 0.85,
  top_p: 0.95,
  max_tokens: 400,
  min_p
})

/** A provider in front of the fake one that turns down any request carrying min_p, with `message`. */
function refusingMinP(message: string): { fetchImpl: typeof fetch; bodies: Record<string, unknown>[] } {
  const bodies: Record<string, unknown>[] = []
  const fetchImpl: typeof fetch = async (url, init) => {
    const sent = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
    bodies.push(sent)
    if ('min_p' in sent) {
      return new Response(JSON.stringify({ error: { code: 400, message } }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    }
    return fetch(url, init)
  }
  return { fetchImpl, bodies }
}

const run = (target: ChatTarget, b: ChatBody, over: Partial<StreamChatOptions> = {}) =>
  streamChat({ target, body: b, signal: new AbortController().signal, onText: () => undefined, delays: [5, 5, 5], ...over })

describe('min_p', () => {
  it('comes with the Balanced and Adventurous creativity, not Steady', () => {
    expect(CREATIVITY_PRESETS.balanced.min_p).toBe(0.05)
    expect(CREATIVITY_PRESETS.adventurous.min_p).toBe(0.05)
    expect(CREATIVITY_PRESETS.steady.min_p).toBeNull()
  })

  it('is sent to OpenRouter only, and only when given', async () => {
    await run(openRouter(), body('fake/writer'))
    expect(fake.lastRequest()!.body.min_p).toBe(0.05)
    expect(fake.lastRequest()!.body.temperature).toBe(0.85)

    await run(custom(), body('fake/writer'))
    expect('min_p' in fake.lastRequest()!.body).toBe(false)

    await run(openRouter(), body('fake/writer', null))
    expect('min_p' in fake.lastRequest()!.body).toBe(false)
  })

  it('is left out with the other creativity settings for a model that sets its own', async () => {
    await run(openRouter(), body('fake/writer'), { startParams: { tokenParam: 'max_tokens', sampling: false } })
    const sent = fake.lastRequest()!.body
    expect('min_p' in sent).toBe(false)
    expect('temperature' in sent).toBe(false)
  })

  it('is dropped once for a model that turns it down by name, and remembered for the model', async () => {
    const p = refusingMinP('Unrecognized request argument supplied: min_p')
    const outcome = await run(openRouter(), body('fake/writer'), { fetchImpl: p.fetchImpl, thinking: 'off' })
    expect(outcome.status).toBe('complete')
    expect(outcome.sentParams.minP).toBe(false)
    expect(p.bodies).toHaveLength(2)
    expect(p.bodies[0].min_p).toBe(0.05)
    expect('min_p' in p.bodies[1]).toBe(false)
    // The thinking setting stayed as it was: only min_p was taken away.
    expect(p.bodies[1].reasoning).toEqual({ effort: 'none' })
    expect(knownParams(openRouter(), 'fake/writer').minP).toBe(false)

    // The next request for the model leaves it out from the start.
    const again = refusingMinP('Unrecognized request argument supplied: min_p')
    await run(openRouter(), body('fake/writer'), { fetchImpl: again.fetchImpl })
    expect(again.bodies).toHaveLength(1)
    expect('min_p' in again.bodies[0]).toBe(false)
  })

  it('is dropped first when the request is turned down without a reason, without remembering it', async () => {
    const p = refusingMinP('Provider returned error')
    const outcome = await run(openRouter(), body('fake/writer'), { fetchImpl: p.fetchImpl, thinking: 'off' })
    expect(outcome.status).toBe('complete')
    expect(p.bodies).toHaveLength(2)
    expect('min_p' in p.bodies[1]).toBe(false)
    expect(p.bodies[1].reasoning).toEqual({ effort: 'none' })
    expect(knownParams(openRouter(), 'fake/writer').minP).toBeUndefined()
  })
})
