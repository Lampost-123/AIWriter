// The chat eval's file bridge: an OpenAI-compatible server that stands in for the model by handing every chat call to
// someone (a Claude session) through files, with tools. Built on the lab's bridge (branch lab/writer,
// tests/lab/bridge.mjs), which answers text only; this one answers {content, tool_calls}.
//
//   <dir>/pending/<seq>-ask.json   the whole request: messages, tools, tool_choice, sampling (written by the bridge)
//   <dir>/done/<seq>-ask.json      the reply, written by whoever stands in for the model:
//                                  {"content": "words for the writer (may be empty with tool calls)",
//                                   "tool_calls": [{"name": "read_scene", "arguments": {"scene": "..."}}]}
//                                  arguments may be an object or a JSON string; tool_calls may be left out.
//   <dir>/answered/                both files once answered (nothing is ever deleted)
//
// It waits (polling) up to timeoutMs for each reply, sending SSE comments meanwhile so the app's idle timer holds.
// Tokens are estimated from text (4 characters a token); the cost is $0. No model is called.

import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const BRIDGE_MODEL = 'claude-bridge'

const tokensOf = (text) => Math.max(1, Math.ceil(String(text ?? '').length / 4))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** What a request is, from the marker its system prompt starts with. */
export function jobOf(messages) {
  const sys = typeof messages?.[0]?.content === 'string' ? messages[0].content : ''
  return sys.startsWith('[AIWRITE-ASK v') ? 'ask' : 'other'
}

/** Reads a reply file: {content, tool_calls}. Throws with a plain message when it isn't one. */
export function readReply(raw) {
  const j = JSON.parse(raw)
  if (!j || typeof j !== 'object') throw new Error('The reply is not a JSON object.')
  const content = typeof j.content === 'string' ? j.content : ''
  const calls = Array.isArray(j.tool_calls) ? j.tool_calls : []
  const toolCalls = calls.map((c, i) => {
    const name = c?.name ?? c?.function?.name
    if (typeof name !== 'string' || !name) throw new Error(`tool_calls[${i}] has no name.`)
    const args = c.arguments ?? c?.function?.arguments ?? {}
    return { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) }
  })
  if (!content && !toolCalls.length) throw new Error('The reply has neither content nor tool_calls.')
  return { content, toolCalls }
}

/** Starts the bridge on a free port; `url` is the provider base URL (ends /v1). */
export async function startBridge({ dir, seqPrefix = '', pollMs = 500, timeoutMs = 60 * 60_000, log = () => {} }) {
  for (const sub of ['pending', 'done', 'answered']) mkdirSync(join(dir, sub), { recursive: true })
  let seq = 0
  let closed = false
  const sockets = new Set()

  const waitFor = async (name, res) => {
    const file = join(dir, 'done', `${name}.json`)
    const until = Date.now() + timeoutMs
    let lastPing = Date.now()
    while (!closed && Date.now() < until) {
      if (existsSync(file)) {
        const a = readFileSync(file, 'utf8')
        await sleep(200)
        const b = readFileSync(file, 'utf8')
        if (a === b) {
          try {
            return { reply: readReply(b) }
          } catch (e) {
            // A reply that can't be read: said in a file beside it, and waited for again once fixed.
            const why = join(dir, 'done', `${name}.error.txt`)
            const msg = `Could not read ${name}.json: ${e.message}\n`
            if (!existsSync(why) || readFileSync(why, 'utf8') !== msg) writeFileSync(why, msg)
          }
        }
      }
      if (Date.now() - lastPing > 10_000) {
        res.write(': waiting for the bridge\n\n')
        lastPing = Date.now()
      }
      await sleep(pollMs)
    }
    return null
  }

  const server = createServer(async (req, res) => {
    const url = req.url ?? ''
    if (req.method === 'GET' && /\/models\/?$/.test(url)) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ data: [{ id: BRIDGE_MODEL, name: 'Claude stand-in via bridge', context_length: 200000 }] }))
      return
    }
    if (req.method !== 'POST' || !/\/chat\/completions\/?$/.test(url)) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'Not on the bridge.' } }))
      return
    }
    let raw = ''
    for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw)
    const messages = body.messages ?? []
    const job = jobOf(messages)
    seq += 1
    const name = `${seqPrefix}${String(seq).padStart(4, '0')}-${job}`
    const request = {
      seq: name,
      reply_to: join(dir, 'done', `${name}.json`),
      reply_format: '{"content": "...", "tool_calls": [{"name": "...", "arguments": {...}}]}',
      model: body.model,
      temperature: body.temperature ?? null,
      top_p: body.top_p ?? null,
      max_tokens: body.max_tokens ?? body.max_completion_tokens ?? null,
      tool_choice: body.tool_choice ?? null,
      tools: body.tools ?? [],
      messages
    }
    writeFileSync(join(dir, 'pending', `${name}.json`), JSON.stringify(request, null, 2))
    log(`bridge: waiting for ${name}`)
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
    sockets.add(res)
    const got = await waitFor(name, res)
    sockets.delete(res)
    const send = (obj) => res.write(`data: ${typeof obj === 'string' ? obj : JSON.stringify(obj)}\n\n`)
    const chunk = (delta, finish = null) => ({ id: name, object: 'chat.completion.chunk', model: BRIDGE_MODEL, choices: [{ index: 0, delta, finish_reason: finish }] })
    if (!got) {
      send({ error: { message: closed ? 'The bridge closed.' : `No reply in ${Math.round(timeoutMs / 60_000)} minutes (${name}).` } })
      res.end()
      return
    }
    const { content, toolCalls } = got.reply
    for (const f of [`${name}.json`]) {
      try {
        renameSync(join(dir, 'pending', f), join(dir, 'answered', f.replace(/\.json$/, '.request.json')))
        renameSync(join(dir, 'done', f), join(dir, 'answered', f.replace(/\.json$/, '.reply.json')))
      } catch {
        /* left where it is */
      }
    }
    send(chunk({ role: 'assistant', content: '' }))
    if (content) send(chunk({ content }))
    toolCalls.forEach((c, i) => {
      send(chunk({ tool_calls: [{ index: i, id: `call_${name}_${i}`, type: 'function', function: { name: c.name, arguments: '' } }] }))
      send(chunk({ tool_calls: [{ index: i, function: { arguments: c.arguments } }] }))
    })
    send(chunk({}, toolCalls.length ? 'tool_calls' : 'stop'))
    const prompt = tokensOf(JSON.stringify(messages))
    const completion = tokensOf(content + toolCalls.map((c) => c.name + c.arguments).join(''))
    send({ id: name, object: 'chat.completion.chunk', model: BRIDGE_MODEL, choices: [], usage: { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion } })
    send('[DONE]')
    res.end()
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const port = server.address().port
  return {
    url: `http://127.0.0.1:${port}/v1`,
    close: async () => {
      closed = true
      for (const s of sockets) s.end()
      await new Promise((r) => server.close(() => r()))
    }
  }
}
