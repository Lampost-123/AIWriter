// The fake speech server's engine routes (milestone 4, the Speech engine part), answering like AI Write's
// own speech server (speech-server/app/server.py): what it has (health, models), loading and letting go of
// models (warm-up, unload, the dictation model), and stopping (shutdown).
//
// What it says, from the options given to startFakeSpeech (read on every request, so a test can change
// them as it goes):
//   voices            Breeze is downloaded there (default true; voicesNotReady, the Read aloud part's, says no too)
//   parakeet, whisper each dictation model is downloaded there (default true)
//   home              when set (AI Write started it as its own server), what isn't given above is read from
//                     the files the fake downloads leave there (install.mjs), with the real server's rules
//                     (speech-server/app/downloaded.py): the voices count with their mark, Parakeet with all
//                     four files in one folder, Whisper with all of its files and nothing half-downloaded
//   dictationEngine   the dictation model it starts with: 'parakeet' (default), 'whisper' or 'none'
//   device            what the voices run on (default 'CUDA · NVIDIA GeForce RTX 4090'; 'CPU' for the processor)
//   healthDelayMs     how long /health takes to answer (default 0)
//   voicesLoadError   why the voices fail to load, as the real server reports it (loadError, and warm-up's answer);
//                     in AI Write's speech folder (home), the words in venvs/breeze/damaged.txt say the same, until
//                     a download sets that environment up afresh
//   dictationLoadError { parakeet?, whisper? }: the same for a dictation model; in home, models/<model>/damaged.txt
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const DICTATION = ['none', 'parakeet', 'whisper']
const PARAKEET_FILES = ['encoder.int8.onnx', 'decoder.int8.onnx', 'joiner.int8.onnx', 'tokens.txt']
const WHISPER_FILES = ['config.json', 'model.bin', 'tokenizer.json', 'vocabulary.txt']

const folders = (dir) => {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  } catch {
    return []
  }
}

const allIn = (dir, files) => files.every((f) => existsSync(join(dir, f)))

/** A Hugging Face cache folder with nothing half-downloaded, and its snapshot with all of `files`. */
function snapshotWith(cache, files) {
  let half = false
  try {
    half = readdirSync(join(cache, 'blobs')).some((n) => n.endsWith('.incomplete'))
  } catch {
    /* no blobs */
  }
  if (half) return null
  const name = folders(join(cache, 'snapshots')).find((n) => allIn(join(cache, 'snapshots', n), files))
  return name ? join(cache, 'snapshots', name) : null
}

/** Breeze's weights in AI Write's speech folder: counted by the mark the voices' last download step leaves. */
function breezeWeights(home) {
  const cache = join(home, 'models', 'hf', 'hub', 'models--BreezeBlue--breeze-tts-2')
  return existsSync(join(home, 'models', 'breeze', '.ready')) && !!snapshotWith(cache, ['config.json'])
}

/** What is downloaded in AI Write's speech folder, with the rules AI Write and the real server use. */
function onDisk(options, id) {
  const home = options.home
  if (id === 'voices') {
    return existsSync(join(home, 'models', 'breeze', 'code', 'breeze_infer')) && breezeWeights(home)
  }
  if (id === 'parakeet') {
    const dir = join(home, 'models', 'parakeet')
    // Itself or one folder down, never the one being unpacked.
    const inside = folders(dir).filter((n) => n !== '.unpack')
    return [dir, ...inside.map((n) => join(dir, n))].some((d) => allIn(d, PARAKEET_FILES))
  }
  return !!snapshotWith(join(home, 'models', 'whisper', 'models--Systran--faster-whisper-base.en'), WHISPER_FILES)
}

function engineOf(state) {
  state.loaded ??= new Set()
  if (state.dictationEngine === undefined) {
    const start = state.options?.dictationEngine ?? 'parakeet'
    state.dictationEngine = DICTATION.includes(start) ? start : 'parakeet'
  }
  return state.dictationEngine
}

function ready(state, id) {
  const options = state.options ?? {}
  if (id === 'voices' && options.voicesNotReady) return false
  if (options[id] !== undefined) return options[id] !== false
  return options.home ? onDisk(options, id) : true
}

/** Why a downloaded model fails to load (the real server's loadError): from the options, or the damaged.txt a test left. */
function loadError(state, id) {
  const options = state.options ?? {}
  const given = id === 'voices' ? options.voicesLoadError : options.dictationLoadError?.[id]
  if (given) return String(given)
  if (!options.home) return ''
  const dir = id === 'voices' ? join(options.home, 'venvs', 'breeze') : join(options.home, 'models', id)
  try {
    return readFileSync(join(dir, 'damaged.txt'), 'utf8').trim()
  } catch {
    return ''
  }
}

