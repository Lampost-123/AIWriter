import { createServer } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { startFakeProvider, type FakeProvider } from '../../../tests/fake-provider/server.mjs'
import { requestJson, streamChat, type ChatBody, type ChatTarget, type StreamChatOptions } from './client'

let fake: FakeProvider
/** A local port with nothing listening on it. */
let closedPort = 0

beforeAll(async () => {
  fake = await startFakeProvider({ delayMs: 1, words: 60, slowWords: 3000, slowDelayMs: 5 })
  closedPort = await new Promise<number>((resolve) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port
      s.close(() => resolve(port))
    })
  })
})
afterAll(() => fake.close())
beforeEach(() => fake.reset())

const target = (over: Partial<ChatTarget> = {}): ChatTarget => ({ name: 'Fake', kind: 'custom', baseUrl: fake.url, apiKey: 'good', ...over })
const body = (model: string): ChatBody => ({ model, messages: [{ role: 'system', content: 'Be brief.' }, { role: 'user', content: 'Write.' }], temperature: 0.8, top_p: 0.95, max_tokens: 400 })

async function run(model: string, over: Partial<StreamChatOptions> = {}) {
  const pieces: string[] = []
  const retries: { attempt: number; waitMs: number; reason: string }[] = []
  const outcome = await streamChat({
    target: target(),
    body: body(model),
    signal: new AbortController().signal,
    onText: (t) => pieces.push(t),
    onRetry: (r) => retries.push(r),
    delays: [5, 10, 20, 40],
    ...over
  })
  return { outcome, pieces, retries }
}

