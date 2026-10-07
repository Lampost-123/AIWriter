// The speech server's own Python, where it needs nothing but Python itself: dictation's clean-up of what
// was said (speech-server/app/stt.py), what counts as downloaded (app/downloaded.py), who the server answers
// (app/guard.py), and the download tool's reading of Hugging Face's refusals and its unpacking of Parakeet
// (tools/install.py). Skipped on a computer without Python 3.10 or newer.
//
// The sound effects' shaping (app/sound_audio.py) and the graphics card sharing (app/engines/base.py) need numpy
// as well: those run with a Python that has it (AIWRITE_TEST_PYTHON names one), and are skipped without.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const SERVER = resolve(__dirname, '..', '..', '..', 'speech-server')

function findPython(): string | null {
  for (const p of ['python3', 'python']) {
    const r = spawnSync(p, ['-c', 'import sys; print(sys.version_info >= (3, 10))'], { encoding: 'utf8' })
    if (r.status === 0 && r.stdout.trim() === 'True') return p
  }
  return null
}

const python = findPython()

/** A Python 3.10 or newer with numpy: AIWRITE_TEST_PYTHON first, then the one on the PATH. */
function findNumpyPython(): string | null {
  for (const p of [process.env.AIWRITE_TEST_PYTHON, 'python3', 'python']) {
    if (!p) continue
    const r = spawnSync(p, ['-c', 'import sys, numpy; print(sys.version_info >= (3, 10))'], { encoding: 'utf8' })
    if (r.status === 0 && r.stdout.trim() === 'True') return p
  }
  return null
}

const numpyPython = findNumpyPython()

