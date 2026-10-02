import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { breezeComplete, installedNow, parakeetFiles, readManifest, whisperFiles, writeManifest } from './installed'
import { findMCreader, mcreaderCandidates, mcreaderVoicesIn } from './mcreader'
import { breezeCodeDir, breezeWeightsDir, speechPaths, venvPython } from './paths'

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aiwrite-speech-installed-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function touch(file: string): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, '')
}

/** What a finished voices download leaves under `root` (AI Write's speech folder, or MCreader's tts folder). */
function voicesIn(root: string): void {
  touch(venvPython(join(root, 'venvs', 'breeze')))
  touch(join(breezeCodeDir(root), 'breeze_infer', '__init__.py'))
  touch(join(breezeWeightsDir(root), 'snapshots', 'a1b2c3', 'config.json'))
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
    touch(join(p.parakeet, 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8', 'encoder.int8.onnx'))
    touch(join(p.whisper, 'models--Systran--faster-whisper-base.en', 'snapshots', 'x', 'model.bin'))
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
    touch(join(breezeWeightsDir(dir), 'snapshots', 'abc', 'config.json'))
    expect(breezeComplete(dir)).toBe(true)
  })

  it('finds each dictation model as it unpacks', () => {
    expect(parakeetFiles(join(dir, 'p'))).toBe(false)
    touch(join(dir, 'p', 'encoder.int8.onnx'))
    expect(parakeetFiles(join(dir, 'p'))).toBe(true)
    expect(whisperFiles(join(dir, 'w'))).toBe(false)
    touch(join(dir, 'w', 'models--Systran--faster-whisper-base.en', 'snapshots', 'rev', 'model.bin'))
    expect(whisperFiles(join(dir, 'w'))).toBe(true)
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
    voicesIn(tts)
    expect(findMCreader({}, home, 'linux')).toBe(tts)
    expect(findMCreader({}, home, 'linux', false)).toBeNull()
  })

  it('can be found from MCreader’s own folder or its tts folder', () => {
    const app = join(dir, 'MCreader')
    voicesIn(join(app, 'tts'))
    expect(mcreaderVoicesIn(app)).toBe(join(app, 'tts'))
    expect(mcreaderVoicesIn(join(app, 'tts'))).toBe(join(app, 'tts'))
    expect(mcreaderVoicesIn(dir)).toBeNull()
  })
})
