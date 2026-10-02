import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  BREEZE_NEEDS,
  breezeComplete,
  breezeWeightsWhole,
  installedNow,
  PARAKEET_FILES,
  parakeetFiles,
  readManifest,
  WHISPER_FILES,
  whisperFiles,
  writeManifest
} from './installed'
import { findMCreader, mcreaderCandidates, mcreaderVoicesIn } from './mcreader'
import { breezeCodeDir, breezeMark, breezeWeightsDir, speechPaths, venvPython } from './paths'

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aiwrite-speech-installed-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function touch(file: string, text = ''): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text)
}

const SHARDS = ['model-00001-of-00002.safetensors', 'model-00002-of-00002.safetensors']

/** Breeze's weights as Hugging Face keeps them, in snapshot `rev`: what speaking needs, the index, and `shards` of its two shards. */
function weightsIn(root: string, rev = 'a1b2c3', shards = SHARDS): string {
  const snapshot = join(breezeWeightsDir(root), 'snapshots', rev)
  for (const f of BREEZE_NEEDS) touch(join(snapshot, f))
  const map = { 'talker.layers.0': SHARDS[0], 'talker.layers.1': SHARDS[1], 'talker.norm': SHARDS[1] }
  touch(join(snapshot, 'model.safetensors.index.json'), JSON.stringify({ metadata: {}, weight_map: map }))
  for (const f of shards) touch(join(snapshot, f))
  return snapshot
}

/**
 * What a finished voices download leaves under `root`: AI Write's own copy (with the mark its last step leaves),
 * or MCreader's tts folder (no mark: all of its weights).
 */
function voicesIn(root: string, own = true): void {
  touch(venvPython(join(root, 'venvs', 'breeze')))
  touch(join(breezeCodeDir(root), 'breeze_infer', '__init__.py'))
  weightsIn(root)
  if (own) touch(breezeMark(root))
}