function health(state) {
  const engine = engineOf(state)
  const voices = ready(state, 'voices')
  const voicesError = voices ? loadError(state, 'voices') : ''
  const model = (id, name) => {
    const error = ready(state, id) ? loadError(state, id) : ''
    return {
      id,
      name,
      blurb: '',
      ready: ready(state, id),
      loaded: state.loaded.has(id) && engine === id && !error,
      voices: 0,
      detail: ready(state, id) ? '' : 'Not installed. Download it in AI Write’s Settings, Read aloud and dictation.',
      loadError: error
    }
  }
  return {
    ok: true,
    service: 'aiwrite-speech',
    version: '1.0.0',
    app: 'fake',
    uptime: 1,
    sampleRate: 24000,
    device: state.options?.device ?? 'CUDA · NVIDIA GeForce RTX 4090',
    default: 'breeze',
    engines: [
      {
        id: 'breeze',
        name: 'Breeze TTS 2',
        blurb: '',
        ready: voices,
        loaded: voices && !voicesError && state.loaded.has('breeze'),
        detail: voices ? voicesError : 'Not downloaded yet. Download the voices in AI Write’s Settings, Read aloud and dictation.',
        loadError: voicesError,
        voices: voices ? 8 : 0,
        loadSeconds: 0,
        requests: 0
      }
    ],
    ready: voices,
    dictation: {
      engine,
      loaded: engine !== 'none' && state.loaded.has(engine) && !loadError(state, engine) ? engine : null,
      models: [model('parakeet', 'Parakeet'), model('whisper', 'Whisper')]
    }
  }
}

const json = (body, status = 200) => ({ status, body })

function parse(body) {
  try {
    return body.length ? JSON.parse(body.toString('utf8')) : {}
  } catch {
    return {}
  }
}

const getHealth = async (_req, _body, state) => {
  const wait = state.options?.healthDelayMs ?? 0
  if (wait) await new Promise((r) => setTimeout(r, wait))
  return json(health(state))
}

const models = (_req, _body, state) =>
  json({
    object: 'list',
    data: ready(state, 'voices') ? [{ id: 'breeze', object: 'model', owned_by: 'aiwrite-speech', name: 'Breeze TTS 2' }] : []
  })

const warmup = (_req, body, state) => {
  engineOf(state)
  const asked = parse(body).engines
  const names = Array.isArray(asked) ? asked : typeof asked === 'string' ? [asked] : []
  const engines = {}
  for (const name of names) {
    if (name !== 'breeze') engines[name] = `Unknown engine “${name}”. Try one of: breeze.`
    else if (!ready(state, 'voices')) engines.breeze = 'Breeze TTS 2 could not start: Not downloaded yet.'
    else if (loadError(state, 'voices')) engines.breeze = `Breeze TTS 2 could not start: ${loadError(state, 'voices')}`
    else {
      state.loaded.add('breeze')
      engines.breeze = 'ready'
    }
  }
  return json({ ok: true, engines })
}

const unload = (_req, _body, state) => {
  engineOf(state)
  const unloaded = [...state.loaded].map((id) => (id === 'breeze' ? 'breeze' : 'dictation'))
  state.loaded.clear()
  return json({ ok: true, unloaded })
}

const dictationNow = (state) => health(state).dictation

const pickDictation = (_req, body, state) => {
  engineOf(state)
  const engine = String(parse(body).engine ?? 'none')
  if (!DICTATION.includes(engine)) return json({ detail: 'Pick None, Whisper, or Parakeet.' }, 503)
  state.loaded.delete('parakeet')
  state.loaded.delete('whisper')
  state.dictationEngine = engine
  if (engine !== 'none') {
    if (!ready(state, engine))
      return json(
        {
          detail: `${engine === 'parakeet' ? 'Parakeet' : 'Whisper'} is not installed. Download it in Settings, Read aloud and dictation.`
        },
        503
      )
    // As the real server: the pick is kept, and the reason it didn't load shows in /health.
    if (loadError(state, engine))
      return json(
        {
          detail:
            'That dictation model couldn’t be loaded. Download it again in Settings › Read aloud and dictation, or pick the other one.'
        },
        503
      )
    state.loaded.add(engine)
  }
  return json(dictationNow(state))
}

const shutdown = (req) => {
  if (!String(req.headers['content-type'] ?? '').includes('application/json'))
    return json({ detail: 'Send an application/json request.' }, 415)
  // server.mjs stops answering once this reply is sent.
  return { ...json({ ok: true }), after: 'close' }
}

export const routes = {
  'GET /v1/health': getHealth,
  'GET /health': getHealth,
  'GET /v1/models': models,
  'POST /v1/warmup': warmup,
  'POST /warmup': warmup,
  'POST /v1/unload': unload,
  'POST /unload': unload,
  'GET /v1/dictation': (_req, _body, state) => json(dictationNow(state)),
  'POST /v1/dictation': pickDictation,
  'POST /v1/shutdown': shutdown,
  'POST /shutdown': shutdown
}
