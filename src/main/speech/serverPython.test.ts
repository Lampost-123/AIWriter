// The speech server's own Python, where it needs nothing but Python itself: dictation's clean-up of what
// was said (speech-server/app/stt.py), what counts as downloaded (app/downloaded.py), who the server answers
// (app/guard.py), and the download tool's reading of Hugging Face's refusals and its unpacking of Parakeet
// (tools/install.py). Skipped on a computer without Python 3.10 or newer.
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
function py<T>(code: string, input: unknown = null): T {
  const r = spawnSync(python as string, ['-c', code], {
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
