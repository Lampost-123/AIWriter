import { createServer } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { startFakeProvider, type FakeProvider } from '../../../tests/fake-provider/server.mjs'
import { forgetParams, knownParams, requestJson, streamChat, type ChatBody, type ChatTarget, type StreamChatOptions } from './client'

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
beforeEach(() => {
  fake.reset()
  forgetParams()
})

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
    expect(key.outcome.error).toBe("Fake didn't accept your API key. Check it in Settings › Models.")

    const missing = await run('fake/missing')
    expect(missing.outcome.error).toContain('doesn\'t have a model called “fake/missing”')

    const long = await run('fake/toolong')
    expect(long.outcome.error).toContain('The briefing and the length you asked for are too much for this model together')
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
    expect(outcome.error).toContain('The text that arrived is kept.')
  })

  it('asks again with the plain reply room when the model cannot write that much', async () => {
    const { outcome, retries } = await run('fake/max-output', { body: { ...body('fake/max-output'), max_tokens: 3000 }, fallbackMaxTokens: 800 })
    expect(outcome.status).toBe('complete')
    expect(outcome.maxTokens).toBe(800)
    expect(retries).toEqual([])
    expect(fake.requestCounts()['fake/max-output']).toBe(2)
    expect(fake.lastRequest()!.body.max_tokens).toBe(800)
    // Without a smaller limit to fall back on, the problem is explained.
    const plain = await run('fake/max-output', { body: { ...body('fake/max-output'), max_tokens: 3000 } })
    expect(plain.outcome.error).toContain("can't write that much in one reply")
  })

  it('asks with max_completion_tokens and without creativity settings when the model wants that, once each', async () => {
    const { outcome, retries } = await run('fake/o3')
    expect(outcome.status).toBe('complete')
    expect(outcome.error).toBeNull()
    expect(retries).toEqual([])
    // One extra request per setting the model turned down.
    expect(fake.requestCounts()['fake/o3']).toBe(3)
    const last = fake.lastRequest()!.body
    expect(last.max_completion_tokens).toBe(400)
    expect('max_tokens' in last).toBe(false)
    expect('temperature' in last).toBe(false)
    expect('top_p' in last).toBe(false)
    // Usage is still asked for: the rejections were about other settings.
    expect(last.stream_options).toEqual({ include_usage: true })
    expect(outcome.sentParams).toEqual({ tokenParam: 'max_completion_tokens', sampling: false })
    // Remembered, so the next draft with this model is right the first time.
    expect(knownParams(target(), 'fake/o3')).toEqual({ tokenParam: 'max_completion_tokens', sampling: false })
    fake.reset()
    const again = await run('fake/o3')
    expect(again.outcome.status).toBe('complete')
    expect(fake.requestCounts()['fake/o3']).toBe(1)
  })

  it('leaves out temperature for a model that only takes its default', async () => {
    const { outcome } = await run('fake/gpt5')
    expect(outcome.status).toBe('complete')
    expect(fake.requestCounts()['fake/gpt5']).toBe(2)
    expect(fake.lastRequest()!.body.max_tokens).toBe(400)
    expect(outcome.sentParams).toEqual({ tokenParam: 'max_tokens', sampling: false })
  })

  it('says a reply that ran into the reply limit was cut off, and keeps it', async () => {
    const { outcome } = await run('fake/length')
    expect(outcome.status).toBe('complete')
    expect(outcome.error).toBeNull()
    expect(outcome.cutOff).toBe(true)
    expect(outcome.text.length).toBeGreaterThan(20)
    const normal = await run('fake/writer')
    expect(normal.outcome.cutOff).toBe(false)
  })

  it('asks for a shorter reply when OpenRouter credit only covers a smaller one', async () => {
    const { outcome } = await run('fake/credit-limit', { body: { ...body('fake/credit-limit'), max_tokens: 9000 }, fallbackMaxTokens: 2500 })
    expect(outcome.status).toBe('complete')
    expect(outcome.maxTokens).toBe(2500)
    expect(fake.requestCounts()['fake/credit-limit']).toBe(2)
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
    expect(outcome.error).toBe('This model refused the scene. Try another model in Settings › Models.')
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

describe('streamChat: thinking', () => {
  const openrouter = (): ChatTarget => target({ kind: 'openrouter', name: 'OpenRouter' })

  it('asks for each thinking level the way the provider takes it, and nothing when left to the model', async () => {
    await run('fake/writer', { thinking: 'off' })
    expect(fake.lastRequest()!.body.reasoning_effort).toBe('none')
    expect(fake.lastRequest()!.body.reasoning).toBeUndefined()
    await run('fake/writer', { target: openrouter(), thinking: 'high' })
    expect(fake.lastRequest()!.body.reasoning).toEqual({ effort: 'high' })
    expect(fake.lastRequest()!.body.reasoning_effort).toBeUndefined()
    const { outcome } = await run('fake/writer', { target: openrouter(), thinking: 'medium' })
    expect(outcome.effort).toBe('medium')
    await run('fake/writer', { thinking: 'auto' })
    expect(fake.lastRequest()!.body).not.toHaveProperty('reasoning_effort')
    await run('fake/writer')
    expect(fake.lastRequest()!.body).not.toHaveProperty('reasoning_effort')
  })

  it("asks a model that can't stop thinking to think as little as it can, and remembers", async () => {
    const { outcome, retries } = await run('fake/must-think', { target: openrouter(), thinking: 'off' })
    expect(outcome.status).toBe('complete')
    expect(retries).toEqual([])
    expect(outcome.effort).toBe('low')
    expect(fake.lastRequest()!.body.reasoning).toEqual({ effort: 'low' })
    expect(fake.requestCounts()['fake/must-think']).toBe(2)
    await run('fake/must-think', { target: openrouter(), thinking: 'off' })
    expect(fake.requestCounts()['fake/must-think']).toBe(3)
  })

  it('stops asking a model that takes no thinking setting, and remembers', async () => {
    const { outcome } = await run('fake/no-thinking-option', { thinking: 'off' })
    expect(outcome.status).toBe('complete')
    expect(outcome.effort).toBeNull()
    expect(fake.lastRequest()!.body).not.toHaveProperty('reasoning_effort')
    // Still asks for usage: only the thinking setting was turned down.
    expect(fake.lastRequest()!.body.stream_options).toEqual({ include_usage: true })
    expect(fake.requestCounts()['fake/no-thinking-option']).toBe(3)
    await run('fake/no-thinking-option', { thinking: 'high' })
    expect(fake.requestCounts()['fake/no-thinking-option']).toBe(5)
    await run('fake/no-thinking-option', { thinking: 'off' })
    expect(fake.requestCounts()['fake/no-thinking-option']).toBe(6)
  })

  it('drops stream_options before the thinking setting when the server turns down stream_options', async () => {
    const { outcome } = await run('fake/no-stream-options', { thinking: 'off' })
    expect(outcome.status).toBe('complete')
    expect(outcome.effort).toBe('none')
    expect(fake.lastRequest()!.body.reasoning_effort).toBe('none')
    expect(fake.requestCounts()['fake/no-stream-options']).toBe(2)
  })

  it('asks once more with room to think when the thinking used up the reply limit, and remembers the model', async () => {
    const { outcome } = await run('fake/overthinker', { thinkingRoom: 5000 })
    expect(outcome.status).toBe('complete')
    expect(outcome.text).toMatch(/^The rain/)
    expect(outcome.maxTokens).toBe(5000)
    expect(fake.requestCounts()['fake/overthinker']).toBe(2)
    // Both tries are counted: the first was billed for its thinking.
    expect(outcome.completionTokens).toBeGreaterThan(400)
    const again = await run('fake/overthinker', { thinkingRoom: 5000 })
    expect(again.outcome.status).toBe('complete')
    expect(fake.requestCounts()['fake/overthinker']).toBe(3)
    expect(fake.lastRequest()!.body.max_tokens).toBe(5000)
  })

  it('says so in plain words when thinking used up all the room', async () => {
    const { outcome } = await run('fake/overthinker')
    expect(outcome.status).toBe('error')
    expect(outcome.failure).toEqual({ type: 'empty', thinking: true })
    expect(outcome.error).toBe("The writer model used up its room thinking and wrote nothing. Try again, or set the writer's Thinking lower in Settings › Models.")
    // Not enough room even with more: the same, after one more try.
    const bigger = await run('fake/overthinker', { thinkingRoom: 2000 })
    expect(bigger.outcome.failure).toEqual({ type: 'empty', thinking: true })
    expect(fake.requestCounts()['fake/overthinker']).toBe(3)
  })

  it('reads replies sent as lists of parts, leaving out thinking parts', async () => {
    const { outcome } = await run('fake/content-parts')
    expect(outcome.status).toBe('complete')
    expect(outcome.text).toMatch(/^The rain/)
    expect(outcome.text).not.toContain('private thought')
  })

  it('tries again when the server stops with an error before writing anything', async () => {
    const { outcome, retries } = await run('fake/finish-error-once')
    expect(outcome.status).toBe('complete')
    expect(retries).toHaveLength(1)
    expect(fake.requestCounts()['fake/finish-error-once']).toBe(2)
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