function clean(texts: string[]): string[] {
  const code = 'import json, sys; from app.stt import clean; print(json.dumps([clean(t) for t in json.loads(sys.stdin.read())]))'
  const r = spawnSync(python as string, ['-c', code], {
    cwd: SERVER,
    input: JSON.stringify(texts),
    encoding: 'utf8',
    env: { ...process.env, PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1', AIWRITE_SPEECH_HOME: join(SERVER, 'no-such-folder') }
  })
  if (r.status !== 0) throw new Error(r.stderr)
  return JSON.parse(r.stdout) as string[]
}

/** Runs `code` in the server's folder (its last line prints JSON) and returns what it printed. */
function py<T>(code: string, input: unknown = null, with_: string | null = python): T {
  const r = spawnSync(with_ as string, ['-c', code], {
    cwd: SERVER,
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1', AIWRITE_SPEECH_HOME: join(SERVER, 'no-such-folder') }
  })
  if (r.status !== 0) throw new Error(r.stderr)
  // What the code said along the way ("@@progress ...") comes first.
  return JSON.parse(r.stdout.trim().split('\n').at(-1) ?? '') as T
}

describe.skipIf(!python)('dictation’s clean-up of what was said', () => {
  it('drops fillers and stutters', () => {
    expect(
      clean([
        'Um, I think that the the door was open.',
        'I I want to go to the the market, er, today.',
        'The erm butler did it',
        'Mara said, um, no.'
      ])
    ).toEqual(['I think that the door was open.', 'I want to go to the market today.', 'The butler did it', 'Mara said no.'])
  })

  it('keeps what is meant: real doubles, “hmm”, “uh-huh” and “uh oh”', () => {
    const kept = ['He had had enough.', 'Hmm, maybe.', 'Uh-huh, she said.', 'Uh-oh.', 'Uh oh, the door.', 'He paused... then spoke.']
    expect(clean(kept)).toEqual(kept)
  })

  it('leaves one pause where a filler sat between two', () => {
    expect(clean(['Wait... um... what?', 'Wait… uh… what?'])).toEqual(['Wait... what?', 'Wait… what?'])
  })

  it('types nothing for nothing but a filler', () => {
    expect(clean(['Ummm.', 'uh', ''])).toEqual(['', '', ''])
  })

  it('says why a model couldn’t be loaded until it loads, and never for one that isn’t downloaded', () => {
    const code = [
      'import json',
      'from app import stt',
      'tries = []',
      'def load():',
      '    tries.append(1)',
      '    if len(tries) == 1: raise RuntimeError("Protobuf parsing failed.")',
      '    return object()',
      'def missing(): raise stt.DictationError("Whisper is not installed.")',
      'stt._load_parakeet, stt._load_whisper = load, missing',
      'errors = lambda: {m["id"]: m["loadError"] for m in stt.statuses()}',
      'out = []',
      'try: stt.use("parakeet")',
      'except RuntimeError: pass',
      'out += [errors(), stt.choice(), stt.loaded()]',
      'stt.use("parakeet")',
      'out += [errors(), stt.loaded()]',
      'try: stt.use("whisper")',
      'except stt.DictationError: pass',
      'out.append(errors())',
      'print(json.dumps(out))'
    ].join('\n')
    expect(py(code)).toEqual([
      { parakeet: 'RuntimeError: Protobuf parsing failed.', whisper: '' },
      'parakeet',
      null,
      { parakeet: '', whisper: '' },
      'parakeet',
      { parakeet: '', whisper: '' }
    ])
  })
})

describe.skipIf(!python)('what the server counts as downloaded (app/downloaded.py, the same rules as installed.ts)', () => {
  let dir = ''
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'aiwrite-speech-py-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('never counts voices or dictation models stopped part way', () => {
    const code = `
import json, sys
from pathlib import Path
from app import downloaded as d
root = Path(json.loads(sys.stdin.read()))
def touch(*parts, text=''):
    f = root.joinpath(*parts)
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(text)
out = {}
snap = ('models', 'hf', 'hub', 'models--BreezeBlue--breeze-tts-2', 'snapshots', 'abc')
touch(*snap, 'config.json')
out['voices, config only'] = d.breeze_complete(root)
touch('models', 'breeze', '.ready')
out['voices, with their mark'] = d.breeze_complete(root)
p = root / 'parakeet'
for f in d.PARAKEET_FILES:
    touch('parakeet', '.unpack', 'model', f)
touch('parakeet', 'model', 'encoder.int8.onnx')
out['parakeet, unpacking'] = d.parakeet_dir(p) is not None
for f in d.PARAKEET_FILES:
    touch('parakeet', 'model', f)
out['parakeet, in place'] = d.parakeet_dir(p) == p / 'model'
w = ('whisper', 'models--Systran--faster-whisper-base.en')
touch(*w, 'snapshots', 'r', 'model.bin')
out['whisper, part'] = d.whisper_dir(root / 'whisper') is not None
for f in d.WHISPER_FILES:
    touch(*w, 'snapshots', 'r', f)
out['whisper, all'] = d.whisper_dir(root / 'whisper') is not None
touch(*w, 'blobs', 'y.incomplete')
out['whisper, a file half-fetched'] = d.whisper_dir(root / 'whisper') is not None
print(json.dumps(out))
`
    expect(py(code, dir)).toEqual({
      'voices, config only': false,
      'voices, with their mark': true,
      'parakeet, unpacking': false,
      'parakeet, in place': true,
      'whisper, part': false,
      'whisper, all': true,
      'whisper, a file half-fetched': false
    })
  })

  it('unpacks Parakeet aside and moves it into place only when all of it is there', () => {
    const code = `
import io, json, sys, tarfile
from pathlib import Path
sys.argv = ['install.py']
sys.path.insert(0, 'tools')
import install
from app import downloaded as d
root = Path(json.loads(sys.stdin.read()))
def archive(name, files, cut=0):
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode='w:bz2') as t:
        for f in files:
            data = (f * 2000).encode()
            info = tarfile.TarInfo(f'sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8/{f}')
            info.size = len(data)
            t.addfile(info, io.BytesIO(data))
    data = buf.getvalue()
    path = root / name
    path.write_bytes(data[: len(data) - cut] if cut else data)
    return path
out = {}
dest = root / 'models' / 'parakeet'
dest.mkdir(parents=True)
for name, files, cut in (('cut.tar.bz2', d.PARAKEET_FILES, 200), ('short.tar.bz2', d.PARAKEET_FILES[:3], 0)):
    try:
        install.unpack_parakeet(archive(name, files, cut), dest)
        out[name] = 'unpacked'
    except Exception as exc:
        out[name] = 'refused'
    out[name + ' leaves'] = sorted(p.name for p in dest.iterdir())
target = install.unpack_parakeet(archive('whole.tar.bz2', d.PARAKEET_FILES), dest)
out['whole'] = target.name
out['whole leaves'] = sorted(p.name for p in dest.iterdir())
out['found'] = d.parakeet_dir(dest) == target
print(json.dumps(out))
`
    expect(py(code, dir)).toEqual({
      'cut.tar.bz2': 'refused',
      'cut.tar.bz2 leaves': [],
      'short.tar.bz2': 'refused',
      'short.tar.bz2 leaves': [],
      whole: 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8',
      'whole leaves': ['sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8'],
      found: true
    })
  })
})

