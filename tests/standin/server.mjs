// The stand-in model: an OpenAI-compatible server for testing the app's AI work without a real provider, a key or
// any cost. Every chat request the app sends is saved to a folder, and the reply is whatever a stand-in (a Claude
// helper reading those files, or a test) writes back. It also keeps a log of how big each request was, so a run shows
// what the app really sends.
//
//   GET  /v1/models            one model, "standin/model", with a 128k context
//   GET  /v1/key               always accepted
//   POST /v1/chat/completions  saves the request to <dir>/inbox/<id>.json, waits for <dir>/outbox/<id>.json, and
//                              answers with it as one JSON reply (the app's client takes a reply that isn't streamed)
//
// A reply file is JSON: { "content": "text" } or { "tool_calls": [{ "name": "state_of", "arguments": { ... } }] },
// or both. { "error": "message" } answers with a 500. A request still unanswered after timeoutMs gets a 504.
//
// Every request is also logged to <dir>/log.jsonl: its id, what kind of job it looks like, the number of messages,
// the characters and estimated tokens in (about 4 characters a token), the tools offered and the reply's size.
//
// Use from code:  const s = await startStandin({ dir }); ... s.url ... await s.close()
// Or from a shell: node tests/standin/server.mjs --dir <folder> [--port 4646] [--timeout-ms 900000]

import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** About how many tokens a text is: 4 characters a token, as the app's own estimates use. */
export function estimateTokens(chars) {
  return Math.ceil(chars / 4)
}

/** The text of a message's content: a string, or a list of parts. */
function textOf(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map((p) => (p && typeof p.text === 'string' ? p.text : '')).join('')
  return ''
}

/** A short guess at what job a request is, from the start of its system prompt (for the log only). */
export function jobOf(messages) {
  const sys = messages.find((m) => m.role === 'system')
  const first = textOf(sys?.content ?? '').trim().split('\n')[0] ?? ''
  return first.slice(0, 80)
}

/** The request as the stand-in reads it: the parts that matter, without the client's settings noise. */
export function requestRecord(id, body) {
  const messages = Array.isArray(body.messages) ? body.messages : []
  const chars = messages.reduce((n, m) => n + textOf(m.content).length + JSON.stringify(m.tool_calls ?? '').length, 0)
  const tools = Array.isArray(body.tools) ? body.tools : []
  return {
    id,
    model: body.model,
    max_tokens: body.max_tokens ?? body.max_completion_tokens ?? null,
    job: jobOf(messages),
    estimated_tokens_in: estimateTokens(chars + JSON.stringify(tools).length),
    messages: messages.map((m) => ({
      role: m.role,
      ...(m.name ? { name: m.name } : {}),
      ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
      content: textOf(m.content),
      ...(m.tool_calls ? { tool_calls: m.tool_calls } : {})
    })),
    tools: tools.map((t) => ({ name: t.function?.name, description: t.function?.description, parameters: t.function?.parameters })),
    tool_choice: body.tool_choice ?? null,
    response_format: body.response_format ?? null
  }
}

