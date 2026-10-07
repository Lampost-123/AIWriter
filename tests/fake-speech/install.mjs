// The app's tests run this in place of every speech download step (AIWRITE_FAKE_SPEECH_INSTALL): no Python,
// nothing fetched. It prints what the real steps print (pip's "Progress <done> of <total>", the install
// tool's "@@progress", "@@error", "@@licence", "@@key" and "@@gpu" lines), and leaves (empty) files in the
// speech folder (AIWRITE_SPEECH_HOME) where and when the real steps do, so a download stopped part way
// leaves what a real one would:
//   the server     its environment's Python (the 'venv' step, which empties the environment first, as the
//                  real one's --clear does)
//   the voices     their environment ('venv', made afresh the same way), Breeze's code ('code'), the weights
//                  ('weights': the small files first, the shards last), and the mark that says they are
//                  downloaded (only 'check' leaves it; 'weights' removes it, as the real steps do)
//   Parakeet       unpacked aside (models/parakeet/.unpack) and moved into place once all four files are there
//   Whisper        its snapshot, with a half-downloaded file until the step ends
//   sound effects  their environment ('venv', made afresh), Stable Audio Open's and CLAP's snapshots ('weights': one
//                  file first, the rest last), and their mark (only 'check' leaves it; 'weights' removes it)
//
//   node install.mjs <kind> <step>      kind: server, voices, parakeet, whisper, sounds, studio or python
//
// What a step does comes from the JSON file AIWRITE_FAKE_SPEECH_CONTROL names (read each time, so a test
// can change it between clicks): { "<kind>:<step>": mode } or { "<kind>": mode }, where mode is
//   "quick" (the default), "slow" (about 30 s of progress, for Cancel), "fail" (a plain-words problem),
//   "licence" (Hugging Face wants its licence accepted, unless a key was given), "gated" (it wants its licence
//   accepted even with a key: the key's account hasn't accepted it yet), "refused" (Hugging Face turns the
//   saved key down; with no key, it wants its licence accepted) or "offline" (pip can't reach the internet).
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const [kind = 'server', step = 'check'] = process.argv.slice(2)
const home = process.env.AIWRITE_SPEECH_HOME || '.'
const win = process.platform === 'win32'

function control() {
  try {
    return JSON.parse(readFileSync(process.env.AIWRITE_FAKE_SPEECH_CONTROL || '', 'utf8'))
  } catch {
    return {}
  }
}

const c = control()
const mode = c[`${kind}:${step}`] ?? c[kind] ?? 'quick'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const say = (line) => process.stdout.write(`${line}\n`)

function touch(...parts) {
  const file = join(home, ...parts)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, parts.at(-1).endsWith('.json') ? '{}' : '')
}

const python = win ? ['Scripts', 'python.exe'] : ['bin', 'python']
const BREEZE = ['models', 'hf', 'hub', 'models--BreezeBlue--breeze-tts-2']
const BREEZE_SNAPSHOT = [...BREEZE, 'snapshots', 'fake']
const MARK = ['models', 'breeze', '.ready']
const PARAKEET = 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8'
const PARAKEET_FILES = ['encoder.int8.onnx', 'decoder.int8.onnx', 'joiner.int8.onnx', 'tokens.txt']
const WHISPER = ['models', 'whisper', 'models--Systran--faster-whisper-base.en']
const SOUND_SNAPSHOT = ['models', 'hf', 'hub', 'models--stabilityai--stable-audio-open-1.0', 'snapshots', 'fake']
const SOUND_FILES = [
  'model_index.json',
  'transformer/config.json',
  'transformer/diffusion_pytorch_model.safetensors',
  'vae/config.json',
  'vae/diffusion_pytorch_model.safetensors',
  'text_encoder/config.json',
  'text_encoder/model.safetensors',
  'tokenizer/tokenizer_config.json',
  'tokenizer/spiece.model',
  'projection_model/config.json',
  'projection_model/diffusion_pytorch_model.safetensors',
  'scheduler/scheduler_config.json'
]
const CLAP_SNAPSHOT = ['models', 'hf', 'hub', 'models--laion--larger_clap_general', 'snapshots', 'fake']
const CLAP_FILES = [
  'config.json',
  'preprocessor_config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'special_tokens_map.json',
  'vocab.json',
  'merges.txt',
  'model.safetensors'
]
const SOUND_MARK = ['models', 'sound', '.ready']
// Each download's environment, emptied by its 'venv' step as `python -m venv --clear` empties it.
const VENVS = { server: ['venv'], voices: ['venvs', 'breeze'], sounds: ['venvs', 'sound'] }

