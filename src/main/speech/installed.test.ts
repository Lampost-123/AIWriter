import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  breezeComplete,
  CLAP_FILES,
  installedNow,
  PARAKEET_FILES,
  parakeetFiles,
  readManifest,
  snapshotWith,
  SOUND_FILES,
  soundsComplete,
  WHISPER_FILES,
  whisperFiles,
  writeManifest
} from './installed'
import { breezeCodeDir, breezeMark, breezeWeightsDir, clapWeightsDir, soundMark, soundWeightsDir, speechPaths, venvPython } from './paths'

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aiwrite-speech-installed-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function touch(file: string, text = ''): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text)
}

/** What Breeze reads to speak besides its shards (its tokenizer and the audio codec). */
const BREEZE_NEEDS = ['config.json', 'tokenizer.json', 'tokenizer_config.json', join('audio_tokenizer', 'model.safetensors')]
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

/** What a finished voices download leaves under `root`, with the mark its last step leaves. */
function voicesIn(root: string): void {
  touch(venvPython(join(root, 'venvs', 'breeze')))
  touch(join(breezeCodeDir(root), 'breeze_infer', '__init__.py'))
  weightsIn(root)
  touch(breezeMark(root))
}

/** What a finished sound effects download leaves under `root`: its environment, both models, and its mark. */
function soundsIn(root: string, weights = 'model.safetensors'): void {
  touch(venvPython(join(root, 'venvs', 'sound')))
  for (const f of SOUND_FILES) touch(join(soundWeightsDir(root), 'snapshots', 'r1', ...f.split('/')))
  for (const f of [...CLAP_FILES, weights]) touch(join(clapWeightsDir(root), 'snapshots', 'r2', f))
  touch(soundMark(root))
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
    const p = speechPaths(join('/data', 'app'), join('/res', 'speech-server'), 'linux')
    expect(p.home).toBe(join('/data', 'app', 'speech'))
    expect(p.python).toBe(join(p.home, 'venv', 'bin', 'python'))
    expect(p.serve).toBe(p.python)
    expect(p.breezePython).toBe(join(p.home, 'venvs', 'breeze', 'bin', 'python'))
    expect(p.soundPython).toBe(join(p.home, 'venvs', 'sound', 'bin', 'python'))
    // The sound effects' models share the voices' Hugging Face cache.
    expect(soundWeightsDir(p.home)).toBe(join(p.home, 'models', 'hf', 'hub', 'models--stabilityai--stable-audio-open-1.0'))
    expect(clapWeightsDir(p.home)).toBe(join(p.home, 'models', 'hf', 'hub', 'models--laion--larger_clap_general'))
    expect(soundMark(p.home)).toBe(join(p.home, 'models', 'sound', '.ready'))
    expect(p.logs).toBe(join(p.home, 'logs'))
    expect(p.manifest).toBe(join(p.home, 'installed.json'))
    expect(p.parakeet).toBe(join(p.home, 'models', 'parakeet'))
    expect(p.whisper).toBe(join(p.home, 'models', 'whisper'))
  })

  it('runs the server with pythonw on Windows, so no console window opens', () => {
    const p = speechPaths('C:\\Users\\Adam\\AppData\\Roaming\\AI Write', 'C:\\Program Files\\AI Write\\resources\\speech-server', 'win32')
    expect(p.python).toMatch(/Scripts[\\/]python\.exe$/)
    expect(p.serve).toMatch(/Scripts[\\/]pythonw\.exe$/)
  })
})

