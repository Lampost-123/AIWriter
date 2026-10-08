// A stand-in AI server for the screenshots: it sits in front of the test fake (tests/fake-provider/server.mjs) and
// answers the requests a screenshot shows with invented Gullhaven text, passing everything else (the memory keeper,
// summaries, checks) through to the fake. No real AI, no network beyond 127.0.0.1, no cost.
//
//  - GET /models lists a few models with friendly names and prices, so the model picker looks like a real one.
//  - POST /chat/completions asks `reply` first; a string (or { text, holdAfter }) is streamed back in small pieces.
//    With holdAfter, the stream pauses after that many pieces until release() is called: a draft caught mid-stream.
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { startFake } from '../e2e/helpers'

export interface ChatRequest {
  model: string
  system: string
  /** Every message's text, joined (system first). */
  all: string
  messages: { role: string; content: unknown }[]
  body: Record<string, unknown>
}

export type Reply = string | { text: string; holdAfter?: number } | null

export interface DocsProvider {
  url: string
  /** Decides the reply to a chat request (null: let the test fake answer). Set and reset by the script per shot. */
  reply: (req: ChatRequest) => Reply
  /** Lets a held stream finish. */
  release(): void
  /** Every chat request's system prompt so far (first 200 characters), for working out markers. */
  seen: string[]
  close(): Promise<void>
}

/** Models as OpenRouter lists them: id, name, context length and prices per token. */
export const DOCS_MODELS = [
  { id: 'deepseek/deepseek-chat-v3.1', name: 'DeepSeek: DeepSeek V3.1', context_length: 163840, pricing: { prompt: '0.0000002', completion: '0.0000008' } },
  { id: 'anthropic/claude-sonnet-4.5', name: 'Anthropic: Claude Sonnet 4.5', context_length: 1000000, pricing: { prompt: '0.000003', completion: '0.000015' } },
  { id: 'google/gemini-2.5-flash', name: 'Google: Gemini 2.5 Flash', context_length: 1048576, pricing: { prompt: '0.0000003', completion: '0.0000025' } },
  { id: 'openai/gpt-5-mini', name: 'OpenAI: GPT-5 Mini', context_length: 400000, pricing: { prompt: '0.00000025', completion: '0.000002' } },
  { id: 'moonshotai/kimi-k2', name: 'MoonshotAI: Kimi K2', context_length: 131072, pricing: { prompt: '0.00000038', completion: '0.00000152' } },
  { id: 'mistralai/mistral-small-3.2-24b-instruct', name: 'Mistral: Mistral Small 3.2 24B', context_length: 131072, pricing: { prompt: '0.00000005', completion: '0.0000001' } },
  { id: 'qwen/qwen3-235b-a22b-2507', name: 'Qwen: Qwen3 235B A22B Instruct 2507', context_length: 262144, pricing: { prompt: '0.00000008', completion: '0.00000055' } }
].map((m) => ({ ...m, top_provider: { context_length: m.context_length, max_completion_tokens: 16384 }, supported_parameters: ['temperature', 'top_p', 'max_tokens'] }))