/** What a step leaves as it starts (what the real one fetches first). */
function begin() {
  // As `python -m venv --clear`: whatever was in the environment goes.
  if (step === 'venv') rmSync(join(home, ...(VENVS[kind] ?? ['venv'])), { recursive: true, force: true })
  if (kind === 'voices' && step === 'weights') {
    // The voices may change from here on: they count as downloaded again only once checked.
    rmSync(join(home, ...MARK), { force: true })
    for (const f of ['config.json', 'tokenizer.json', 'tokenizer_config.json']) touch(...BREEZE_SNAPSHOT, f)
  }
  if (kind === 'sounds' && step === 'weights') {
    // The sound effects may change from here on: they count as downloaded again only once checked.
    rmSync(join(home, ...SOUND_MARK), { force: true })
    touch(...SOUND_SNAPSHOT, 'model_index.json')
  }
  if (kind === 'parakeet' && step === 'model') touch('models', 'parakeet', '.unpack', PARAKEET, 'encoder.int8.onnx')
  if (kind === 'whisper' && step === 'model') {
    touch(...WHISPER, 'blobs', 'model.bin.incomplete')
    touch(...WHISPER, 'snapshots', 'fake', 'config.json')
  }
}

/** What a step leaves once it has worked. */
function end() {
  if (kind === 'server' && (step === 'venv' || step === 'check')) touch('venv', ...python)
  if (kind === 'voices' && step === 'venv') touch('venvs', 'breeze', ...python)
  if (kind === 'voices' && step === 'code') touch('models', 'breeze', 'code', 'breeze_infer', '__init__.py')
  if (kind === 'voices' && step === 'weights') {
    touch(...BREEZE_SNAPSHOT, 'audio_tokenizer', 'model.safetensors')
    touch(...BREEZE_SNAPSHOT, 'model-00001-of-00001.safetensors')
    const index = join(home, ...BREEZE_SNAPSHOT, 'model.safetensors.index.json')
    writeFileSync(index, JSON.stringify({ weight_map: { 'talker.embed': 'model-00001-of-00001.safetensors' } }))
  }
  if (kind === 'voices' && step === 'check') touch(...MARK)
  if (kind === 'sounds' && step === 'venv') touch('venvs', 'sound', ...python)
  if (kind === 'sounds' && step === 'weights') {
    for (const f of SOUND_FILES) touch(...SOUND_SNAPSHOT, ...f.split('/'))
    for (const f of CLAP_FILES) touch(...CLAP_SNAPSHOT, f)
  }
  if (kind === 'sounds' && step === 'check') touch(...SOUND_MARK)
  if (kind === 'studio' && step === 'voices') {
    // Two made-up studio voices, as speech-server/tools/install.py studio-voices lists them.
    const index = [
      { id: 'p001', gender: 'female', age: '26-35', hz: 210, moods: ['anger', 'whisper'], name: 'Clara', pitch: 'mid' },
      { id: 'p002', gender: 'male', age: '46-55', hz: 110, moods: ['anger', 'whisper'], name: 'Arthur', pitch: 'low' }
    ]
    for (const v of index) {
      touch('voices', 'library', `${v.id}.wav`)
      touch('voices', 'library', `${v.id}.txt`)
    }
    writeFileSync(join(home, 'voices', 'library', 'index.json'), JSON.stringify(index))
  }
  if (kind === 'studio' && step === 'listener') touch('models', 'hf', 'hub', 'models--distil-whisper--distil-small.en', 'snapshots', 'fake', 'config.json')
  if (kind === 'studio' && step === 'check') touch('voices', 'library', '.ready')
  if (kind === 'parakeet' && step === 'model') {
    const aside = join(home, 'models', 'parakeet', '.unpack')
    for (const f of PARAKEET_FILES) touch('models', 'parakeet', '.unpack', PARAKEET, f)
    const target = join(home, 'models', 'parakeet', PARAKEET)
    rmSync(target, { recursive: true, force: true })
    renameSync(join(aside, PARAKEET), target)
    rmSync(aside, { recursive: true, force: true })
  }
  if (kind === 'whisper' && step === 'model') {
    rmSync(join(home, ...WHISPER, 'blobs', 'model.bin.incomplete'), { force: true })
    for (const f of ['model.bin', 'tokenizer.json', 'vocabulary.txt']) touch(...WHISPER, 'snapshots', 'fake', f)
  }
}

