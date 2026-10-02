// A fake local speech server for tests (milestone 4), standing in for the real one (Python, Breeze TTS 2
// and Parakeet or Whisper). No dependencies. It answers on 127.0.0.1 like the real server, with the
// same routes (mcreader-v2's speech server plus Holodeck's transcription route), and quickly:
//   engine.mjs     health, models, warm-up, unload, the dictation model, shutdown (the Speech engine part)
//   readAloud.mjs  voices and speaking (the Read aloud part)
//   dictation.mjs  transcription (the Dictation part)
// Each module exports `routes`: { 'METHOD /path': (req, body, state) => { status, headers?, body, after? } }.
// A route that answers with after: 'close' stops the server once its reply is sent (shutdown).
//
// The routes, as the real server (speech-server/app/server.py) has them. AI Write's main process calls
// them through speechFetch, with the address in Settings (it ends in /v1):
//   GET  /v1/health                {ok, service: 'aiwrite-speech', version, device ('CUDA · <card>' or 'CPU'),
//                                   default, engines: [{id: 'breeze', name, ready, loaded, detail, voices}],
//                                   ready, dictation: {engine, loaded, models: [{id, name, ready, loaded, detail}]}}
//   GET  /v1/voices                [{id, name, engine, lang, gender, traits, recommended}]          (Read aloud)
//   GET  /v1/models                {object: 'list', data: [{id: 'breeze', object: 'model', name}]}
//   POST /v1/audio/speech          {input, voice, model, speed, instruct?, delivery?, voice_design?...} → a WAV (Read aloud)
//   POST /v1/audio/transcriptions  a WAV (the whole body) → {text}; 400 "No audio.", 413 too long      (Dictation)
//   GET  /v1/dictation             {engine, loaded, models}: the dictation model chosen and loaded
//   POST /v1/dictation             {engine: 'parakeet' | 'whisper' | 'none'} → loads it, lets the other go; as GET
//   POST /v1/warmup                {engines?: ['breeze']} → {ok, engines: {breeze: 'ready' | why not}}
//   POST /v1/unload                → {ok, unloaded: [...]}: gives the memory back; models load again when asked
//   POST /shutdown                 (application/json only) → {ok: true}, then the server stops
// /health, /voices, /warmup, /unload and /v1/shutdown answer too, as on the real server.
//   GET  /__requests   every request so far (method, path, body size, and whether it carried AI Write's header),
//                      so tests can see what was asked
//
// The real server only answers programs on this computer that mean to talk to it (speech-server/app/guard.py):
// the Host header must be localhost, 127.0.0.1 or ::1, and a request that changes something must carry
// AI Write's header (X-AIWrite: speech, which speechFetch sends) or a JSON or audio body; it answers 400 or 403
// otherwise. This fake does the same only with the option guard: true, so tests that call it directly needn't.
//
// Use from code:  const fake = await startFakeSpeech(); ... fake.url (http://127.0.0.1:<port>/v1) ... await fake.close()
// Or from a shell: node tests/fake-speech/server.mjs --port 8766
// The app's tests start it as AI Write's own server (AIWRITE_FAKE_SPEECH_RUN): then it reads what is downloaded
// from AI Write's speech folder (AIWRITE_SPEECH_HOME, AIWRITE_BREEZE_ROOT) and starts with the dictation model
// picked (AIWRITE_DICTATION), AIWRITE_FAKE_SPEECH_OPTIONS (JSON) adds options, and it stops when AI Write does
// (AIWRITE_PARENT_PID), as the real one does. The control file of the fake downloads (AIWRITE_FAKE_SPEECH_CONTROL,
// install.mjs), read as it starts, can say { "run": "broken" } (it stops at once, a module missing, as a real
// server with a broken environment does) or { "run": "slow" } (it takes a minute to answer).

import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import { routes as engine } from './engine.mjs'
import { routes as readAloud } from './readAloud.mjs'
import { routes as dictation } from './dictation.mjs'

const ROUTES = { ...engine, ...readAloud, ...dictation }

const LOOPBACK = ['localhost', '127.0.0.1', '::1']
// What a web page can send without asking first; any other body type needs its permission, which is never given.
const SIMPLE_TYPES = ['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain']

