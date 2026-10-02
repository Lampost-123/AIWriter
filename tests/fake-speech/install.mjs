// The app's tests run this in place of every speech download step (AIWRITE_FAKE_SPEECH_INSTALL): no Python,
// nothing fetched. It prints what the real steps print (pip's "Progress <done> of <total>", the install
// tool's "@@progress", "@@error", "@@licence" and "@@gpu" lines), and when a download's last step ('check')
// succeeds it leaves the files AI Write looks for, in the speech folder (AIWRITE_SPEECH_HOME).
//
//   node install.mjs <kind> <step>      kind: server, voices, parakeet, whisper or python
//
// What a step does comes from the JSON file AIWRITE_FAKE_SPEECH_CONTROL names (read each time, so a test
// can change it between clicks): { "<kind>:<step>": mode } or { "<kind>": mode }, where mode is
//   "quick" (the default), "slow" (about 30 s of progress, for Cancel), "fail" (a plain-words problem),
//   "licence" (Hugging Face wants its licence accepted, unless a key was given) or "offline" (pip can't
//   reach the internet).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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
  writeFileSync(file, '')
}

/** The files AI Write checks for once each download is done. */
function leaveFiles() {
  const python = win ? ['Scripts', 'python.exe'] : ['bin', 'python']
  if (kind === 'server') touch('venv', ...python)
  if (kind === 'voices') {
    touch('venvs', 'breeze', ...python)
    touch('models', 'breeze', 'code', 'breeze_infer', '__init__.py')
    touch('models', 'hf', 'hub', 'models--BreezeBlue--breeze-tts-2', 'snapshots', 'fake', 'config.json')
  }
  if (kind === 'parakeet') touch('models', 'parakeet', 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8', 'encoder.int8.onnx')
  if (kind === 'whisper') touch('models', 'whisper', 'models--Systran--faster-whisper-base.en', 'snapshots', 'fake', 'model.bin')
}

const NAMES = { server: 'The speech engine', voices: 'The voices', parakeet: 'Parakeet', whisper: 'Whisper', python: 'Python' }
const pipStep = ['packages', 'torch', 'pip', 'torch-check'].includes(step)
const total = kind === 'voices' ? 3_200_000_000 : kind === 'whisper' ? 145_000_000 : kind === 'parakeet' ? 482_000_000 : 24_000_000
const ticks = mode === 'slow' ? 120 : 4

// The Hugging Face key goes to the voices' weights step only. Any other step that gets it fails loudly, and
// the weights step prints it (as a careless tool might), so the tests can see AI Write hides it.
const key = process.env.HF_TOKEN
if (key && !(kind === 'voices' && step === 'weights')) {
  say(`@@error The Hugging Face key reached ${kind}:${step}, which must never have it.`)
  process.exit(1)
}
if (key) {
  say(`Signed in to Hugging Face with ${key}`)
  touch('models', 'hf', 'key-was-given')
}

if (mode === 'licence' && !key) {
  say('Downloading Breeze TTS 2’s voices from https://huggingface.co/BreezeBlue/breeze-tts-2')
  say('@@licence https://huggingface.co/BreezeBlue/breeze-tts-2')
  process.exit(3)
}

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
if (step === 'check') {
  if (kind === 'voices') say(`@@gpu ${process.env.AIWRITE_FAKE_SPEECH_GPU || 'none'}`)
  leaveFiles()
  say('Ready.')
}
process.exit(0)
