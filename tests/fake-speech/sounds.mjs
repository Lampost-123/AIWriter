// The fake speech server's sound effects and word timing (the Speech engine part), answering like the real server's
// (speech-server/app/server.py):
//   POST /v1/sounds/generate  {prompt, kind: 'effect' | 'ambience', seconds?, takes?, seed?} → a quiet 44.1 kHz stereo
//                             16-bit WAV of the length asked for (clamped as the real one clamps it: an effect 1 to 10 s,
//                             3 by default; ambience 10 to 30 s, 20 by default), straight away and the same every time
//                             for the same request. Headers x-sound-score and x-sound-seconds, cache-control no-store.
//                             400 for no description, one over 300 characters, or another kind; 503 when the sound
//                             effects aren't downloaded there (or soundsFail says so); 503 with x-sound-retry: 1 while
//                             soundsBusy is set (the voices had the graphics card).
//   POST /v1/align            a spoken clip (WAV) → {words: [{word, start, end}], engine}. A clip this server spoke
//                             (POST /v1/audio/speech) has the words it was asked to say, spread evenly over the clip; any
//                             other gets the option alignWords (a string) spread the same way, else no words. 400 "No
//                             audio.", 413 over 8 MB, 503 "no-aligner" when there is no aligner (the option aligner: null,
//                             or no dictation model downloaded).
//   GET  /__sounds            every sound asked for so far (the request's body), so tests can see what was made
//
// Options (read on every request): sounds (downloaded there; default true, or what AI Write's speech folder holds),
// soundsLoadError, soundsBusy, soundsFail ({status, detail}), soundsDelayMs, beside (default true), aligner
// ('whisper' | 'parakeet' | null; default: the first dictation model downloaded, Whisper first), alignWords.
import { createHash } from 'node:crypto'
import { readWav } from './dictation.mjs'
import { alignerOf, ready } from './engine.mjs'

const RATE = 44100
const SECONDS = { effect: [1, 10, 3], ambience: [10, 30, 20] }

const json = (body, status = 200, headers = undefined) => ({
  status,
  headers: { 'Content-Type': 'application/json', ...(headers ?? {}) },
  body
})

function parse(body) {
  try {
    return body.length ? JSON.parse(body.toString('utf8')) : {}
  } catch {
    return null
  }
}

function clamp(kind, seconds) {
  const [low, high, fallback] = SECONDS[kind]
  const n = Number(seconds)
  if (seconds === null || seconds === undefined || !Number.isFinite(n)) return fallback
  return Math.round(Math.min(high, Math.max(low, n)) * 100) / 100
}

/** A quiet stereo WAV: a low hum whose pitch comes from the request, so the same request makes the same sound. */
function hum(seconds, seed) {
  const frames = Math.round(RATE * seconds)
  const data = frames * 4
  const wav = Buffer.alloc(44 + data)
  wav.write('RIFF', 0)
  wav.writeUInt32LE(36 + data, 4)
  wav.write('WAVE', 8)
  wav.write('fmt ', 12)
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(2, 22)
  wav.writeUInt32LE(RATE, 24)
  wav.writeUInt32LE(RATE * 4, 28)
  wav.writeUInt16LE(4, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36)
  wav.writeUInt32LE(data, 40)
  const pitch = 110 + (seed % 220)
  for (let i = 0; i < frames; i++) {
    const v = Math.round(Math.sin((2 * Math.PI * pitch * i) / RATE) * 300)
    wav.writeInt16LE(v, 44 + i * 4)
    wav.writeInt16LE(v, 46 + i * 4)
  }
  return wav
}

const hash = (buf) => createHash('sha1').update(buf).digest('hex')

/** Called by the speaking route (readAloud.mjs) with each clip it makes, so /v1/align knows what it says. */
export function rememberSpoken(state, wav, text) {
  state.spokenClips ??= new Map()
  state.spokenClips.set(hash(wav), String(text))
}

const generate = async (_req, body, state) => {
  const options = state.options ?? {}
  const asked = parse(body)
  if (!asked || typeof asked !== 'object') return json({ detail: 'Body is not JSON' }, 422)
  state.sounds ??= []
  state.sounds.push(asked)
  const prompt = String(asked.prompt ?? '').trim()
  if (!prompt) return json({ detail: 'Say what the sound is.' }, 400)
  if (prompt.length > 300) return json({ detail: `That description is ${prompt.length} characters; keep it to 300 or fewer.` }, 400)
  const kind = String(asked.kind ?? 'effect').toLowerCase()
  if (!(kind in SECONDS)) return json({ detail: 'A sound is an effect or ambience.' }, 400)
  if (!ready(state, 'sounds'))
    return json({ detail: 'Not downloaded yet. Download the sound effects in AI Write’s Settings, Read aloud and dictation.' }, 503)
  if (options.soundsLoadError) return json({ detail: `Stable Audio Open could not start: ${options.soundsLoadError}` }, 503)
  if (options.soundsDelayMs) await new Promise((r) => setTimeout(r, options.soundsDelayMs))
  if (options.soundsBusy)
    return json({ detail: 'Breeze TTS 2 is reading aloud now. The sound is made once it has finished.' }, 503, { 'x-sound-retry': '1' })
  if (options.soundsFail) {
    return json({ detail: options.soundsFail.detail ?? 'The sound couldn’t be made.' }, options.soundsFail.status ?? 503)
  }
  state.loaded ??= new Set()
  state.loaded.add('sounds')
  const seconds = clamp(kind, asked.seconds)
  const given = asked.seed !== null && asked.seed !== undefined && Number.isFinite(Number(asked.seed))
  const seed = given ? Number(asked.seed) : parseInt(hash(Buffer.from(prompt)).slice(0, 6), 16)
  return {
    headers: {
      'Content-Type': 'audio/wav',
      'x-sound-score': '0.2500',
      'x-sound-seconds': seconds.toFixed(3),
      'cache-control': 'no-store'
    },
    body: hum(seconds, Math.abs(Math.round(seed)))
  }
}

const align = (_req, body, state) => {
  const options = state.options ?? {}
  if (body.length < 44) return json({ detail: 'No audio.' }, 400)
  if (body.length > 8_000_000) return json({ detail: 'That clip is too long to time its words.' }, 413)
  const engine = alignerOf(state)
  if (!engine) return json({ detail: 'no-aligner' }, 503)
  const text = state.spokenClips?.get(hash(body)) ?? (typeof options.alignWords === 'string' ? options.alignWords : '')
  const said = text.split(/\s+/).filter(Boolean)
  const seconds = readWav(body).seconds
  const each = said.length ? seconds / said.length : 0
  const words = said.map((word, i) => ({
    word,
    start: Math.round(i * each * 1000) / 1000,
    end: Math.round((i + 1) * each * 1000) / 1000
  }))
  return json({ words, engine })
}

export const routes = {
  'POST /v1/sounds/generate': generate,
  'POST /v1/align': align,
  'GET /__sounds': (_req, _body, state) => ({ body: state.sounds ?? [] })
}