/** The JSON reply the app's client reads, from a stand-in's reply file. */
export function replyBody(id, model, reply, tokensIn) {
  const calls = Array.isArray(reply.tool_calls) ? reply.tool_calls : []
  const content = typeof reply.content === 'string' ? reply.content : calls.length ? null : ''
  const message = {
    role: 'assistant',
    content,
    ...(calls.length
      ? {
          tool_calls: calls.map((c, i) => ({
            id: c.id ?? `call_${id}_${i}`,
            type: 'function',
            function: { name: c.name, arguments: typeof c.arguments === 'string' ? c.arguments : JSON.stringify(c.arguments ?? {}) }
          }))
        }
      : {})
  }
  const out = estimateTokens((content ?? '').length + JSON.stringify(message.tool_calls ?? '').length)
  return {
    id: `standin-${id}`,
    object: 'chat.completion',
    model,
    choices: [{ index: 0, message, finish_reason: calls.length ? 'tool_calls' : 'stop' }],
    usage: { prompt_tokens: tokensIn, completion_tokens: out, total_tokens: tokensIn + out }
  }
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

/**
 * Starts the stand-in. `dir` holds inbox/, outbox/ and log.jsonl. `answer`, when given, replies in place of the
 * outbox (for tests): it gets the request record and returns a reply object, or null to wait for the outbox.
 */
export async function startStandin({ dir, port = 0, timeoutMs = 15 * 60_000, pollMs = 200, answer = null } = {}) {
  if (!dir) throw new Error('startStandin needs a folder (dir).')
  const inbox = join(dir, 'inbox')
  const outbox = join(dir, 'outbox')
  mkdirSync(inbox, { recursive: true })
  mkdirSync(outbox, { recursive: true })
  const logPath = join(dir, 'log.jsonl')
  let next = 1
  const waiting = new Set()

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (req.method === 'GET' && url.pathname.endsWith('/models')) {
      return send(res, 200, { object: 'list', data: [{ id: 'standin/model', object: 'model', context_length: 128_000 }] })
    }
    if (req.method === 'GET' && url.pathname.endsWith('/key')) return send(res, 200, { data: { label: 'standin' } })
    if (req.method !== 'POST' || !url.pathname.endsWith('/chat/completions')) return send(res, 404, { error: { message: 'Not here' } })

    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', async () => {
      let body
      try {
        body = JSON.parse(raw)
      } catch {
        return send(res, 400, { error: { message: 'Not JSON' } })
      }
      const id = String(next++).padStart(5, '0')
      const record = requestRecord(id, body)
      const started = Date.now()
      // Written whole, then renamed, so a reader never sees half a file.
      writeFileSync(join(inbox, `${id}.json.part`), JSON.stringify(record, null, 2))
      renameSync(join(inbox, `${id}.json.part`), join(inbox, `${id}.json`))

      let reply = answer ? await answer(record) : null
      const replyPath = join(outbox, `${id}.json`)
      // A helper can take minutes to write a scene, longer than the app waits for a reply to start: the reply starts
      // now (as a streamed one would) and its words follow when they are written.
      let early = false
      if (!reply) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.flushHeaders()
        early = true
      }
      const finish = (status, out) => (early ? res.end(JSON.stringify(out)) : send(res, status, out))
      let aborted = false
      res.on('close', () => {
        if (!res.writableEnded) aborted = true
      })
      waiting.add(id)
      while (!reply && !aborted && Date.now() - started < timeoutMs) {
        if (existsSync(replyPath)) {
          try {
            reply = JSON.parse(readFileSync(replyPath, 'utf8'))
          } catch {
            // Still being written: try again.
          }
        }
        if (!reply) await new Promise((r) => setTimeout(r, pollMs))
      }
      waiting.delete(id)
      const entry = {
        id,
        at: new Date().toISOString(),
        job: record.job,
        messages: record.messages.length,
        estimated_tokens_in: record.estimated_tokens_in,
        tools: record.tools.length,
        max_tokens: record.max_tokens,
        ms: Date.now() - started
      }
      if (aborted) return appendFileSync(logPath, JSON.stringify({ ...entry, outcome: 'stopped by the app' }) + '\n')
      if (!reply) {
        appendFileSync(logPath, JSON.stringify({ ...entry, outcome: 'timed out' }) + '\n')
        return finish(504, { error: { message: 'The stand-in did not answer in time.' } })
      }
      if (reply.error) {
        appendFileSync(logPath, JSON.stringify({ ...entry, outcome: 'error' }) + '\n')
        return finish(500, { error: { message: String(reply.error) } })
      }
      const out = replyBody(id, body.model, reply, record.estimated_tokens_in)
      appendFileSync(logPath, JSON.stringify({ ...entry, outcome: 'answered', tokens_out: out.usage.completion_tokens, tool_calls: out.choices[0].message.tool_calls?.length ?? 0 }) + '\n')
      finish(200, out)
    })
  })

  await new Promise((r) => server.listen(port, '127.0.0.1', r))
  const { port: actual } = server.address()
  return {
    url: `http://127.0.0.1:${actual}/v1`,
    /** Ids of requests still waiting for a reply. */
    waiting: () => [...waiting],
    close: () => new Promise((r) => server.close(() => r()))
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const arg = (name) => {
    const i = process.argv.indexOf(name)
    return i > 0 ? process.argv[i + 1] : undefined
  }
  const dir = arg('--dir')
  if (!dir) {
    console.error('Usage: node tests/standin/server.mjs --dir <folder> [--port 4646] [--timeout-ms 900000]')
    process.exit(1)
  }
  const s = await startStandin({ dir, port: Number(arg('--port') ?? 4646), timeoutMs: Number(arg('--timeout-ms') ?? 900_000) })
  console.log(`Stand-in model at ${s.url} (requests in ${join(dir, 'inbox')}, replies in ${join(dir, 'outbox')})`)
}