describe.skipIf(!python)('Hugging Face saying no (tools/install.py)', () => {
  it('tells a licence to accept from a saved key it turned down', () => {
    const code = `
import json, sys
sys.argv = ['install.py']
sys.path.insert(0, 'tools')
import install
class GatedRepoError(Exception): pass
class HfHubHTTPError(Exception):
    def __init__(self, status):
        super().__init__(f'{status} Client Error')
        self.response = type('R', (), {'status_code': status})()
print(json.dumps({
    'gated': install.refused(GatedRepoError('Access to model is restricted'), True),
    '401 with a key': install.refused(HfHubHTTPError(401), True),
    '401 without one': install.refused(HfHubHTTPError(401), False),
    '403 with a key': install.refused(HfHubHTTPError(403), True),
    'invalid token': install.refused(Exception('Invalid user token.'), True),
    'offline': install.refused(ConnectionError('Max retries exceeded'), True),
}))
`
    expect(py(code)).toEqual({
      gated: 'licence',
      '401 with a key': 'key',
      '401 without one': 'licence',
      '403 with a key': 'licence',
      'invalid token': 'key',
      offline: ''
    })
  })
})

describe.skipIf(!python)('the studio voices (tools/install.py, app/downloaded.py)', () => {
  let dir = ''
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'aiwrite-studio-py-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('names each voice once, by gender, and sorts them into low, mid and high for their gender', () => {
    const code = `
import json, sys
sys.argv = ['install.py']
sys.path.insert(0, 'tools')
import install
index = {v['id']: v for v in json.loads(sys.stdin.read())}
install.name_voices(index)
install.classify_pitch(index)
print(json.dumps({k: [v['name'], v['pitch']] for k, v in sorted(index.items())}))
`
    const voices = [
      { id: 'p001', gender: 'female', age: '18-25', hz: 180 },
      { id: 'p002', gender: 'female', age: '26-35', hz: 220 },
      { id: 'p003', gender: 'female', age: '36-45', hz: 260, name: 'Clara' },
      { id: 'p005', gender: 'female', age: '46-55', hz: 300 },
      { id: 'p004', gender: 'male', age: '46-55', hz: 110 }
    ]
    expect(py(code, voices)).toEqual({
      p001: ['Maya', 'low'],
      p002: ['Iris', 'mid'],
      p003: ['Clara', 'mid'],
      p004: ['Arthur', 'mid'],
      p005: ['Nora', 'high']
    })
  })

  it('count as downloaded only once their last step left its mark', () => {
    const code = `
import json, sys
from pathlib import Path
from app import downloaded as d
root = Path(json.loads(sys.stdin.read()))
out = [d.studio_complete(root)]
(root / 'voices' / 'library').mkdir(parents=True)
(root / 'voices' / 'library' / 'index.json').write_text('[]')
out.append(d.studio_complete(root))
d.studio_mark(root).write_text('1')
out.append(d.studio_complete(root))
print(json.dumps(out))
`
    expect(py(code, dir)).toEqual([false, false, true])
  })
})

describe.skipIf(!numpyPython)('the word check and the voice’s notes (app/workers/breeze.py)', () => {
  it('counts a line wrong only past one word, and reads a hurried line a touch quicker', () => {
    const code = `
import json
from app.workers import _common, breeze as b
# The worker hands the real stdout to its protocol on import.
print(file=_common._OUT)
print(file=_common._OUT, end=json.dumps({
  'same': b.misheard('I found the letter under the floor.', 'I found the letter under the floor'),
  'one word': b.misheard('I found the letter under the floor.', 'I found a letter under the floor'),
  'skipped': b.misheard('I found the letter under the floor.', 'I found the floor'),
  'short': b.misheard('Go now.', 'No'),
  'lively': b.instruction({'pace': 'lively'}),
  'mood': b.MOOD_CLIPS['sad'],
}))
`
    const out = py<Record<string, unknown>>(code, null, numpyPython)
    expect(out.same).toBe(0)
    expect(out['one word']).toBe(0)
    expect(out.skipped as number).toBeGreaterThan(0.15)
    expect(out.short).toBe(0)
    expect(out.lively).toBe('Read this a touch quicker than usual, every word still clear.')
    expect(out.mood).toBe('sadness')
  })
})

