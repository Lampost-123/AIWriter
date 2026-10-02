// A tiny OpenAI-compatible server for tests. No dependencies.
//
//   GET  /v1/models            a few models with context_length and pricing (OpenRouter style); 401 for the key "bad"
//   GET  /v1/key               key check (401 for the key "bad")
//   POST /v1/chat/completions  streams deterministic prose in small chunks, usage at the end
//   GET  /__last               the last chat request (body and headers), so tests can see what the AI saw
//   GET  /__requests           how many chat requests each model has had
//
// Special model ids (the list also has fake/writer, 32k, and fake/8k, a small-context model that
// writes normally: a sensible briefing for a full-length scene must be shortened to fit it):
//   fake/credit           402 out of credit
//   fake/badkey            401 key not accepted
//   fake/ratelimit-once    429 (Retry-After: 1) on the first request, then a normal stream
//   fake/servererror-once  503 on the first request, then a normal stream
//   fake/drop              streams a little, then the connection is reset
//   fake/slow              a long, slow stream (for Stop tests)
//   fake/wait              holds its first words back for waitMs (as a thinking model does), then a normal stream
//   fake/refuse            finish_reason content_filter with no text
//   fake/think             <think> blocks and reasoning fields before the prose
//   fake/midstream-error   some text, then an error object in the stream
//   fake/no-stream-options 400 if the request has stream_options
//   fake/empty             finishes without any text
//   fake/missing           404 unknown model
//   fake/toolong           400 context length exceeded
//   fake/max-output        400 when max_tokens is over 1000 (a model with a small output limit)
//   fake/o3                like OpenAI's o-series: 400 for max_tokens (wants max_completion_tokens) and for temperature / top_p
//   fake/gpt5              like GPT-5: 400 for a temperature other than 1
//   fake/length            streams a little, then stops with finish_reason "length" (the reply limit was reached)
//   fake/credit-limit      402 "can only afford" when max_tokens is over 3000, else a normal stream
//   fake/memory-bad-json   memory keeper requests: a broken JSON reply the first time, then valid replies
//   fake/memory-junk       memory keeper requests: never valid JSON (the scene shows "Memory not updated")
//   fake/overthinker       thinks for 3000 tokens whatever it is asked: with a reply limit of 3000 or less it sends only
//                          thinking and stops with finish_reason "length"; with more, thinking then the reply
//   fake/must-think        400 "Reasoning is mandatory" when asked not to think (effort "none"), else a normal stream
//   fake/no-thinking-option 400 for any thinking setting (reasoning / reasoning_effort), else a normal stream
//   fake/content-parts     sends its reply as lists of content parts (with a thinking part that isn't text)
//   fake/finish-error-once stops with finish_reason "error" and no text on the first request, then a normal stream
//
// Memory keeper requests (any model) are recognised by the markers in their system prompt
// (src/main/keeper/prompts.ts) and answered with deterministic JSON instead of prose:
//   - "<Name> lost her|his|their <thing>."          a change for <Name>: "lost her <thing>" (marks: "<thing> lost")
//   - "<Name>'s eyes are|were <colour>."            a detail: eyes
//   - "<Name> learned|learns|discovered that <x>."  <Name> knows <x>
//   A <Name> the memory doesn't list yet is added as a new character first. Facts whose words
//   changed get "keep" (a sentence still much like their words), "update" (an edited sentence the
//   rules above still read) or "remove". Summary requests get a short summary of the text's opening.
//   A reply longer than max_tokens (at about 4 characters a token) is cut off there, with finish_reason "length".
//
// Use from code:  const fake = await startFakeProvider({ delayMs: 5 }); ... fake.url ... await fake.close()
// Or from a shell: node tests/fake-provider/server.mjs --port 4545 --delay 20

import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'

/** How long fake/overthinker thinks, in tokens. */
const OVERTHINK_TOKENS = 3000