describe('streamChat', () => {
  it('streams the reply in pieces and reports usage', async () => {
    const { outcome, pieces } = await run('fake/writer')
    expect(outcome.status).toBe('complete')
    expect(outcome.error).toBeNull()
    expect(pieces.length).toBeGreaterThan(5)
    expect(pieces.join('')).toBe(outcome.text)
    expect(outcome.text).toMatch(/^The rain had not let up/)
    expect(outcome.text).toContain('\n\n')
    expect(outcome.promptTokens).toBeGreaterThan(0)
    expect(outcome.completionTokens).toBeGreaterThan(0)
    expect(outcome.finishReason).toBe('stop')
  })

  it('asks for usage the way each provider expects', async () => {
    await run('fake/writer')
    expect(fake.lastRequest()!.body.stream_options).toEqual({ include_usage: true })
    expect(fake.lastRequest()!.body.stream).toBe(true)
    expect(fake.lastRequest()!.body.temperature).toBe(0.8)

    const r = await run('fake/writer', { target: target({ kind: 'openrouter', name: 'OpenRouter' }) })
    const last = fake.lastRequest()!
    expect(last.body.usage).toEqual({ include: true })
    expect(last.body.stream_options).toBeUndefined()
    expect(last.headers['http-referer']).toBe('https://github.com/lampost-123/aiwriter')
    expect(last.headers['x-title']).toBe('AI Write')
    expect(last.headers.authorization).toBe('Bearer good')
    // OpenRouter reports the cost itself.
    expect(r.outcome.cost).toBeGreaterThan(0)
  })

  it('asks again without stream_options when the server rejects it', async () => {
    const { outcome, retries } = await run('fake/no-stream-options')
    expect(outcome.status).toBe('complete')
    expect(retries).toEqual([])
    expect(fake.requestCounts()['fake/no-stream-options']).toBe(2)
    expect(fake.lastRequest()!.body.stream_options).toBeUndefined()
  })

  it('retries a rate limit before any text, then succeeds', async () => {
    const { outcome, retries } = await run('fake/ratelimit-once')
    expect(outcome.status).toBe('complete')
    expect(retries).toHaveLength(1)
    expect(retries[0].attempt).toBe(1)
    expect(retries[0].waitMs).toBe(1000) // the server's Retry-After
    expect(retries[0].reason).toBe('Fake is busy')
    expect(outcome.retries).toBe(1)
  })

  it('retries a server error', async () => {
    const { outcome, retries } = await run('fake/servererror-once')
    expect(outcome.status).toBe('complete')
    expect(retries).toHaveLength(1)
  })

  it('gives up with plain words on credit and key problems, without retrying', async () => {
    const credit = await run('fake/credit', { target: target({ kind: 'openrouter', name: 'OpenRouter' }) })
    expect(credit.outcome.status).toBe('error')
    expect(credit.outcome.error).toBe('Your OpenRouter credit has run out. Top up, or switch the writer model in Settings.')
    expect(credit.retries).toEqual([])

    const key = await run('fake/badkey')
    expect(key.outcome.error).toBe("Fake didn't accept your API key. Check it in Settings > Models.")

    const missing = await run('fake/missing')
    expect(missing.outcome.error).toContain('doesn\'t have a model called “fake/missing”')

    const long = await run('fake/toolong')
    expect(long.outcome.error).toContain('The briefing is too long for this model')
  })

  it('keeps the text when the connection drops partway, and does not retry', async () => {
    const { outcome, pieces, retries } = await run('fake/drop')
    expect(outcome.status).toBe('error')
    expect(outcome.text.length).toBeGreaterThan(20)
    expect(pieces.join('')).toBe(outcome.text)
    expect(outcome.error).toContain('The text that arrived is kept')
    expect(retries).toEqual([])
    expect(fake.requestCounts()['fake/drop']).toBe(1)
  })

  it('keeps the text when an error arrives mid-stream', async () => {
    const { outcome } = await run('fake/midstream-error')
    expect(outcome.status).toBe('error')
    expect(outcome.text.length).toBeGreaterThan(20)
    expect(outcome.error).toContain('having trouble')
  })

  it('stops when asked and keeps what arrived', async () => {
    const ctl = new AbortController()
    let received = 0
    const p = streamChat({
      target: target(),
      body: body('fake/slow'),
      signal: ctl.signal,
      onText: (t) => {
        received += t.length
        if (received > 200) ctl.abort()
      }
    })
    const outcome = await p
    expect(outcome.status).toBe('stopped')
    expect(outcome.error).toBeNull()
    expect(outcome.text.length).toBeGreaterThan(200)
    expect(outcome.text.length).toBeLessThan(5000)
  })

  it('hides thinking from the scene text', async () => {
    const { outcome } = await run('fake/think')
    expect(outcome.status).toBe('complete')
    expect(outcome.text).not.toMatch(/think|Planning|private/i)
    expect(outcome.text).toMatch(/^The rain had not let up/)
  })

  it('reports a refusal', async () => {
    const { outcome } = await run('fake/refuse')
    expect(outcome.status).toBe('error')
    expect(outcome.error).toBe('This model refused the scene. Try another model in Settings > Models.')
  })

  it('reports an empty reply', async () => {
    const { outcome } = await run('fake/empty')
    expect(outcome.status).toBe('error')
    expect(outcome.error).toContain('sent back an empty draft')
  })

  it('copes with CRLF streams', async () => {
    const crlf = await startFakeProvider({ delayMs: 0, words: 40, crlf: true })
    try {
      const { outcome } = await run('fake/writer', { target: target({ baseUrl: crlf.url }) })
      expect(outcome.status).toBe('complete')
      expect(outcome.text).toMatch(/^The rain/)
    } finally {
      await crlf.close()
    }
  })

  it('retries when nothing is listening, then explains in plain words', async () => {
    const baseUrl = `http://127.0.0.1:${closedPort}/v1`
    const { outcome, retries } = await run('fake/writer', { target: target({ baseUrl, name: 'LM Studio' }) })
    expect(retries).toHaveLength(4)
    expect(retries.map((r) => r.attempt)).toEqual([1, 2, 3, 4])
    expect(outcome.status).toBe('error')
    expect(outcome.error).toContain(`Couldn't reach LM Studio at ${baseUrl}`)
  })

  it('times out a server that never answers', async () => {
    const hang: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })
    const { outcome, retries } = await run('fake/writer', {
      target: target({ baseUrl: 'https://api.example.com/v1' }),
      fetchImpl: hang,
      headersTimeoutMs: 20,
      delays: [1, 1, 1, 1]
    })
    expect(retries).toHaveLength(4)
    expect(outcome.error).toBe("Fake didn't answer in time. Try again in a moment.")
    // A program on this computer may just be loading its model.
    const local = await run('fake/writer', { fetchImpl: hang, headersTimeoutMs: 20, delays: [1, 1, 1, 1] })
    expect(local.outcome.error).toContain('If the model is still loading')
  })
})

describe('requestJson', () => {
  it('fetches JSON and reports failures as plain-words failures', async () => {
    const ok = await requestJson(target(), 'models')
    expect(ok.ok).toBe(true)
    const missing = await requestJson(target(), 'nope')
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.failure).toMatchObject({ type: 'http', status: 404 })
    const down = await requestJson(target({ baseUrl: `http://127.0.0.1:${closedPort}/v1` }), 'models')
    expect(down.ok).toBe(false)
    if (!down.ok) expect(down.failure).toMatchObject({ type: 'network', code: 'ECONNREFUSED' })
  })
})