/** Why the real server would refuse this request (guard.py), or null. */
function refusal(req) {
  const host = String(req.headers.host ?? '').toLowerCase()
  const name = host.startsWith('[') ? host.slice(1, host.indexOf(']')) : host.split(':')[0]
  if (!LOOPBACK.includes(name)) return [400, 'This speech server only answers programs on this computer.']
  if (req.method === 'GET' || req.method === 'HEAD' || req.headers['x-aiwrite']) return null
  const type = String(req.headers['content-type'] ?? '')
    .split(';')[0]
    .trim()
    .toLowerCase()
  if (type && !SIMPLE_TYPES.includes(type)) return null
  return [403, 'This speech server only takes requests sent on purpose: as JSON or audio, or with AI Write’s header.']
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
  })
}

export async function startFakeSpeech(options = {}) {
  const state = { requests: [], options, loaded: new Set() }
  let closed = false
  const close = () =>
    new Promise((resolve) => {
      if (closed) return resolve()
      closed = true
      server.close(() => resolve())
      server.closeAllConnections?.()
    })
  const server = createServer(async (req, res) => {
    const path = (req.url ?? '/').split('?')[0]
    const body = await readBody(req)
    if (req.method === 'GET' && path === '/__requests') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify(state.requests))
    }
    state.requests.push({ method: req.method, path, bytes: body.length, ours: req.headers['x-aiwrite'] === 'speech' })
    const refused = options.guard ? refusal(req) : null
    if (refused) {
      res.writeHead(refused[0], { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ detail: refused[1] }))
    }
    const route = ROUTES[`${req.method} ${path}`] ?? ROUTES[`${req.method} ${path.replace(/^\/v1/, '')}`]
    if (!route) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ detail: 'Not Found' }))
    }
    try {
      const out = await route(req, body, state)
      res.writeHead(out.status ?? 200, out.headers ?? { 'Content-Type': 'application/json' })
      res.end(typeof out.body === 'string' || Buffer.isBuffer(out.body) ? out.body : JSON.stringify(out.body ?? {}), () => {
        if (out.after === 'close') void close().then(() => options.onClose?.())
      })
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
    close
  }
}

/** Is process `pid` still running? */
function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return e?.code === 'EPERM'
  }
}

/** Run from a shell, or by AI Write as its own server (AIWRITE_FAKE_SPEECH_RUN). */
async function main() {
  const at = process.argv.indexOf('--port')
  // Started by AI Write as its own server: what is downloaded is read from its speech folder, as the real server does.
  const env = process.env
  let options = {
    ...(env.AIWRITE_SPEECH_HOME ? { home: env.AIWRITE_SPEECH_HOME } : {}),
    ...(env.AIWRITE_BREEZE_ROOT ? { breezeRoot: env.AIWRITE_BREEZE_ROOT } : {}),
    ...(env.AIWRITE_DICTATION ? { dictationEngine: env.AIWRITE_DICTATION } : {})
  }
  try {
    options = { ...options, ...JSON.parse(env.AIWRITE_FAKE_SPEECH_OPTIONS || '{}') }
  } catch {
    /* the options above */
  }
  let run = ''
  try {
    run = JSON.parse(readFileSync(env.AIWRITE_FAKE_SPEECH_CONTROL || '', 'utf8')).run ?? ''
  } catch {
    /* no control file: it starts as usual */
  }
  if (run === 'broken') {
    console.error('Traceback (most recent call last):')
    console.error("ModuleNotFoundError: No module named 'uvicorn'")
    process.exit(1)
  }
  if (run === 'slow') await new Promise((r) => setTimeout(r, 60_000))
  const fake = await startFakeSpeech({ ...options, port: at > 0 ? Number(process.argv[at + 1]) : 8766, onClose: () => process.exit(0) })
  console.log(`Fake speech server on ${fake.url}`)
  const parent = Number(env.AIWRITE_PARENT_PID || 0)
  if (parent) {
    setInterval(() => {
      if (!alive(parent)) process.exit(0)
    }, 1000)
  }
}

// No top-level await, so tests can load this module either way (import or require).
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