export const FAKE_MODELS = [
  { id: 'fake/writer', name: 'Fake: Writer', context_length: 32000, pricing: { prompt: '0.000003', completion: '0.000015' } },
  { id: 'fake/small', name: 'Fake: Small context', context_length: 3000, pricing: { prompt: '0.0000005', completion: '0.0000015' } },
  { id: 'fake/8k', name: 'Fake: 8k context', context_length: 8000, pricing: { prompt: '0.0000005', completion: '0.0000015' } },
  { id: 'fake/free', name: 'Fake: Free', context_length: 8000, pricing: { prompt: '0', completion: '0' } },
  { id: 'fake/slow', name: 'Fake: Slow', context_length: 32000, pricing: { prompt: '0.000001', completion: '0.000002' } },
  { id: 'fake/think', name: 'Fake: Thinker', context_length: 64000, pricing: { prompt: '0.000001', completion: '0.000004' } },
  { id: 'fake/credit', name: 'Fake: Out of credit', context_length: 32000, pricing: { prompt: '0.000001', completion: '0.000001' } },
  { id: 'fake/ratelimit-once', name: 'Fake: Rate limited once', context_length: 32000, pricing: { prompt: '0.000001', completion: '0.000001' } },
  { id: 'fake/drop', name: 'Fake: Drops the connection', context_length: 32000, pricing: { prompt: '0.000001', completion: '0.000001' } }
]

const SENTENCES = [
  'The rain had not let up since noon, and the gutters of Lowtown ran black with it.',
  'Mara kept her hood low and her left sleeve pinned, the way she always did now.',
  'Somewhere above the tavern a shutter banged, loose on one hinge, steady as a drum.',
  'She counted the doors from the corner, the way her father had taught her to count exits.',
  'Inside, the fire smelled of wet pine and old tallow, and nobody looked up when she came in.',
  'Tobin was where he had promised to be, which was the first surprise of the evening.',
  '"You came," he said, as if he had laid money on the opposite.',
  '"I said I would." She did not sit. Sitting was a promise too.',
  'He turned his cup a slow quarter turn on the table and watched her over the rim.',
  'Outside, the bells of the Narrows began the hour, and then, close and deliberate, someone knocked at the door.'
]

/** Deterministic prose of about `words` words, in paragraphs. */
export function fakeProse(words) {
  const out = []
  let count = 0
  let i = 0
  let para = []
  while (count < words) {
    const s = SENTENCES[i % SENTENCES.length]
    para.push(s)
    count += s.split(/\s+/).length
    i++
    if (para.length === 3) {
      out.push(para.join(' '))
      para = []
    }
  }
  if (para.length) out.push(para.join(' '))
  return out.join('\n\n')
}