describe.skipIf(!python)('who the server answers (app/guard.py)', () => {
  it('only programs on this computer that mean to talk to it, never a web page', () => {
    const code = `
import json
from app.guard import refusal
local = {'host': '127.0.0.1:8766'}
cases = {
    'health': refusal('GET', local),
    'health, localhost': refusal('GET', {'host': 'localhost:8766'}),
    'health, [::1]': refusal('GET', {'host': '[::1]:8766'}),
    'health, another name': refusal('GET', {'host': 'evil.example:8766'}),
    'health, a name for 127.0.0.1': refusal('GET', {'host': '127.0.0.1.nip.io:8766'}),
    'no host': refusal('GET', {}),
    'unload, bare': refusal('POST', local),
    'unload, a form': refusal('POST', {**local, 'content-type': 'application/x-www-form-urlencoded'}),
    'unload, text': refusal('POST', {**local, 'content-type': 'text/plain;charset=UTF-8'}),
    'unload, AI Write': refusal('POST', {**local, 'x-aiwrite': 'speech'}),
    'dictation, JSON': refusal('POST', {**local, 'content-type': 'application/json'}),
    'clip, audio': refusal('POST', {**local, 'content-type': 'audio/wav'}),
    'preflight': refusal('OPTIONS', local),
}
print(json.dumps({k: (v[0] if v else 'ok') for k, v in cases.items()}))
`
    expect(py(code)).toEqual({
      health: 'ok',
      'health, localhost': 'ok',
      'health, [::1]': 'ok',
      'health, another name': 400,
      'health, a name for 127.0.0.1': 400,
      'no host': 400,
      'unload, bare': 403,
      'unload, a form': 403,
      'unload, text': 403,
      'unload, AI Write': 'ok',
      'dictation, JSON': 'ok',
      'clip, audio': 'ok',
      preflight: 403
    })
  })
})