const NAMES = {
  server: 'The speech engine',
  voices: 'The voices',
  parakeet: 'Parakeet',
  whisper: 'Whisper',
  sounds: 'The sound effects',
  studio: 'The studio voices',
  python: 'Python'
}
const pipStep = ['packages', 'torch', 'pip', 'torch-check'].includes(step)
const TOTALS = { voices: 3_200_000_000, sounds: 3_300_000_000, whisper: 145_000_000, parakeet: 482_000_000 }
const total = TOTALS[kind] ?? 24_000_000
const ticks = mode === 'slow' ? 120 : 4

// The Hugging Face key goes to the voices' and the sound effects' weights steps only. Any other step that gets it
// fails loudly, and the weights steps print it (as a careless tool might), so the tests can see AI Write hides it.
const key = process.env.HF_TOKEN
if (key && !((kind === 'voices' || kind === 'sounds') && step === 'weights')) {
  say(`@@error The Hugging Face key reached ${kind}:${step}, which must never have it.`)
  process.exit(1)
}
if (key) {
  say(`Signed in to Hugging Face with ${key}`)
  touch('models', 'hf', 'key-was-given')
}

// What Hugging Face asks to be accepted: the voices' page, or the sound effects' model's.
const page = kind === 'sounds' ? 'https://huggingface.co/stabilityai/stable-audio-open-1.0' : 'https://huggingface.co/BreezeBlue/breeze-tts-2'
const fetching = kind === 'sounds' ? `Downloading Stable Audio Open from ${page}` : `Downloading Breeze TTS 2’s voices from ${page}`

if (mode === 'refused' && key) {
  say(fetching)
  say('huggingface_hub.errors.HfHubHTTPError: 401 Client Error: Unauthorized for url: https://huggingface.co/api/models/BreezeBlue')
  say('@@key')
  say('@@error Hugging Face didn’t accept the saved key. Make a new key with read access, save it, then Try again.')
  process.exit(3)
}
if (mode === 'gated' || ((mode === 'licence' || mode === 'refused') && !key)) {
  say(fetching)
  say(`@@licence ${page}`)
  process.exit(3)
}

begin()

if (pipStep) say(`Collecting fake-${kind}`)
if (pipStep) say(`  Downloading fake_${kind}-1.0-py3-none-any.whl (${(total / 1e6).toFixed(1)} MB)`)
else say(`Working on ${kind}: ${step}`)

for (let i = 1; i <= ticks; i++) {
  await sleep(mode === 'slow' ? 250 : 30)
  const done = Math.round((total * i) / (ticks + 1))
  say(pipStep ? `Progress ${done} of ${total}` : `@@progress ${done} ${total}`)
  if (i % 8 === 0) say(`Still downloading ${kind} (${i} of ${ticks})`)
  if (mode === 'fail' && i >= ticks / 2) {
    say('Traceback (most recent call last):')
    say('  ConnectionResetError: [Errno 104] Connection reset by peer')
    say(`@@error ${NAMES[kind] ?? 'It'} didn’t finish downloading. Check the internet connection, then Try again.`)
    process.exit(1)
  }
  if (mode === 'offline' && i >= ticks / 2) {
    say("WARNING: Retrying after connection broken by 'NewConnectionError: Failed to establish a new connection'")
    say('ERROR: Could not find a version that satisfies the requirement fake (from versions: none)')
    process.exit(1)
  }
}

if (pipStep) say(`Successfully installed fake-${kind}-1.0`)
if (step === 'check' && kind === 'sounds') {
  say(`@@gpu ${process.env.AIWRITE_FAKE_SPEECH_GPU || 'none'}`)
  if (!existsSync(join(home, ...CLAP_SNAPSHOT, 'model.safetensors'))) {
    say('@@error The sound effects didn’t finish downloading. Try again; what is already downloaded is kept.')
    process.exit(1)
  }
}
if (step === 'check' && kind === 'voices') {
  say(`@@gpu ${process.env.AIWRITE_FAKE_SPEECH_GPU || 'none'}`)
  // As the real check: the mark only when what came before is all there.
  if (!existsSync(join(home, ...BREEZE_SNAPSHOT, 'model.safetensors.index.json'))) {
    say('@@error The voices didn’t finish downloading. Try again; what is already downloaded is kept.')
    process.exit(1)
  }
}
end()
if (step === 'check') say('Ready.')
process.exit(0)
