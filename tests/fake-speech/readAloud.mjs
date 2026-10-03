// The fake speech server's voice and speaking routes, matching mcreader-v2's speech server (the Read aloud part):
//   GET  /v1/voices?engine=breeze  Breeze's presets as the real server lists them, and one clip of the user's own
//                                  (a 404 for any other engine, as the real server answers)
//   POST /v1/audio/speech          a short, valid WAV of silence for the words asked for (24 kHz, 16-bit, mono,
//                                  about 0.02 s a character, 0.3 to 3 s), straight away. Words containing
//                                  "FAIL-SPEECH" get a 500; with the option { voicesNotReady: true } every request
//                                  gets the 503 the real server sends when Breeze can't load.
//   GET  /__spoken                 every speech request's body so far (input, voice, voice_design, delivery...), so
//                                  tests can see which voice read which line

const PRESETS = [
  ['narrator', 'Narrator', '', 'warm, clear, unhurried', true],
  ['narrator-deep', 'Deep narrator', 'male', 'resonant, measured, a little gravel', false],
  ['narrator-bright', 'Bright narrator', 'female', 'articulate, warm, crisp', false],
  ['young-woman', 'Young woman', 'female', 'light, lively', false],
  ['young-man', 'Young man', 'male', 'easy, casual', false],
  ['old-man', 'Old man', 'male', 'thin, slow, thoughtful', false],
  ['old-woman', 'Old woman', 'female', 'soft, papery, sharp-witted', false],
  ['child', 'Child', '', 'small, clear, eager', false]
]

const voices = () => [
  ...PRESETS.map(([id, name, gender, traits, recommended]) => ({
    id,
    name,
    engine: 'breeze',
    lang: 'en',
    language: 'English',
    accent: '',
    gender,
    grade: '',
    traits: `designed · ${traits}`,
    recommended
  })),
  {
    id: 'clip:storyteller.wav',
    name: 'storyteller',
    engine: 'breeze',
    lang: 'en',
    language: 'English',
    accent: '',
    gender: '',
    grade: '',
    traits: 'your clip · storyteller.wav',
    recommended: false
  }
]

const RATE = 24000

/** A WAV of silence, `seconds` long. */
function silence(seconds) {
  const samples = Math.round(RATE * seconds)
  const data = samples * 2
  const wav = Buffer.alloc(44 + data)
  wav.write('RIFF', 0)
  wav.writeUInt32LE(36 + data, 4)
  wav.write('WAVE', 8)
  wav.write('fmt ', 12)
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(RATE, 24)
  wav.writeUInt32LE(RATE * 2, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36)
  wav.writeUInt32LE(data, 40)
  return wav
}

export const routes = {
  'GET /v1/voices': (req) => {
    const engine = new URL(req.url ?? '/', 'http://localhost').searchParams.get('engine')
    if (engine && engine !== 'breeze') return { status: 404, body: { detail: `Unknown engine: ${engine}` } }
    return { body: voices() }
  },

  'POST /v1/audio/speech': (_req, body, state) => {
    let payload = {}
    try {
      payload = JSON.parse(body.toString('utf8') || '{}')
    } catch {
      return { status: 422, body: { detail: 'Body is not JSON' } }
    }
    state.spoken ??= []
    state.spoken.push(payload)
    if (state.options?.voicesNotReady) return { status: 503, body: { error: 'Breeze TTS 2 is not installed.' } }
    const input = String(payload.input ?? '')
    if (!input.trim()) return { status: 400, body: { detail: 'Nothing to say.' } }
    if (input.includes('FAIL-SPEECH')) return { status: 500, body: { detail: 'Breeze failed on this text.' } }
    const seconds = Math.min(3, Math.max(0.3, input.length * 0.02))
    return { headers: { 'Content-Type': 'audio/wav' }, body: silence(seconds) }
  },

  'GET /__spoken': (_req, _body, state) => ({ body: state.spoken ?? [] })
}