/** Splits text into small pieces of a few words each, like a real stream. */
function pieces(text, size = 3) {
  const tokens = text.match(/\S+\s*|\s+/g) ?? []
  const out = []
  for (let i = 0; i < tokens.length; i += size) out.push(tokens.slice(i, i + size).join(''))
  return out
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------- Memory keeper replies ----------

const READING_MARKER = '[AIWRITE-MEMORY-KEEPER v1]'
const SUMMARY_MARKER = '[AIWRITE-MEMORY-SUMMARY v1]'

const wordsOf = (s) => (s.toLowerCase().match(/[a-z0-9']+/g) ?? []).map((w) => w.replace(/'s$/, ''))
function likeness(a, b) {
  const wa = wordsOf(a)
  const wb = wordsOf(b)
  if (!wa.length || !wb.length) return 0
  const left = new Map()
  for (const w of wb) left.set(w, (left.get(w) ?? 0) + 1)
  let common = 0
  for (const w of wa) {
    const n = left.get(w) ?? 0
    if (n > 0) {
      common++
      left.set(w, n - 1)
    }
  }
  return (2 * common) / (wa.length + wb.length)
}
const sentencesOf = (p) => (p.match(/[^.!?]+[.!?]+["'’”]?|[^.!?]+$/g) ?? []).map((s) => s.trim()).filter(Boolean)

/** What the rules read in one sentence: { kind, name, ... } or null. */
function readSentence(s) {
  let m = s.match(/\b([A-Z][a-z]+) (?:lost|loses) (her|his|their) ([a-z][a-z ]*[a-z])/)
  if (m) return { kind: 'change', name: m[1], note: `lost ${m[2]} ${m[3]}`, fields: { marks: `${m[3]} lost` } }
  m = s.match(/\b([A-Z][a-z]+)'s eyes (?:are|were) ([a-z]+)/)
  if (m) return { kind: 'detail', name: m[1], field: 'eyes', value: m[2] }
  m = s.match(/\b([A-Z][a-z]+) (?:learns|learned|learnt|discovers|discovered) that ([^.!?]+)/)
  if (m) return { kind: 'knows', name: m[1], fact: m[2].trim() }
  return null
}

/** A deterministic reply to a memory keeper reading request (see the top of this file). */
export function fakeMemoryReply(user) {
  const lines = String(user).split('\n')
  const known = new Map()
  for (const l of lines) {
    const m = l.match(/^- (E\d+) [a-z]+ "([^"]+)"(?: \(also: ([^)]*)\))?/)
    if (!m) continue
    known.set(m[2].toLowerCase(), m[1])
    for (const a of (m[3] ?? '').split(',')) if (a.trim()) known.set(a.trim().toLowerCase(), m[1])
  }
  const sentences = lines.filter((l) => /^P\d+: /.test(l)).flatMap((l) => sentencesOf(l.replace(/^P\d+: /, '')))
  const add = []
  const refs = new Map()
  const ref = (name) => {
    const key = name.toLowerCase()
    if (known.has(key)) return known.get(key)
    if (refs.has(key)) return refs.get(key)
    const r = `N${refs.size + 1}`
    refs.set(key, r)
    add.push({ type: 'entry', ref: r, kind: 'character', name, summary: `Someone called ${name}.`, quote: name })
    return r
  }
  for (const s of sentences) {
    const r = readSentence(s)
    if (!r) continue
    const entry = ref(r.name)
    if (r.kind === 'change') add.push({ type: 'change', entry, note: r.note, fields: r.fields, quote: s })
    if (r.kind === 'detail') add.push({ type: 'detail', entry, field: r.field, value: r.value, quote: s })
    if (r.kind === 'knows') add.push({ type: 'knows', entry, fact: r.fact, quote: s })
  }
  const facts = []
  for (const l of lines) {
    const m = l.match(/^- (F\d+) .* \| words, no longer in the scene: "(.*)"$/)
    if (!m) continue
    let best = null
    for (const s of sentences) {
      const score = likeness(m[2], s)
      if (!best || score > best.score) best = { s, score }
    }
    const read = best && best.score >= 0.5 ? readSentence(best.s) : null
    if (read && best.score < 0.95) {
      const value = read.kind === 'change' ? { note: read.note, fields: read.fields } : read.kind === 'detail' ? { value: read.value } : { fact: read.fact }
      facts.push({ id: m[1], do: 'update', quote: best.s, ...value })
    } else if (best && best.score >= 0.8) facts.push({ id: m[1], do: 'keep', quote: best.s })
    else facts.push({ id: m[1], do: 'remove' })
  }
  return JSON.stringify({ facts, add, clashes: [] }, null, 1)
}

/** A deterministic summary: the opening words of the text it was given. */
export function fakeSummary(user) {
  const text = String(user)
    .split('\n\n')
    .slice(1)
    .filter((p) => !/^Scene: /.test(p))
    .join(' ')
  const words = text.split(/\s+/).filter(Boolean).slice(0, 40).join(' ')
  return `This part of the story begins: ${words.replace(/[.,;:!?"']+$/, '')}.`
}

export async function startFakeProvider(options = {}) {
  const opts = { port: 0, delayMs: 10, words: 120, slowWords: 1500, slowDelayMs: 40, waitMs: 1500, crlf: false, ...options }
  let last = null
  const counts = {}
  const memoryCounts = {}

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const path = url.pathname.replace(/^\/v1/, '').replace(/^\/api\/v1/, '')
    try {
      if (req.method === 'GET' && path === '/__last') return json(res, 200, last)
      if (req.method === 'GET' && path === '/__requests') return json(res, 200, counts)
      if (req.method === 'GET' && path === '/models') {
        // Like OpenAI's, the list turns away a key it doesn't know.
        if ((req.headers.authorization ?? '') === 'Bearer bad') return json(res, 401, { error: { code: 401, message: 'Incorrect API key provided' } })
        return json(res, 200, { data: FAKE_MODELS })
      }
      if (req.method === 'GET' && (path === '/key' || path === '/auth/key')) {
        if ((req.headers.authorization ?? '') === 'Bearer bad') return json(res, 401, { error: { code: 401, message: 'No auth credentials found' } })
        return json(res, 200, { data: { label: 'fake', usage: 0, limit: 10, limit_remaining: 9.5 } })
      }
      if (req.method === 'POST' && path === '/chat/completions') {
        const body = JSON.parse(await readBody(req))
        last = { body, headers: req.headers }
        const model = String(body.model ?? '')
        counts[model] = (counts[model] ?? 0) + 1
        return chat(req, res, body, model, counts[model])
      }
      json(res, 404, { error: { message: `No route for ${req.method} ${url.pathname}` } })
    } catch (e) {
      json(res, 500, { error: { message: String(e) } })
    }
  })

  async function chat(req, res, body, model, n) {
    if ((req.headers.authorization ?? '') === 'Bearer bad' || model === 'fake/badkey') {
      return json(res, 401, { error: { code: 401, message: 'Invalid API key' } })
    }
    if (model === 'fake/credit') return json(res, 402, { error: { code: 402, message: 'Insufficient credits. Add more using https://openrouter.ai/credits' } })
    if (model === 'fake/missing') return json(res, 404, { error: { code: 404, message: `No endpoints found for model ${model}` } })
    if (model === 'fake/toolong') return json(res, 400, { error: { code: 400, message: "This endpoint's maximum context length is 3000 tokens. However, you requested about 9000 tokens." } })
    if (model === 'fake/o3' && 'max_tokens' in body) {
      return json(res, 400, {
        error: { message: "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.", type: 'invalid_request_error', param: 'max_tokens', code: 'unsupported_parameter' }
      })
    }
    if (model === 'fake/o3' && ('temperature' in body || 'top_p' in body)) {
      const param = 'temperature' in body ? 'temperature' : 'top_p'
      return json(res, 400, { error: { message: `Unsupported parameter: '${param}' is not supported with this model.`, type: 'invalid_request_error', param, code: 'unsupported_parameter' } })
    }
    if (model === 'fake/gpt5' && 'temperature' in body && body.temperature !== 1) {
      return json(res, 400, {
        error: { message: `Unsupported value: 'temperature' does not support ${body.temperature} with this model. Only the default (1) value is supported.`, type: 'invalid_request_error', param: 'temperature', code: 'unsupported_value' }
      })
    }
    if (model === 'fake/credit-limit' && (body.max_tokens ?? 0) > 3000) {
      return json(res, 402, { error: { code: 402, message: `This request requires more credits, or fewer max_tokens. You requested up to ${body.max_tokens} tokens, but can only afford 3000.` } })
    }
    if (model === 'fake/max-output' && (body.max_tokens ?? 0) > 1000) {
      return json(res, 400, { error: { code: 400, message: `max_tokens: ${body.max_tokens} > 1000, which is the maximum allowed number of output tokens for ${model}` } })
    }
    if (model === 'fake/ratelimit-once' && n === 1) {
      res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '1' })
      return res.end(JSON.stringify({ error: { code: 429, message: 'Rate limit exceeded' } }))
    }
    if (model === 'fake/servererror-once' && n === 1) return json(res, 503, { error: { code: 503, message: 'Service unavailable' } })
    if (model === 'fake/no-stream-options' && body.stream_options) {
      return json(res, 400, { error: { message: 'Unrecognized request argument supplied: stream_options' } })
    }
    // How much thinking was asked for: OpenRouter's reasoning.effort, or OpenAI's reasoning_effort.
    const effort = body.reasoning?.effort ?? body.reasoning_effort ?? null
    if (model === 'fake/must-think' && effort === 'none') {
      return json(res, 400, { error: { code: 400, message: 'Reasoning is mandatory for this endpoint and cannot be disabled.' } })
    }
    if (model === 'fake/no-thinking-option' && effort != null) {
      return json(res, 400, { error: { message: `Unrecognized request argument supplied: ${'reasoning' in body ? 'reasoning' : 'reasoning_effort'}` } })
    }

    const limit = body.max_tokens ?? body.max_completion_tokens ?? 400
    const words = model === 'fake/slow' ? opts.slowWords : Math.min(opts.words, Math.max(10, Math.floor(limit / 2)))
    const messages = body.messages ?? []
    const system = String(messages.find((m) => m.role === 'system')?.content ?? '')
    const firstUser = String(messages.find((m) => m.role === 'user')?.content ?? '')
    let memory = null
    if (system.includes(READING_MARKER)) {
      memoryCounts[model] = (memoryCounts[model] ?? 0) + 1
      const broken = model === 'fake/memory-junk' || (model === 'fake/memory-bad-json' && memoryCounts[model] === 1)
      memory = broken ? 'Here you go: {"facts": [ {"id": ' : fakeMemoryReply(firstUser)
    } else if (system.includes(SUMMARY_MARKER)) memory = fakeSummary(firstUser)
    else if (system.includes('[AIWRITE-STORY-FLOW')) memory = fakeStoryFlowReply(system, firstUser)
    memory ??= fakeBuilderReply(system, messages, model)
    const full = memory ?? (model === 'fake/empty' || model === 'fake/refuse' ? '' : fakeProse(words))
    // A memory reply longer than the reply limit (about 4 characters a token) is cut off there, as a real model's would be.
    const cut = memory !== null && memory.length > limit * 4
    // A reply that runs into the limit stops mid-sentence.
    const prose = cut ? memory.slice(0, limit * 4) : model === 'fake/length' ? full.slice(0, Math.floor(full.length * 0.7)).replace(/\s+\S*$/, '') : full
    const promptChars = JSON.stringify(body.messages ?? []).length
    const usage = { prompt_tokens: Math.ceil(promptChars / 4), completion_tokens: Math.ceil(words * 1.3) }
    usage.total_tokens = usage.prompt_tokens + usage.completion_tokens
    if (body.usage?.include) usage.cost = Number((usage.prompt_tokens * 0.000003 + usage.completion_tokens * 0.000015).toFixed(6))

    if (!body.stream) {
      return json(res, 200, {
        id: 'fake-1',
        object: 'chat.completion',
        model,
        choices: [{ index: 0, message: { role: 'assistant', content: prose.split(/\s+/)[0] ?? '' }, finish_reason: 'length' }],
        usage
      })
    }

    const nl = opts.crlf || model === 'fake/crlf' ? '\r\n' : '\n'
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
    let closed = false
    req.on('close', () => (closed = true))
    res.on('close', () => (closed = true))
    const send = (obj) => {
      if (!closed) res.write(`data: ${typeof obj === 'string' ? obj : JSON.stringify(obj)}${nl}${nl}`)
    }
    const chunk = (delta, finish = null) => ({ id: 'fake-1', object: 'chat.completion.chunk', model, choices: [{ index: 0, delta, finish_reason: finish }] })

    res.write(`: FAKE PROCESSING${nl}${nl}`)
    send(chunk({ role: 'assistant', content: '' }))
    if (model === 'fake/think') {
      send(chunk({ reasoning: 'Planning the scene: rain, the tavern, Tobin...' }))
      send(chunk({ reasoning_content: 'More private thoughts.' }))
      for (const p of pieces('<think>I should open with the rain and keep it tense.</think>\n\n', 2)) send(chunk({ content: p }))
    }
    if (model === 'fake/overthinker') {
      send(chunk({ reasoning: 'Thinking it all through, at length...' }))
      if (limit <= OVERTHINK_TOKENS) {
        // All the room went on thinking: nothing visible, stopped at the limit (and still billed).
        send(chunk({}, 'length'))
        const spent = { prompt_tokens: usage.prompt_tokens, completion_tokens: limit, total_tokens: usage.prompt_tokens + limit }
        if (body.usage?.include) spent.cost = Number((spent.prompt_tokens * 0.000003 + limit * 0.000015).toFixed(6))
        if (body.usage?.include || body.stream_options?.include_usage) send({ id: 'fake-1', object: 'chat.completion.chunk', model, choices: [], usage: spent })
        send('[DONE]')
        return res.end()
      }
    }
    if (model === 'fake/finish-error-once' && n === 1) {
      send(chunk({}, 'error'))
      send('[DONE]')
      return res.end()
    }
    if (model === 'fake/refuse') {
      send(chunk({}, 'content_filter'))
      send('[DONE]')
      return res.end()
    }
    const delay = model === 'fake/slow' ? opts.slowDelayMs : opts.delayMs
    if (model === 'fake/wait') await sleep(opts.waitMs)
    const parts = pieces(prose)
    for (let i = 0; i < parts.length; i++) {
      if (closed) return
      if (model === 'fake/drop' && i === Math.floor(parts.length / 2)) {
        res.socket?.destroy()
        return
      }
      if (model === 'fake/midstream-error' && i === Math.floor(parts.length / 2)) {
        send({ id: 'fake-1', object: 'chat.completion.chunk', error: { code: 502, message: 'Upstream provider went away' }, choices: [{ index: 0, delta: { content: '' }, finish_reason: 'error' }] })
        send('[DONE]')
        return res.end()
      }
      if (model === 'fake/content-parts') {
        send(chunk({ content: [{ type: 'reasoning', text: 'A private thought. ' }, { type: 'text', text: parts[i] }] }))
      } else send(chunk({ content: parts[i] }))
      if (i % 7 === 3) res.write(`: keep-alive${nl}${nl}`)
      if (delay) await sleep(delay)
    }
    send(chunk({}, model === 'fake/length' || cut ? 'length' : 'stop'))
    if (body.usage?.include || body.stream_options?.include_usage) send({ id: 'fake-1', object: 'chat.completion.chunk', model, choices: [], usage })
    send('[DONE]')
    res.end()
  }

  await new Promise((resolve) => server.listen(opts.port, '127.0.0.1', resolve))
  const port = server.address().port
  return {
    port,
    /** Base URL to give AI Write, e.g. http://127.0.0.1:4545/v1 */
    url: `http://127.0.0.1:${port}/v1`,
    lastRequest: () => last,
    requestCounts: () => ({ ...counts }),
    reset: () => {
      last = null
      for (const k of Object.keys(counts)) delete counts[k]
      for (const k of Object.keys(memoryCounts)) delete memoryCounts[k]
    },
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.()
        server.close(() => resolve())
      })
  }
}