/** All of a dictation model's files: Parakeet unpacked into its folder, Whisper in its snapshot. */
function parakeetIn(dir: string): void {
  for (const f of PARAKEET_FILES) touch(join(dir, 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8', f))
}
function whisperIn(dir: string): void {
  for (const f of WHISPER_FILES) touch(join(dir, 'models--Systran--faster-whisper-base.en', 'snapshots', 'rev', f))
}

describe('the speech folder', () => {
  it('is in AI Write’s user data, with each part in its place', () => {
    const p = speechPaths(join('/data', 'app'), join('/res', 'speech-server'), null, 'linux')
    expect(p.home).toBe(join('/data', 'app', 'speech'))
    expect(p.python).toBe(join(p.home, 'venv', 'bin', 'python'))
    expect(p.serve).toBe(p.python)
    expect(p.breezeRoot).toBe(p.home)
    expect(p.logs).toBe(join(p.home, 'logs'))
    expect(p.manifest).toBe(join(p.home, 'installed.json'))
    expect(p.parakeet).toBe(join(p.home, 'models', 'parakeet'))
    expect(p.whisper).toBe(join(p.home, 'models', 'whisper'))
  })

  it('runs the server with pythonw on Windows, so no console window opens', () => {
    const p = speechPaths(
      'C:\\Users\\Adam\\AppData\\Roaming\\AI Write',
      'C:\\Program Files\\AI Write\\resources\\speech-server',
      null,
      'win32'
    )
    expect(p.python).toMatch(/Scripts[\\/]python\.exe$/)
    expect(p.serve).toMatch(/Scripts[\\/]pythonw\.exe$/)
  })

  it('runs Breeze from MCreader’s tts folder when its copy is used', () => {
    const p = speechPaths(dir, '/src', join(dir, 'mcreader', 'tts'), 'linux')
    expect(p.breezeRoot).toBe(join(dir, 'mcreader', 'tts'))
    expect(p.breezePython).toBe(join(dir, 'mcreader', 'tts', 'venvs', 'breeze', 'bin', 'python'))
    expect(p.home).toBe(join(dir, 'speech'))
  })
})

describe('what is downloaded', () => {
  it('is nothing at first', () => {
    const p = speechPaths(dir, '/src')
    expect(installedNow(p, readManifest(p.manifest))).toEqual({ server: false, voices: null, parakeet: false, whisper: false })
  })

  it('is each download that finished and whose files are still there', () => {
    const p = speechPaths(dir, '/src')
    touch(p.python)
    voicesIn(p.home)
    parakeetIn(p.parakeet)
    whisperIn(p.whisper)
    // Files without a finished download (one stopped part way) don't count.
    expect(installedNow(p, {})).toEqual({ server: false, voices: null, parakeet: false, whisper: false })
    const at = new Date().toISOString()
    writeManifest(p.manifest, {
      server: { at, python: '/usr/bin/python3.13' },
      voices: { at, from: 'own', root: p.home, gpu: 'RTX' },
      parakeet: { at },
      whisper: { at }
    })
    expect(installedNow(p, readManifest(p.manifest))).toEqual({ server: true, voices: 'own', parakeet: true, whisper: true })
  })

  it('is not what was deleted by hand', () => {
    const p = speechPaths(dir, '/src')
    voicesIn(p.home)
    const manifest = { voices: { at: 'now', from: 'own' as const, root: p.home, gpu: '' } }
    expect(installedNow(p, manifest).voices).toBe('own')
    rmSync(breezeWeightsDir(p.home), { recursive: true })
    expect(installedNow(p, manifest).voices).toBeNull()
  })

  it('needs all of Breeze: its environment, its code and its weights', () => {
    expect(breezeComplete(dir)).toBe(false)
    touch(venvPython(join(dir, 'venvs', 'breeze')))
    touch(join(breezeCodeDir(dir), 'breeze_infer', '__init__.py'))
    expect(breezeComplete(dir)).toBe(false)
    weightsIn(dir)
    touch(breezeMark(dir))
    expect(breezeComplete(dir)).toBe(true)
  })

  it('never counts AI Write’s own voices stopped part way: only their last step’s mark says they are done', () => {
    touch(venvPython(join(dir, 'venvs', 'breeze')))
    touch(join(breezeCodeDir(dir), 'breeze_infer', '__init__.py'))
    // Hugging Face fetches the small files first: the config is there long before the 8 GB of weights.
    touch(join(breezeWeightsDir(dir), 'snapshots', 'abc', 'config.json'))
    expect(breezeComplete(dir)).toBe(false)
    weightsIn(dir, 'abc')
    expect(breezeComplete(dir)).toBe(false)
    touch(breezeMark(dir))
    expect(breezeComplete(dir)).toBe(true)
    // The mark goes as the voices download again (index.ts, and the weights step itself).
    rmSync(breezeMark(dir))
    expect(breezeComplete(dir)).toBe(false)
  })

  it('counts MCreader’s copy, which has no mark, only when all of its weights are there', () => {
    const tts = join(dir, 'tts')
    touch(venvPython(join(tts, 'venvs', 'breeze')))
    touch(join(breezeCodeDir(tts), 'breeze_infer', '__init__.py'))
    touch(join(breezeWeightsDir(tts), 'snapshots', 'abc', 'config.json'))
    expect(breezeComplete(tts, process.platform, false)).toBe(false)
    // One of the two shards its index names is missing.
    weightsIn(tts, 'abc', [SHARDS[0]])
    expect(breezeWeightsWhole(tts)).toBe(false)
    touch(join(breezeWeightsDir(tts), 'snapshots', 'abc', SHARDS[1]))
    expect(breezeComplete(tts, process.platform, false)).toBe(true)
    // A file Hugging Face was still fetching when it stopped.
    touch(join(breezeWeightsDir(tts), 'blobs', '9f8e7d.incomplete'))
    expect(breezeComplete(tts, process.platform, false)).toBe(false)
  })

  it('reads the snapshot the server loads: the one refs/main names', () => {
    weightsIn(dir, 'old')
    weightsIn(dir, 'new', [SHARDS[0]])
    touch(join(breezeWeightsDir(dir), 'refs', 'main'), 'new\n')
    expect(breezeWeightsWhole(dir)).toBe(false)
    touch(join(breezeWeightsDir(dir), 'refs', 'main'), 'old')
    expect(breezeWeightsWhole(dir)).toBe(true)
  })

  it('finds Parakeet only with all four of its files in one folder, never one being unpacked', () => {
    const p = join(dir, 'p')
    expect(parakeetFiles(p)).toBe(false)
    touch(join(p, 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8', 'encoder.int8.onnx'))
    expect(parakeetFiles(p)).toBe(false)
    for (const f of PARAKEET_FILES) touch(join(p, '.unpack', 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8', f))
    for (const f of PARAKEET_FILES) touch(join(p, '.unpack', f))
    expect(parakeetFiles(p)).toBe(false)
    parakeetIn(p)
    expect(parakeetFiles(p)).toBe(true)
    // Or straight in its folder.
    for (const f of PARAKEET_FILES) touch(join(dir, 'q', f))
    expect(parakeetFiles(join(dir, 'q'))).toBe(true)
  })

  it('finds Whisper only with all of its files, nothing half-downloaded', () => {
    const w = join(dir, 'w')
    const cache = join(w, 'models--Systran--faster-whisper-base.en')
    expect(whisperFiles(w)).toBe(false)
    touch(join(cache, 'snapshots', 'rev', 'config.json'))
    touch(join(cache, 'snapshots', 'rev', 'model.bin'))
    expect(whisperFiles(w)).toBe(false)
    whisperIn(w)
    expect(whisperFiles(w)).toBe(true)
    touch(join(cache, 'blobs', 'abc.incomplete'))
    expect(whisperFiles(w)).toBe(false)
  })

  it('reads a missing or broken record as nothing', () => {
    expect(readManifest(join(dir, 'none.json'))).toEqual({})
    writeFileSync(join(dir, 'bad.json'), '{ not json')
    expect(readManifest(join(dir, 'bad.json'))).toEqual({})
  })
})

describe('MCreader v2’s copy of the voices', () => {
  it('is looked for where MCREADER_TTS_DIR says first, then where code is usually kept', () => {
    const c = mcreaderCandidates({ MCREADER_TTS_DIR: '/x/tts' }, '/home/adam', 'linux')
    expect(c[0]).toBe('/x/tts')
    expect(c).toContain(join('/home/adam', 'mcreader-v2', 'tts'))
    expect(c).toContain(join('/home/adam', 'Documents', 'GitHub', 'mcreader-v2', 'tts'))
    expect(c.some((p) => p.startsWith('C:\\'))).toBe(false)
    // A drive's own folder too, on Windows (C:\mcreader-v2\tts).
    expect(mcreaderCandidates({}, 'C:\\Users\\Adam', 'win32').some((p) => /^C:\\[\\/]?mcreader-v2[\\/]tts$/.test(p))).toBe(true)
    expect(mcreaderCandidates({ MCREADER_TTS_DIR: '/x/tts' }, '/home/adam', 'linux', false)).toEqual(['/x/tts'])
  })

  it('is used only when its voices are complete', () => {
    const home = join(dir, 'home')
    const tts = join(home, 'Documents', 'GitHub', 'mcreader-v2', 'tts')
    touch(join(tts, 'requirements.txt'))
    expect(findMCreader({}, home, 'linux')).toBeNull()
    // Its voices downloading (or stopped part way): not offered.
    touch(venvPython(join(tts, 'venvs', 'breeze'), 'linux'))
    touch(join(breezeCodeDir(tts), 'breeze_infer', '__init__.py'))
    touch(join(breezeWeightsDir(tts), 'snapshots', 'abc', 'config.json'))
    expect(findMCreader({}, home, 'linux')).toBeNull()
    voicesIn(tts, false)
    expect(findMCreader({}, home, 'linux')).toBe(tts)
    expect(findMCreader({}, home, 'linux', false)).toBeNull()
  })

  it('can be found from MCreader’s own folder or its tts folder', () => {
    const app = join(dir, 'MCreader')
    voicesIn(join(app, 'tts'), false)
    expect(mcreaderVoicesIn(app)).toBe(join(app, 'tts'))
    expect(mcreaderVoicesIn(join(app, 'tts'))).toBe(join(app, 'tts'))
    expect(mcreaderVoicesIn(dir)).toBeNull()
  })
})
