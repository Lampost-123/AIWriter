import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startFakeSpeech, type FakeSpeech, type FakeSpeechOptions } from '../../../tests/fake-speech/server.mjs'
import { askToShutDown, fetchHealth, freePort, listenOn, logTail, pickDictation, portFree, rootOf } from './server'
import { buildStatus, deviceName, readHealth, startProblem, type StatusParts } from './status'

let fake: FakeSpeech | null = null
const start = async (options: FakeSpeechOptions = {}): Promise<FakeSpeech> => (fake = await startFakeSpeech(options))
afterEach(async () => {
  await fake?.close()
  fake = null
})

function parts(over: Partial<StatusParts> = {}): StatusParts {
  return {
    managed: false,
    starting: false,
    health: null,
    problem: '',
    installed: { server: false, voices: null, parakeet: false, whisper: false },
    nvidia: null,
    mcreader: null,
    download: null,
    queued: [],
    hfKey: false,
    folder: '/data/speech',
    address: 'http://127.0.0.1:8766/v1',
    ...over
  }
}

describe('what the server says about itself', () => {
  it('reads its /v1/health: the voices, the device and the dictation model', async () => {
    const f = await start({ dictationEngine: 'whisper' })
    const h = await fetchHealth(f.url)
    expect(h).toEqual({
      service: 'aiwrite-speech',
      device: 'CUDA · NVIDIA GeForce RTX 4090',
      voices: { ready: true, loaded: false },
      dictation: { engine: 'whisper', loaded: null, parakeet: true, whisper: true }
    })
  })

  it('follows what is downloaded there and what is loaded', async () => {
    const options: FakeSpeechOptions = { voices: false, parakeet: false }
    const f = await start(options)
    expect((await fetchHealth(f.url))?.voices.ready).toBe(false)
    expect((await fetchHealth(f.url))?.dictation).toMatchObject({ engine: 'parakeet', parakeet: false, whisper: true })
    expect(await pickDictation(f.url, 'whisper')).toEqual({ ok: true, detail: '' })
    expect((await fetchHealth(f.url))?.dictation).toMatchObject({ engine: 'whisper', loaded: 'whisper' })
    const refused = await pickDictation(f.url, 'parakeet')
    expect(refused.ok).toBe(false)
    expect(refused.detail).toMatch(/Parakeet is not installed/)
    options.voices = true
    expect((await fetchHealth(f.url))?.voices.ready).toBe(true)
  })

  it('reads what the server finds in AI Write’s speech folder when it is AI Write’s own', async () => {
    const home = mkdtempSync(join(tmpdir(), 'aiwrite-speech-home-'))
    try {
      const f = await start({ home })
      expect(await fetchHealth(f.url)).toMatchObject({ voices: { ready: false }, dictation: { parakeet: false, whisper: false } })
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('is nothing when nothing answers, or something else does', async () => {
    const port = await freePort('127.0.0.1', 18766, 18866)
    expect(await fetchHealth(`http://127.0.0.1:${port}/v1`, 500)).toBeNull()
    expect(readHealth({ ok: false })).toBeNull()
    expect(readHealth('hello')).toBeNull()
    // MCreader's own server: voices, no dictation.
    expect(readHealth({ ok: true, device: 'CPU', engines: [{ id: 'breeze', ready: true, loaded: true }] })).toEqual({
      service: '',
      device: 'CPU',
      voices: { ready: true, loaded: true },
      dictation: null
    })
  })

  it('stops when asked, politely (only for a JSON request)', async () => {
    const f = await start()
    expect(await askToShutDown(f.url)).toBe(true)
    await new Promise((r) => setTimeout(r, 100))
    expect(await fetchHealth(f.url, 500)).toBeNull()
    const refused = await fetch(`${rootOf((await start()).url)}/shutdown`, { method: 'POST', body: 'x' })
    expect(refused.status).toBe(415)
  })
})

describe('the status Settings shows', () => {
  it('is Not running, Starting or Connected', () => {
    expect(buildStatus(parts()).server).toBe('not-running')
    expect(buildStatus(parts({ starting: true })).server).toBe('starting')
    const health = { service: 'aiwrite-speech', device: 'CPU', voices: { ready: true, loaded: false }, dictation: null }
    expect(buildStatus(parts({ health })).server).toBe('connected')
  })

  it('says what is ready and loaded, and where it runs', () => {
    const s = buildStatus(
      parts({
        health: {
          service: 'aiwrite-speech',
          device: 'CUDA · NVIDIA GeForce RTX 4090',
          voices: { ready: true, loaded: true },
          dictation: { engine: 'parakeet', loaded: 'parakeet', parakeet: true, whisper: false }
        }
      })
    )
    expect(s).toMatchObject({
      voicesReady: true,
      dictationReady: true,
      loaded: { voices: true, dictation: 'parakeet' },
      device: 'NVIDIA GeForce RTX 4090'
    })
  })

  it('counts dictation ready only when the model the server picked is downloaded there', () => {
    const health = (engine: 'none' | 'parakeet' | 'whisper', parakeet: boolean) => ({
      service: 'aiwrite-speech',
      device: 'CPU',
      voices: { ready: false, loaded: false },
      dictation: { engine, loaded: null, parakeet, whisper: false }
    })
    expect(buildStatus(parts({ health: health('parakeet', true) })).dictationReady).toBe(true)
    expect(buildStatus(parts({ health: health('parakeet', false) })).dictationReady).toBe(false)
    expect(buildStatus(parts({ health: health('none', true) })).dictationReady).toBe(false)
    expect(buildStatus(parts({ health: health('whisper', true) })).dictationReady).toBe(false)
    expect(buildStatus(parts()).dictationReady).toBe(false)
  })

  it('shows a problem only while nothing is running or starting', () => {
    expect(buildStatus(parts({ problem: 'It stopped.' })).problem).toBe('It stopped.')
    expect(buildStatus(parts({ problem: 'It stopped.', starting: true })).problem).toBe('')
  })

  it('names the device in plain words', () => {
    expect(deviceName('CPU')).toBe('Processor')
    expect(deviceName('CUDA · NVIDIA GeForce RTX 3060')).toBe('NVIDIA GeForce RTX 3060')
    expect(deviceName('cuda: NVIDIA RTX A4000')).toBe('NVIDIA RTX A4000')
    expect(deviceName('CUDA')).toBe('Graphics card')
    expect(deviceName('')).toBe('')
  })

  it('explains a server that stopped while starting, from its log', () => {
    expect(startProblem('ERROR: [Errno 98] error while attempting to bind on address: address already in use', 8766)).toMatch(
      /Another program is using port 8766/
    )
    expect(startProblem('[WinError 10048] Only one usage of each socket address', 8766)).toMatch(/http:\/\/127\.0\.0\.1:8767\/v1/)
    expect(startProblem("ModuleNotFoundError: No module named 'fastapi'", 8766)).toMatch(/Part of the speech engine is missing/)
    expect(startProblem('Traceback ... KeyError', 8766)).toMatch(/stopped while starting/)
  })
})

describe('where the server listens', () => {
  let blocker: Server | null = null
  afterEach(() => {
    blocker?.close()
    blocker = null
  })

  it('takes its host and port from the address', () => {
    expect(listenOn('http://127.0.0.1:8766/v1')).toEqual({ host: '127.0.0.1', port: 8766 })
    expect(listenOn('http://localhost:9001/v1')).toEqual({ host: '127.0.0.1', port: 9001 })
    expect(listenOn('http://[::1]:8766/v1')).toEqual({ host: '::1', port: 8766 })
    expect(rootOf('http://127.0.0.1:8766/v1')).toBe('http://127.0.0.1:8766')
  })

  it('moves to the next free port when another program has it', async () => {
    const port = (await freePort('127.0.0.1', 28766, 28866)) as number
    expect(await portFree('127.0.0.1', port)).toBe(true)
    blocker = createServer()
    await new Promise<void>((r) => blocker!.listen(port, '127.0.0.1', () => r()))
    expect(await portFree('127.0.0.1', port)).toBe(false)
    const next = await freePort('127.0.0.1', port, port + 40)
    expect(next).not.toBe(port)
    expect(next).toBeGreaterThan(port)
  })

  it('reads the end of its log', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aiwrite-speech-log-'))
    try {
      const file = join(dir, 'server.log')
      writeFileSync(file, Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n'))
      expect(logTail(file, 3)).toBe('line 28\nline 29\nline 30')
      expect(logTail(join(dir, 'missing.log'))).toBe('')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