describe.skipIf(!python)('the sound effects’ downloads and word timing (no numpy needed)', () => {
  let dir = ''
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'aiwrite-speech-sounds-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('counts the sound effects downloaded only with their mark and both models whole', () => {
    const code = `
import json, sys
from pathlib import Path
from app import downloaded as d
root = Path(json.loads(sys.stdin.read()))
def touch(*parts):
    f = root.joinpath(*parts)
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text('')
sao = ('models', 'hf', 'hub', d.hub_folder(d.SOUND_REPO), 'snapshots', 'a')
clap = ('models', 'hf', 'hub', d.hub_folder(d.CLAP_REPO), 'snapshots', 'b')
out = {}
for f in d.SOUND_FILES[:-1]:
    touch(*sao, *f.split('/'))
for f in d.CLAP_FILES:
    touch(*clap, f)
touch('models', 'sound', '.ready')
out['a part of Stable Audio Open missing'] = d.sound_complete(root)
touch(*sao, *d.SOUND_FILES[-1].split('/'))
out['CLAP without its weights'] = d.sound_complete(root)
touch(*clap, 'pytorch_model.bin')
out['all there'] = d.sound_complete(root)
touch('models', 'hf', 'hub', d.hub_folder(d.SOUND_REPO), 'blobs', 'x.incomplete')
out['a file half-fetched'] = d.sound_complete(root)
(root / 'models' / 'hf' / 'hub' / d.hub_folder(d.SOUND_REPO) / 'blobs' / 'x.incomplete').unlink()
(root / 'models' / 'sound' / '.ready').unlink()
out['without the mark'] = d.sound_complete(root)
print(json.dumps(out))
`
    expect(py(code, dir)).toEqual({
      'a part of Stable Audio Open missing': false,
      'CLAP without its weights': false,
      'all there': true,
      'a file half-fetched': false,
      'without the mark': false
    })
  })

  it('downloads only the parts of Stable Audio Open that diffusers loads, not its original checkpoints', () => {
    const code = `
import json, sys
sys.argv = ['install.py']
sys.path.insert(0, 'tools')
import install
names = ['.gitattributes', 'LICENSE.md', 'README.md', 'fma_dataset_attribution2.csv', 'model.ckpt', 'model.safetensors',
    'model_config.json', 'model_index.json', 'projection_model/config.json', 'projection_model/diffusion_pytorch_model.safetensors',
    'scheduler/scheduler_config.json', 'stable_audio_light.png', 'text_encoder/config.json', 'text_encoder/model.safetensors',
    'tokenizer/spiece.model', 'tokenizer/tokenizer.json', 'transformer/config.json',
    'transformer/diffusion_pytorch_model.safetensors', 'vae/config.json', 'vae/diffusion_pytorch_model.safetensors',
    'vae_model.ckpt', 'vae_model_config.json']
clap = install.clap_part('model.safetensors')
print(json.dumps({
    'kept': [n for n in names if install.sound_part(n)],
    'clap': [n for n in ['config.json', 'model.safetensors', 'pytorch_model.bin', 'README.md', 'vocab.json'] if clap(n)],
    'torch': install.SOUND_TORCH,
}))
`
    expect(py(code)).toEqual({
      kept: [
        'model_index.json',
        'projection_model/config.json',
        'projection_model/diffusion_pytorch_model.safetensors',
        'scheduler/scheduler_config.json',
        'text_encoder/config.json',
        'text_encoder/model.safetensors',
        'tokenizer/spiece.model',
        'tokenizer/tokenizer.json',
        'transformer/config.json',
        'transformer/diffusion_pytorch_model.safetensors',
        'vae/config.json',
        'vae/diffusion_pytorch_model.safetensors'
      ],
      clap: ['config.json', 'model.safetensors', 'vocab.json'],
      torch: ['torch==2.9.1', 'torchaudio==2.9.1', 'torchvision==0.24.1']
    })
  })

  it('groups Parakeet’s pieces into words with when each starts and ends', () => {
    const code = `
import json
from app.stt import group_pieces
# As sherpa-onnx gives them: a space (or "\u2581") starts a word; punctuation stays with the word before.
tokens = [' The', ' do', 'or', ' sl', 'am', 'med', ',', ' shut', '.']
starts = [0.0, 0.4, 0.56, 1.2, 1.36, 1.52, 1.68, 2.4, 2.72]
durations = [0.24, 0.16, 0.16, 0.16, 0.16, 0.24, 0.08, 0.32, 0.08]
print(json.dumps({
    'with durations': group_pieces(tokens, starts, durations, 3.5),
    'without': group_pieces(['\u2581the', '\u2581door', '\u2581sl', 'am', 'med'], [0.0, 0.3, 1.5, 1.6, 1.7], None, 1.9),
    'nothing': group_pieces([], [], None, 1.0),
}))
`
    expect(py(code)).toEqual({
      'with durations': [
        { word: 'The', start: 0, end: 0.24 },
        { word: 'door', start: 0.4, end: 0.72 },
        { word: 'slammed,', start: 1.2, end: 1.76 },
        { word: 'shut.', start: 2.4, end: 2.8 }
      ],
      // Without durations a word ends where the next starts, but a pause after it isn't counted as part of it.
      without: [
        { word: 'the', start: 0, end: 0.3 },
        { word: 'door', start: 0.3, end: 0.7 },
        { word: 'slammed', start: 1.5, end: 1.9 }
      ],
      nothing: []
    })
  })

  it('starts a word at a word mark on its own, never gluing the next piece to the word before', () => {
    const code = `
import json
from app.stt import group_pieces
print(json.dumps(group_pieces(['\\u2581the', '\\u2581', 'door', '\\u2581sl', 'am', 'med', '\\u2581', '.'], [0.0, 0.3, 0.38, 1.0, 1.1, 1.2, 1.5, 1.6], None, 2.0)))
`
    expect(py(code)).toEqual([
      { word: 'the', start: 0, end: 0.3 },
      { word: 'door', start: 0.3, end: 0.78 },
      { word: 'slammed.', start: 1, end: 2 }
    ])
  })

  it('lets dictation go first: timing words with its model while it is busy says so at once', () => {
    const code = `
import json, threading, time
from app import stt
stt._whisper_ready = lambda: True
stt._parakeet_ready = lambda: True
stt._load = lambda engine: object()
stt._align_whisper = lambda model, path: [{'word': 'w', 'start': 0, 'end': 1}]
stt._align_parakeet = lambda model, path: [{'word': 'p', 'start': 0, 'end': 1}]
out = {}
stt._choice = 'parakeet'
with stt._lock:  # dictation writing something down
    try:
        stt.align('x.wav'); out['chosen, busy'] = 'timed'
    except stt.AlignBusy:
        out['chosen, busy'] = 'busy'
out['chosen, free'] = stt.align('x.wav')[1]
# None chosen: the aligner's own model, which never waits for dictation.
stt._choice = 'none'
with stt._lock:
    out['own model, dictation busy'] = stt.align('x.wav')[1]
out['choice kept'] = stt.choice()
print(json.dumps(out))
`
    expect(py(code)).toEqual({
      'chosen, busy': 'busy',
      'chosen, free': 'parakeet',
      'own model, dictation busy': 'whisper',
      'choice kept': 'none'
    })
  })

  it('finds a complete sound effects snapshot when the newest one is incomplete, but follows refs/main for the voices', () => {
    const code = `
import json, sys
from pathlib import Path
from app import downloaded as d
root = Path(json.loads(sys.stdin.read()))
def touch(*parts, text=''):
    f = root.joinpath(*parts)
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(text)
sao = root / 'models' / 'hf' / 'hub' / d.hub_folder(d.SOUND_REPO)
for f in d.SOUND_FILES:
    touch('models', 'hf', 'hub', d.hub_folder(d.SOUND_REPO), 'snapshots', 'old', *f.split('/'))
touch('models', 'hf', 'hub', d.hub_folder(d.SOUND_REPO), 'snapshots', 'new', 'model_index.json')
touch('models', 'hf', 'hub', d.hub_folder(d.SOUND_REPO), 'refs', 'main', text='new')
breeze = d.breeze_weights_dir(root)
touch('models', 'hf', 'hub', d.hub_folder(d.BREEZE_REPO), 'snapshots', 'old', 'config.json')
touch('models', 'hf', 'hub', d.hub_folder(d.BREEZE_REPO), 'snapshots', 'new', 'tokenizer.json')
touch('models', 'hf', 'hub', d.hub_folder(d.BREEZE_REPO), 'refs', 'main', text='new')
found = d.sound_dir(root)
print(json.dumps({'sound': found.name if found else None, 'voices': d.snapshot_dir(breeze, ('config.json',))}))
`
    expect(py(code, dir)).toEqual({ sound: 'old', voices: null })
  })

  it('times words with the dictation model chosen when it is downloaded, else Whisper, else Parakeet', () => {
    const code = `
import json
from app import stt
out = []
for choice, whisper, parakeet in (('none', True, True), ('parakeet', True, True), ('whisper', False, True), ('none', False, True), ('none', False, False)):
    stt._choice = choice
    stt._whisper_ready = lambda w=whisper: w
    stt._parakeet_ready = lambda p=parakeet: p
    out.append(stt.aligner())
print(json.dumps(out))
`
    expect(py(code)).toEqual(['whisper', 'parakeet', 'parakeet', 'parakeet', null])
  })
})