function json(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(obj))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.setEncoding('utf8')
    req.on('data', (c) => (data += c))
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

// CLI: node tests/fake-provider/server.mjs [--port 4545] [--delay 10] [--words 120]
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const arg = (name, fallback) => {
    const i = process.argv.indexOf(`--${name}`)
    return i > 0 ? Number(process.argv[i + 1]) : fallback
  }
  const fake = await startFakeProvider({ port: arg('port', 4545), delayMs: arg('delay', 10), words: arg('words', 120) })
  console.log(`Fake provider listening at ${fake.url}`)
}

/**
 * A deterministic reply to a story flow request (src/main/storyFlows/prompts.ts), chosen by the flow
 * named after the marker. "[[fake: empty]]" in the request gives an empty reply, "[[fake: broken]]" one
 * that can't be read.
 * - time-gap: after 50 years or more (or centuries, generations, ages) the first character "died long
 *   ago", the first place "fell into ruin" (now home to nobody but crows) and the first open plot
 *   thread is left unanswered; after less, nothing changed.
 * - starting-cast: a younger or earlier description for each entry under "Cast to draft". With
 *   "[[fake: related]]" in the request, the first character's names the first place ("works at"), one
 *   way only.
 * - when: a change whose entry a scene of the new story names happens in that scene; the first other
 *   change happened before the new story; the rest after it.
 */