describe('what is downloaded', () => {
  it('is nothing at first', () => {
    const p = speechPaths(dir, '/src')
    expect(installedNow(p, readManifest(p.manifest))).toEqual({ server: false, voices: null, parakeet: false, whisper: false, sounds: false })
  })

  it('is each download that finished and whose files are still there', () => {
    const p = speechPaths(dir, '/src')
    touch(p.python)
    voicesIn(p.home)
    parakeetIn(p.parakeet)
    whisperIn(p.whisper)
    soundsIn(p.home)
    // Files without a finished download (one stopped part way) don't count.
    expect(installedNow(p, {})).toEqual({ server: false, voices: null, parakeet: false, whisper: false, sounds: false })
    const at = new Date().toISOString()
    writeManifest(p.manifest, {
      server: { at, python: '/usr/bin/python3.13' },
      voices: { at, from: 'own', root: p.home, gpu: 'RTX' },
      parakeet: { at },
      whisper: { at },
      sounds: { at }
    })
    expect(installedNow(p, readManifest(p.manifest))).toEqual({ server: true, voices: 'own', parakeet: true, whisper: true, sounds: true })
  })

  it('is not what was deleted by hand', () => {
    const p = speechPaths(dir, '/src')
    voicesIn(p.home)
    const manifest = { voices: { at: 'now', from: 'own' as const, root: p.home, gpu: '' } }
    expect(installedNow(p, manifest).voices).toBe('own')
    rmSync(breezeWeightsDir(p.home), { recursive: true })
    expect(installedNow(p, manifest).voices).toBeNull()
  })

  it('is only ever AI Write’s own copy of the voices, never another app’s folder', () => {
    const p = speechPaths(dir, '/src')
    const other = join(dir, 'mcreader-v2', 'tts')
    voicesIn(other)
    // A test build of 0.4.0 could record MCreader's folder here: it doesn't count, so Settings offers the download.
    const manifest = JSON.parse(JSON.stringify({ voices: { at: 'now', from: 'mcreader', root: other, gpu: '' } }))
    expect(installedNow(p, manifest).voices).toBeNull()
    expect(installedNow(p, { voices: { at: 'now', from: 'own', root: other, gpu: '' } }).voices).toBeNull()
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

  it('reads the snapshot the server loads: the one refs/main names', () => {
    weightsIn(dir, 'old')
    weightsIn(dir, 'new', [SHARDS[0]])
    touch(join(breezeWeightsDir(dir), 'refs', 'main'), 'new\n')
    expect(snapshotWith(breezeWeightsDir(dir), SHARDS)).toBeNull()
    touch(join(breezeWeightsDir(dir), 'refs', 'main'), 'old')
    expect(snapshotWith(breezeWeightsDir(dir), SHARDS)).toBe(join(breezeWeightsDir(dir), 'snapshots', 'old'))
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

  it('needs all of the sound effects: their environment, both models whole, and their last step’s mark', () => {
    const root = join(dir, 'speech')
    expect(soundsComplete(root)).toBe(false)
    soundsIn(root)
    expect(soundsComplete(root)).toBe(true)
    // Either copy of CLAP's weights does (the converted one, or the original when that's gone).
    rmSync(join(clapWeightsDir(root), 'snapshots', 'r2', 'model.safetensors'))
    expect(soundsComplete(root)).toBe(false)
    touch(join(clapWeightsDir(root), 'snapshots', 'r2', 'pytorch_model.bin'))
    expect(soundsComplete(root)).toBe(true)
    // A download started again removes the mark: until its check, they aren't done.
    rmSync(soundMark(root))
    expect(soundsComplete(root)).toBe(false)
    touch(soundMark(root))
    // A part of Stable Audio Open missing, or a file half-fetched, isn't whole.
    rmSync(join(soundWeightsDir(root), 'snapshots', 'r1', 'vae', 'diffusion_pytorch_model.safetensors'))
    expect(soundsComplete(root)).toBe(false)
    touch(join(soundWeightsDir(root), 'snapshots', 'r1', 'vae', 'diffusion_pytorch_model.safetensors'))
    touch(join(soundWeightsDir(root), 'blobs', 'abc.incomplete'))
    expect(soundsComplete(root)).toBe(false)
    rmSync(join(soundWeightsDir(root), 'blobs'), { recursive: true })
    expect(soundsComplete(root)).toBe(true)
    // Nor without their environment.
    rmSync(join(root, 'venvs', 'sound'), { recursive: true })
    expect(soundsComplete(root)).toBe(false)
  })

  it('reads a missing or broken record as nothing', () => {
    expect(readManifest(join(dir, 'none.json'))).toEqual({})
    writeFileSync(join(dir, 'bad.json'), '{ not json')
    expect(readManifest(join(dir, 'bad.json'))).toEqual({})
  })
})
