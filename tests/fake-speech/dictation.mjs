// The fake speech server's transcription route (milestone 4, Dictation), answering like the real server's
// (Poor-Mans-Holodeck's POST /v1/audio/transcriptions): the recording is the body, a WAV, and the answer
// is { text }. Less than a WAV header is 400 "No audio.", more than 8 MB is 413, as the real one says.
//
// What it answers, from the options given to startFakeSpeech (read on every request, so a test can
// change them between recordings):
//   dictation         the words: a string (default 'The lantern flickered twice.'), a list (one per
//                     recording, the last one repeated), or a function (recording) => string
//   dictationDelayMs  how long writing it down takes (default 0), so "Writing it down" can be seen
//   dictationFail     { status, detail } to answer instead, e.g. { status: 503, detail: 'No dictation model is loaded.' }
// GET /__dictation lists the recordings it was sent: { bytes, sampleRate, channels, bits, seconds, peak }.

export const DEFAULT_WORDS = 'The lantern flickered twice.'

/** What a WAV holds: its format, how long it is and its loudest sample (0 to 1). */
export function readWav(buf) {
  const info = { bytes: buf.length, sampleRate: 0, channels: 0, bits: 0, seconds: 0, peak: 0 }
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return info
  info.channels = buf.readUInt16LE(22)
  info.sampleRate = buf.readUInt32LE(24)
  info.bits = buf.readUInt16LE(34)
  const data = buf.subarray(44, 44 + buf.readUInt32LE(40))
  const frames = Math.floor(data.length / 2)
  if (info.sampleRate && info.channels) info.seconds = frames / info.channels / info.sampleRate
  let peak = 0
  for (let i = 0; i < frames; i++) peak = Math.max(peak, Math.abs(data.readInt16LE(i * 2)))
  info.peak = peak / 32768
  return info
}

function wordsFor(options, heard, n) {
  const w = options.dictation ?? DEFAULT_WORDS
  if (typeof w === 'function') return String(w(heard) ?? '')
  if (Array.isArray(w)) return String(w[Math.min(n, w.length - 1)] ?? '')
  return String(w)
}

const transcribe = async (_req, body, state) => {
  if (body.length < 44) return { status: 400, body: { detail: 'No audio.' } }
  if (body.length > 8_000_000) return { status: 413, body: { detail: 'That recording is too long. Stop sooner and try again.' } }
  state.dictation ??= []
  const heard = readWav(body)
  state.dictation.push(heard)
  const options = state.options ?? {}
  if (options.dictationDelayMs) await new Promise((r) => setTimeout(r, options.dictationDelayMs))
  if (options.dictationFail)
    return { status: options.dictationFail.status ?? 503, body: { detail: options.dictationFail.detail ?? 'Dictation failed.' } }
  return { body: { text: wordsFor(options, heard, state.dictation.length - 1) } }
}

export const routes = {
  'POST /v1/audio/transcriptions': transcribe,
  'GET /__dictation': (_req, _body, state) => ({ body: state.dictation ?? [] })
}