export function fakeStoryFlowReply(system, user) {
  const text = String(user)
  if (text.includes('[[fake: empty]]')) return ''
  if (text.includes('[[fake: broken]]')) return 'Here is what changed: {"changes": [ {"entry": '
  const flow = (String(system).match(/\[AIWRITE-STORY-FLOW v\d+\] ([a-z-]+)/) ?? [])[1]
  const sections = new Map()
  for (const part of text.split(/\n(?=## )/)) {
    const head = part.split('\n')[0].replace(/^## /, '')
    sections.set(head, part.split('\n').slice(1))
  }
  const section = (start) => [...sections].find(([head]) => head.startsWith(start))?.[1] ?? []
  const entries = (lines) =>
    lines.flatMap((l) => {
      const m = l.match(/^- (E\d+) ([a-z]+) "([^"]+)"/)
      return m ? [{ id: m[1], kind: m[2], name: m[3] }] : []
    })

  if (flow === 'time-gap') {
    const gap = (text.match(/^Time since the story before it: (.*)$/m) ?? [])[1] ?? ''
    const years = Number((gap.match(/(\d[\d,]*)\s*(years?|decades?|centur)/i) ?? [])[1]?.replace(/,/g, '') ?? 0)
    const long = years >= 50 || /centur|generation|\bages?\b|decades/i.test(gap)
    if (!long) return JSON.stringify({ changes: [], closed: [] })
    const cast = entries(section('Characters, places, groups and items'))
    const changes = []
    const person = cast.find((e) => e.kind === 'character')
    if (person) changes.push({ type: 'change', entry: person.id, note: 'died long ago' })
    const place = cast.find((e) => e.kind === 'place')
    if (place) changes.push({ type: 'change', entry: place.id, note: 'fell into ruin', fields: { people: 'Nobody now but crows' } })
    const thread = section('Open plot threads')
      .map((l) => (l.match(/^- (E\d+) /) ?? [])[1])
      .find(Boolean)
    return JSON.stringify({ changes, closed: thread ? [thread] : [] }, null, 1)
  }

  if (flow === 'starting-cast') {
    const younger = {
      character: (n) => `${n} is young here, years before the book: untested, hopeful, and not yet who the book shows.`,
      place: (n) => `${n} as it was years earlier: newer, busier, and not yet changed by what the book tells.`,
      group: (n) => `${n} years earlier: smaller, with other leaders, and not yet what it becomes.`,
      item: (n) => `${n} years earlier, before it came to the hands the book finds it in.`
    }
    const drafting = entries(section('Cast to draft'))
    const workplace = text.includes('[[fake: related]]') ? drafting.find((e) => e.kind === 'place') : null
    const worker = workplace ? drafting.find((e) => e.kind === 'character') : null
    const cast = drafting.map((e) => ({
      entry: e.id,
      summary: `${e.name}, years before the book`,
      description: (younger[e.kind] ?? younger.item)(e.name),
      fields: {},
      relationships: e === worker ? [{ other: workplace.id, rel: 'works at', feels: 'proud of it', otherFeels: '' }] : [],
      knows: []
    }))
    return JSON.stringify({ cast }, null, 1)
  }

  if (flow === 'when') {
    const changes = section('The later story')
      .map((l) => l.match(/^- (C\d+) (.+?) \(([a-z]+)\): /))
      .filter(Boolean)
    const scenes = section('Scenes of')
      .map((l) => l.match(/^- (S\d+) (.*)$/))
      .filter(Boolean)
    let before = false
    const sorted = changes.map(([, id, name]) => {
      const scene = scenes.find(([, , words]) => words.toLowerCase().includes(name.toLowerCase()))
      if (scene) return { change: id, when: 'in', scene: scene[1] }
      if (!before) {
        before = true
        return { change: id, when: 'before' }
      }
      return { change: id, when: 'after' }
    })
    return JSON.stringify({ changes: sorted }, null, 1)
  }
  return JSON.stringify({})
}

// ---------- Builder replies ----------
// Builder requests (src/main/builder/prompts.ts) start their system prompt with "[AIWRITE-BUILDER v1] <job>".
//   quick-start  The notes' first words before " runs", " is", " was" or a comma are the name (else "Corvin
//                Ashe"). The notes' lines are copied word for word under "fromNotes", in order, into:
//                character: summary, traits, marks, secrets; place: summary, atmosphere, history;
//                group: summary, goals, history; item: summary, powers, origin. Every other field the
//                prompt lists is under "drafted", as "<Label> of <name>, drafted to fit the world."
//                Fields listed as saved already (finishing a profile) are left out.
//   flesh-out    "Suggested <label> for <name>." for each empty field it is asked about.
//   options      Three options: "<Label>, first option: ...", "second", "third".
//   interview    "You want to know about <what was asked about>? I'll say this once: I keep my own counsel,
//                and I pay my debts." The model fake/empty sends back nothing for any of these.
export function fakeBuilderReply(system, messages, model = '') {
  const job = String(system).match(/^\[AIWRITE-BUILDER v1\] ([a-z-]+)/)?.[1]
  if (!job) return null
  if (model === 'fake/empty') return ''
  const users = (messages ?? []).filter((m) => m.role === 'user').map((m) => String(m.content ?? ''))
  const user = users[users.length - 1] ?? ''
  const fields = [...String(system).matchAll(/^- ([A-Za-z]+): ([^(\n]+?)(?: \(|$)/gm)].map((m) => ({ key: m[1], label: m[2].trim() }))
  const nameIn = (text) => text.match(/^Name: (.+)$/m)?.[1]?.trim() ?? 'them'
  if (job === 'quick-start') {
    const kind = String(system).match(/build the (\w+)s of a novel/)?.[1] ?? 'character'
    const notes = (user.match(/"""\n([\s\S]*?)\n"""/)?.[1] ?? '').split('\n').map((l) => l.trim()).filter(Boolean)
    const named = notes[0]?.match(/^([A-Z][\w'’-]*(?: [A-Z][\w'’-]*)?)(?:,| (?:runs|is|was|has)\b)/)?.[1]
    const name = named ?? 'Corvin Ashe'
    const SLOTS = {
      character: ['summary', 'traits', 'marks', 'secrets'],
      place: ['summary', 'atmosphere', 'history'],
      group: ['summary', 'goals', 'history'],
      item: ['summary', 'powers', 'origin']
    }
    const slots = SLOTS[kind] ?? ['summary']
    // Finishing a profile: the fields saved already are listed by label after the notes.
    const saved = new Set([...(user.split('These fields are saved already')[1] ?? '').matchAll(/^([^:\n]+): /gm)].map((m) => m[1].trim()))
    const keep = (key) => !saved.has(fields.find((f) => f.key === key)?.label ?? key)
    const fromNotes = named && keep('name') ? { name } : {}
    notes.forEach((line, i) => {
      if (slots[i] && keep(slots[i])) fromNotes[slots[i]] = line
    })
    const drafted = named || !keep('name') ? {} : { name }
    for (const f of fields) {
      if (f.key in fromNotes || f.key in drafted || !keep(f.key)) continue
      if (f.key === 'aliases') drafted.aliases = `Old ${name.split(' ')[0]}`
      else if (f.key === 'sampleLines') drafted.sampleLines = '"Pay first, then we talk."\n"The river doesn\'t wait, and neither do I."'
      else if (f.key === 'role') drafted.role = 'supporting'
      else drafted[f.key] = `${f.label} of ${name}, drafted to fit the world.`
    }
    return JSON.stringify({ fromNotes, drafted }, null, 1)
  }
  if (job === 'flesh-out') {
    const name = nameIn(user)
    const wanted = [...(user.split('Empty fields to fill in')[1] ?? '').matchAll(/^- ([A-Za-z]+): ([^(\n]+?)(?: \(|$)/gm)]
    return JSON.stringify(Object.fromEntries(wanted.map((m) => [m[1], `Suggested ${m[2].trim().toLowerCase()} for ${name}.`])), null, 1)
  }
  if (job === 'options') {
    const label = user.match(/^The field: ([^(\n]+?)(?: \(|$)/m)?.[1]?.trim() ?? 'This'
    const options = ['first', 'second', 'third'].map((n) => `${label}, ${n} option: something only ${nameIn(user)} would have.`)
    return JSON.stringify({ options })
  }
  if (job === 'interview') {
    const about = user.replace(/^\s*what do you (?:think|make) (?:of|about)\s+/i, '').replace(/[?.!\s]+$/, '') || 'that'
    return `You want to know about ${about}? I'll say this once: I keep my own counsel, and I pay my debts.`
  }
  return null
}