describe.skipIf(!numpyPython)('the sound effects’ shaping (app/sound_audio.py)', () => {
  const run = <T>(code: string): T => py<T>(code, null, numpyPython)

  it('measures loudness as BS.1770 does: a full-scale 997 Hz tone in one channel is -3 LUFS', () => {
    const code = `
import json
import numpy as np
from app import sound_audio as a
sr = 48000
t = np.arange(sr * 5) / sr
tone = np.sin(2 * np.pi * 997 * t)
print(json.dumps({'tone': round(a.loudness(tone, sr), 2), 'silence': str(a.loudness(np.zeros(sr), sr))}))
`
    expect(run(code)).toEqual({ tone: -3.01, silence: '-inf' })
  })

  it('brings every sound to one loudness, with no sample above -1 dBFS', () => {
    const code = `
import json
import numpy as np
from app import sound_audio as a
sr = 44100
rng = np.random.default_rng(7)
quiet = rng.standard_normal((sr * 6, 2)) * 0.005
loud = rng.standard_normal((sr * 6, 2)) * 0.5
burst = np.zeros((sr * 2, 2)); burst[sr // 2: sr // 2 + 2000] = 0.04
out = {}
for name, x in (('quiet', quiet), ('loud', loud), ('a short knock', burst)):
    y = a.normalise(x, sr)
    out[name] = {'lufs': round(a.loudness(y, sr), 1), 'peakOk': bool(np.max(np.abs(y)) <= 10 ** (-1 / 20) + 1e-6)}
out['silence stays silent'] = bool(np.all(a.normalise(np.zeros((sr, 2)), sr) == 0))
print(json.dumps(out))
`
    const out = run<Record<string, { lufs: number; peakOk: boolean } | boolean>>(code)
    expect(out.quiet).toEqual({ lufs: -20, peakOk: true })
    expect(out.loud).toEqual({ lufs: -20, peakOk: true })
    // A short, sharp sound reaches the ceiling before the target: it is never pushed past it.
    expect(out['a short knock']).toMatchObject({ peakOk: true })
    expect((out['a short knock'] as { lufs: number }).lufs).toBeLessThanOrEqual(-20)
    expect(out['silence stays silent']).toBe(true)
  })

  it('trims an effect’s silence so it is heard on its word, and fades its ends', () => {
    const code = `
import json
import numpy as np
from app import sound_audio as a
sr = 44100
x = np.zeros((sr * 3, 2), dtype=np.float32)
x[sr: sr + sr // 4] = np.random.default_rng(1).standard_normal((sr // 4, 2)) * 0.3
y = a.trim(x, sr)
shaped = a.shape(x, sr, 'effect', 3.0)
long = np.random.default_rng(2).standard_normal((sr * 8, 2)) * 0.2
print(json.dumps({
    'seconds': round(y.shape[0] / sr, 2),
    'starts within 15 ms of the sound': bool(np.flatnonzero(np.abs(y[:, 0]) > 0)[0] <= 0.015 * sr),
    'first sample': float(shaped[0, 0]),
    'last sample': float(shaped[-1, 0]),
    'cut to the longest': round(a.shape(long, sr, 'effect', 2.5).shape[0] / sr, 2),
    'nothing but silence': int(a.trim(np.zeros((sr, 2)), sr).shape[0]),
}))
`
    expect(run(code)).toEqual({
      seconds: 0.41,
      'starts within 15 ms of the sound': true,
      'first sample': 0,
      'last sample': 0,
      'cut to the longest': 2.5,
      'nothing but silence': 0
    })
  })

  it('makes ambience loop with no click: its last sample runs on into its first, at an even level', () => {
    const code = `
import json
import numpy as np
from app import sound_audio as a
sr = 8000
rng = np.random.default_rng(3)
# A smooth, uneven sound (sample to sample it moves a little), 12 s with the 2 s made extra for the crossfade.
x = np.cumsum(rng.standard_normal((sr * 14, 2)), axis=0)
x -= np.convolve(x[:, 0], np.ones(801) / 801, mode='same')[:, None]
x = (x / np.max(np.abs(x)) * 0.5).astype(np.float32)
y = a.loop(x, sr)
step = float(np.percentile(np.abs(np.diff(x[:, 0])), 99.9))
noise = rng.standard_normal((sr * 14, 2)).astype(np.float32) * 0.2
z = a.loop(noise, sr)
f = int(a.LOOP_FADE * sr)
level = lambda v: 20 * np.log10(np.sqrt(np.mean(v.astype(np.float64) ** 2)))
print(json.dumps({
    'seconds': y.shape[0] / sr,
    'jump at the loop point within a normal step': bool(abs(float(y[0, 0]) - float(y[-1, 0])) <= step),
    'the raw clip would have clicked': bool(abs(float(x[0, 0]) - float(x[-1, 0])) > step),
    'crossfade level within 1 dB': bool(abs(level(z[:f]) - level(z[f:])) < 1.0),
    'shape keeps the loop': a.shape(x, sr, 'ambience', 12.0).shape[0] / sr,
}))
`
    expect(run(code)).toEqual({
      seconds: 12,
      'jump at the loop point within a normal step': true,
      'the raw clip would have clicked': true,
      'crossfade level within 1 dB': true,
      'shape keeps the loop': 12
    })
  })
})