const textOf = (content: unknown): string =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map((p) => (p && typeof (p as { text?: unknown }).text === 'string' ? (p as { text: string }).text : '')).join('')
      : String(content ?? '')

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    let data = ''
    req.setEncoding('utf8')
    req.on('data', (c) => (data += c))
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Starts the stand-in. With `port` (LM Studio's 1234 for the shots) it answers at http://localhost:<port>/v1 on both
 * 127.0.0.1 and ::1; when that port is taken, on any free port.
 */
export async function startDocsProvider(opts: { delayMs?: number; port?: number } = {}): Promise<DocsProvider> {
  const fake = await startFake({ delayMs: 2 })
  const upstream = new URL(fake.url)
  const delayMs = opts.delayMs ?? 12
  let releaseHold: (() => void) | null = null
  let held: Promise<void> | null = null

  const provider: DocsProvider = {
    url: '',
    reply: () => null,
    seen: [],
    release: () => {
      releaseHold?.()
      releaseHold = null
      held = null
    },
    close: async () => {
      provider.release()
      for (const sv of servers)
        await new Promise<void>((resolve) => {
          sv.closeAllConnections?.()
          sv.close(() => resolve())
        })
      await fake.close()
    }
  }

  /** Passes a request on to the test fake as it came (the model swapped for one the fake knows). */
  function forward(req: IncomingMessage, res: ServerResponse, path: string, body: string | null): void {
    const p = httpRequest(
      { host: upstream.hostname, port: upstream.port, method: req.method, path: `/v1${path}`, headers: { ...req.headers, host: upstream.host, 'content-length': body === null ? 0 : Buffer.byteLength(body) } },
      (up) => {
        res.writeHead(up.statusCode ?? 500, up.headers)
        up.pipe(res)
      }
    )
    p.on('error', (e) => {
      res.writeHead(502, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { message: String(e) } }))
    })
    p.end(body ?? undefined)
  }

  async function stream(res: ServerResponse, model: string, text: string, holdAfter: number | undefined, wantUsage: boolean): Promise<void> {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
    let closed = false
    res.on('close', () => (closed = true))
    const send = (obj: unknown) => {
      if (!closed) res.write(`data: ${typeof obj === 'string' ? obj : JSON.stringify(obj)}\n\n`)
    }
    const chunk = (delta: Record<string, unknown>, finish: string | null = null) => ({
      id: 'docs-1',
      object: 'chat.completion.chunk',
      model,
      choices: [{ index: 0, delta, finish_reason: finish }]
    })
    send(chunk({ role: 'assistant', content: '' }))
    const tokens = text.match(/\S+\s*|\s+/g) ?? []
    const parts: string[] = []
    for (let i = 0; i < tokens.length; i += 3) parts.push(tokens.slice(i, i + 3).join(''))
    for (let i = 0; i < parts.length; i++) {
      if (closed) return
      if (holdAfter !== undefined && i === holdAfter) {
        held = new Promise<void>((r) => (releaseHold = r))
        await held
      }
      send(chunk({ content: parts[i] }))
      if (delayMs) await sleep(delayMs)
    }
    send(chunk({}, 'stop'))
    const words = text.split(/\s+/).length
    if (wantUsage) send({ id: 'docs-1', object: 'chat.completion.chunk', model, choices: [], usage: { prompt_tokens: 4000, completion_tokens: Math.ceil(words * 1.3), total_tokens: 4000 + Math.ceil(words * 1.3) } })
    send('[DONE]')
    res.end()
  }

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<unknown> => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const path = url.pathname.replace(/^\/api\/v1/, '').replace(/^\/v1/, '')
    try {
      if (req.method === 'GET' && path === '/models') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        return res.end(JSON.stringify({ data: DOCS_MODELS }))
      }
      if (req.method === 'POST' && path === '/chat/completions') {
        const raw = await readBody(req)
        const body = JSON.parse(raw) as Record<string, unknown>
        const messages = (body.messages ?? []) as { role: string; content: unknown }[]
        const system = textOf(messages.find((m) => m.role === 'system')?.content)
        const all = messages.map((m) => textOf(m.content)).join('\n\n')
        const model = String(body.model ?? '')
        provider.seen.push(system.slice(0, 200))
        const r = body.stream ? provider.reply({ model, system, all, messages, body }) : null
        if (r !== null) {
          const { text, holdAfter } = typeof r === 'string' ? { text: r, holdAfter: undefined } : r
          const usage = !!(body.usage as { include?: boolean } | undefined)?.include || !!(body.stream_options as { include_usage?: boolean } | undefined)?.include_usage
          return stream(res, model, text, holdAfter, usage)
        }
        // The fake writes for the models it knows: any model of ours writes as its writer does.
        const known = DOCS_MODELS.some((m) => m.id === model)
        return forward(req, res, path, known ? JSON.stringify({ ...body, model: 'fake/writer' }) : raw)
      }
      return forward(req, res, path + url.search, null)
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { message: String(e) } }))
    }
  }
  const listen = (port: number, host: string): Promise<Server | null> =>
    new Promise((resolve) => {
      const sv = createServer((req, res) => void handler(req, res))
      sv.once('error', () => resolve(null))
      sv.listen(port, host, () => resolve(sv))
    })
  const servers: Server[] = []
  let first = opts.port ? await listen(opts.port, '127.0.0.1') : null
  if (first) {
    servers.push(first)
    const v6 = await listen(opts.port!, '::1')
    if (v6) servers.push(v6)
    provider.url = `http://localhost:${opts.port}/v1`
  } else {
    first = (await listen(0, '127.0.0.1'))!
    servers.push(first)
    provider.url = `http://127.0.0.1:${(first.address() as { port: number }).port}/v1`
  }
  return provider
}
