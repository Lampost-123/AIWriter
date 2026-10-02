// A fake local speech server for tests (milestone 4), standing in for the real one (Python, Breeze TTS 2
// and Parakeet or Whisper). No dependencies. It answers on 127.0.0.1 like the real server, with the
// same routes (mcreader-v2's speech server plus Holodeck's transcription route), and quickly:
//   engine.mjs     health, models, warm-up, unload, shutdown (the Speech engine part)
//   readAloud.mjs  voices and speaking (the Read aloud part)
//   dictation.mjs  transcription (the Dictation part)
// Each module exports `routes`: { 'METHOD /path': (req, body, state) => { status, headers?, body } }.
//   GET  /__requests   every request so far (method, path, body size), so tests can see what was asked
//
// Use from code:  const fake = await startFakeSpeech(); ... fake.url (http://127.0.0.1:<port>/v1) ... await fake.close()
// Or from a shell: node tests/fake-speech/server.mjs --port 8766

import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import { routes as engine } from './engine.mjs'
import { routes as readAloud } from './readAloud.mjs'
import { routes as dictation } from './dictation.mjs'

const ROUTES = { ...engine, ...readAloud, ...dictation }

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
  })
}

export async function startFakeSpeech(options = {}) {
  const state = { requests: [], options, loaded: new Set() }
  const server = createServer(async (req, res) => {
    const path = (req.url ?? '/').split('?')[0]
    const body = await readBody(req)
    state.requests.push({ method: req.method, path, bytes: body.length })
    if (req.method === 'GET' && path === '/__requests') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify(state.requests))
    }
    const route = ROUTES[`${req.method} ${path}`] ?? ROUTES[`${req.method} ${path.replace(/^\/v1/, '')}`]
    if (!route) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ detail: 'Not Found' }))
    }
    try {
      const out = await route(req, body, state)
      res.writeHead(out.status ?? 200, out.headers ?? { 'Content-Type': 'application/json' })
      res.end(typeof out.body === 'string' || Buffer.isBuffer(out.body) ? out.body : JSON.stringify(out.body ?? {}))
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ detail: String(e?.message ?? e) }))
    }
  })
  await new Promise((resolve) => server.listen(options.port ?? 0, '127.0.0.1', resolve))
  const port = server.address().port
  return {
    url: `http://127.0.0.1:${port}/v1`,
    port,
    requests: () => state.requests,
    close: () => new Promise((resolve) => server.close(() => resolve()))
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const at = process.argv.indexOf('--port')
  const fake = await startFakeSpeech({ port: at > 0 ? Number(process.argv[at + 1]) : 8766 })
  console.log(`Fake speech server on ${fake.url}`)
}