describe.skipIf(!numpyPython)('sharing the graphics card (app/engines/base.py)', () => {
  const FAKES = `
import json, sys, threading, time
from app.engines import base, gpu
from app.engines.base import Engine, EngineBusy
class Fake(Engine):
    gpu = True
    def _load(self):
        return object()
    def _synth(self, model, text, voice, speed, params):
        return None, 24000
voices, sound = Fake(), Fake()
voices.name, voices.needs_mb, voices.holds_mb, voices.priority = 'Breeze TTS 2', 9700, 9500, 1
sound.name, sound.needs_mb, sound.holds_mb, sound.priority = 'Stable Audio Open', 4500, 3100, 0
base.REGISTRY[:] = [voices, sound]
free = {'mb': 20000}
gpu.free_mb = lambda fresh=False: free['mb']
def attempt(engine):
    try:
        engine.load()
        return 'loaded'
    except EngineBusy as exc:
        return str(exc)
out = {}
`

  it('loads beside the others when there is room for both at their most, and never pushes out the voices in use', () => {
    const code = `${FAKES}
voices.load(); sound.load()
out['room for both'] = [voices.loaded, sound.loaded]
sound.unload()
# Room for the sound at rest, but not for the voices to grow as they speak beside it.
free['mb'] = 4500 + 100 + 512 - 1
out['voices reading'] = attempt(sound)
out['voices kept'] = voices.loaded
free['mb'] = 4500 + 200 + 512
out['room for the voices to grow too'] = attempt(sound)
sound.unload(); free['mb'] = 3000
# Finished a while ago, but within three minutes: still reading (a pause between paragraphs).
voices._last_used = time.time() - 120
out['a pause in the reading'] = attempt(sound)
voices._last_used = time.time() - 600
out['voices idle'] = [attempt(sound), voices.loaded, sound.loaded]
voices.load()
out['the voices need the room'] = [voices.loaded, sound.loaded]
free['mb'] = None
voices._last_used = time.time() - 600
sound.load()
out['no answer from the card'] = [voices.loaded, sound.loaded]
print(json.dumps(out))
`
    expect(py(code, null, numpyPython)).toEqual({
      'room for both': [true, true],
      'voices reading': 'Breeze TTS 2 is using the graphics card now. Try again once it has finished.',
      'voices kept': true,
      'room for the voices to grow too': 'loaded',
      'a pause in the reading': 'Breeze TTS 2 is using the graphics card now. Try again once it has finished.',
      'voices idle': ['loaded', false, true],
      'the voices need the room': [true, false],
      'no answer from the card': [false, true]
    })
  })

  it('never takes the card from the voices between asking for a line and speaking it', () => {
    const code = `${FAKES}
free['mb'] = 3000
voices.load()
voices._last_used = time.time() - 600
# A line asked for: wanted from before its load until it is done.
with voices.want():
    out['wanted'] = attempt(sound)
# Speaking now (its run lock held): the sound doesn't wait for it, and doesn't push it out.
with voices._run_lock:
    out['speaking'] = attempt(sound)
out['still loaded'] = voices.loaded
# In use counts from the end of a line, not its start.
voices._last_used = time.time() - 600
voices.synth('One line.', '', 1.0, {})
out['just spoke'] = attempt(sound)
print(json.dumps(out))
`
    const busy = 'Breeze TTS 2 is using the graphics card now. Try again once it has finished.'
    expect(py(code, null, numpyPython)).toEqual({ wanted: busy, speaking: busy, 'still loaded': true, 'just spoke': busy })
  })

  it('says the sound effects can sit beside the voices only when both fit at their most', () => {
    const code = `
import json
from app import engines
from app.engines import gpu
voices, sound = engines.get('breeze'), engines.sound()
free = {'mb': 0}
gpu.free_mb = lambda fresh=False: free['mb']
out = {}
# A 16 GB card with the desktop's 2.7 GB: neither loaded, 13.6 GB free.
free['mb'] = 13583
out['16 GB card, nothing loaded'] = engines.sounds_beside()
voices._model = object(); free['mb'] = 13583 - 9460
out['16 GB card, voices loaded'] = engines.sounds_beside()
voices._model = None; sound._model = object(); free['mb'] = 13583 - 3090
out['16 GB card, sound loaded'] = engines.sounds_beside()
# A 24 GB card.
sound._model = None; free['mb'] = 21800
out['24 GB card, nothing loaded'] = engines.sounds_beside()
voices._model = object(); sound._model = object(); free['mb'] = 21800 - 9460 - 3090
out['24 GB card, both loaded'] = engines.sounds_beside()
voices._model = sound._model = None
gpu.free_mb = lambda fresh=False: None
out['no answer from the card'] = engines.sounds_beside()
print(json.dumps(out))
`
    expect(py(code, null, numpyPython)).toEqual({
      '16 GB card, nothing loaded': false,
      '16 GB card, voices loaded': false,
      '16 GB card, sound loaded': false,
      '24 GB card, nothing loaded': true,
      '24 GB card, both loaded': true,
      'no answer from the card': false
    })
  })

  it('stops a sound model still starting when the voices want the card, and says to try later, not that it is broken', () => {
    const code = `${FAKES}
import subprocess
from app.engines import worker_engine
from app.engines.worker_engine import WorkerEngine
# A worker that never says hello (a slow start), in place of the real one.
real = subprocess.Popen
worker_engine.subprocess.Popen = lambda args, **kw: real([sys.executable, '-c', 'import time; time.sleep(60)'], **kw)
class Starting(WorkerEngine):
    name, worker, needs_mb, holds_mb, priority = 'Stable Audio Open', 'sound', 4500, 3100, 0
    def _available(self):
        return True, ''
slow = Starting()
base.REGISTRY[:] = [voices, slow]
free['mb'] = 30000
result = {}
t = threading.Thread(target=lambda: result.update(sound=attempt(slow)))
t.start()
time.sleep(1.0)
t0 = time.time()
voices.load()
out['voices waited'] = round(time.time() - t0) < 10
t.join(20)
out['sound'] = result.get('sound')
out['load error'] = slow._load_error
out['sound loaded'] = slow.loaded
print(json.dumps(out))
`
    expect(py(code, null, numpyPython)).toEqual({
      'voices waited': true,
      sound: 'The voices needed the graphics card first. Try again once they have finished.',
      'load error': '',
      'sound loaded': false
    })
  })
})
