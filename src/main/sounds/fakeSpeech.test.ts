// The sounds code against the fake speech server (tests/fake-speech/): making a sound, waiting while the voices
// have the graphics card, failures, and timing a clip's words.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { startFakeSpeech, type FakeSpeech, type FakeSpeechOptions } from '../../../tests/fake-speech/server.mjs'
import type { Fetcher } from '../readAloud/speak'
import { CueTimer, hearClip, type ClipStore } from './align'
import { generateSound, type MakeRequest } from './making'
import { silentWav, wavInfo } from './wav'

let speech: FakeSpeech
const options: FakeSpeechOptions = {}
beforeAll(async () => {
  speech = await startFakeSpeech(options)
})
afterAll(async () => {
  await speech.close()
})

/** As speechFetch reaches it: the path after /v1, AI Write's header. */
const fetcher: Fetcher = (path, init) => {
  const { timeoutMs = 60_000, signal, ...rest } = init
  const timeout = AbortSignal.timeout(timeoutMs)
  const headers = new Headers(rest.headers)
  headers.set('X-AIWrite', 'speech')
  return fetch(`${speech.url}${path}`, { ...rest, headers, signal: signal ? AbortSignal.any([signal, timeout]) : timeout })
}

const reset = (o: FakeSpeechOptions = {}): void => {
  for (const k of Object.keys(options)) delete options[k]
  Object.assign(options, o)
}

const door: MakeRequest = { prompt: 'a heavy wooden door slamming shut', kind: 'effect', seconds: 2, takes: 3 }

describe('making a sound on the fake speech server', () => {
  it('gets a 44.1 kHz stereo WAV with its length and score', async () => {
    reset()
    const got = await generateSound(fetcher, door)
    expect(got).toMatchObject({ ok: true, seconds: 2, score: 0.25 })
    if (!got.ok) throw new Error('not made')
    expect(wavInfo(got.wav)).toMatchObject({ sampleRate: 44_100, channels: 2, bitsPerSample: 16 })
  })

  it('waits while the voices have the graphics card', async () => {
    reset({ soundsBusy: true })
    expect(await generateSound(fetcher, door, () => true)).toMatchObject({ ok: false, hold: true })
  })

  it('counts a sound model that won’t load, and gives up on a description it turns down', async () => {
    reset({ soundsLoadError: 'CUDA out of memory' })
    expect(await generateSound(fetcher, door, () => true)).toMatchObject({ ok: false, hold: false, serverWide: true })
    reset({ sounds: false })
    expect(await generateSound(fetcher, door, () => true)).toMatchObject({ ok: false, hold: false, serverWide: true })
    reset()
    expect(await generateSound(fetcher, { ...door, prompt: 'x'.repeat(301) }, () => true)).toMatchObject({ ok: false, final: true })
  })

  it('counts running out of time as a failure', async () => {
    reset({ soundsDelayMs: 500 })
    expect(await generateSound(fetcher, door, () => true, 50)).toMatchObject({ ok: false, hold: false })
  })
})

describe('timing a clip’s words on the fake speech server', () => {
  const text = 'Behind him, the door slammed shut.'
  const KEY = 'c'.repeat(64)
  const wav = silentWav(3.4)
  const cache = (): ClipStore & { extras: Map<string, string> } => {
    const extras = new Map<string, string>()
    return {
      extras,
      get: async (key) => (key === KEY ? wav : null),
      getExtra: async (key, name) => extras.get(`${key}.${name}`) ?? null,
      putExtra: async (key, name, data) => void extras.set(`${key}.${name}`, data)
    }
  }

  it('hears the words and times the anchor by them', async () => {
    reset({ aligner: 'whisper', alignWords: 'Behind him the door slammed shut' })
    const heard = await hearClip(fetcher, wav)
    expect(heard).toMatchObject({ v: 1, engine: 'whisper' })
    const timer = new CueTimer(cache(), fetcher)
    const { seconds, aligned } = await timer.times({ key: KEY, text, from: 0, to: text.length, at: [text.indexOf('slammed')] })
    expect(aligned).toBe(true)
    // Six words over 3.4 s: "slammed" is the fifth.
    expect(seconds[0]).toBeCloseTo((4 * 3.4) / 6, 2)
  })

  it('estimates when the server has no dictation model', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    reset({ aligner: null })
    expect(await hearClip(fetcher, wav)).toBe('no-aligner')
    const timer = new CueTimer(cache(), fetcher)
    expect(await timer.times({ key: KEY, text, from: 0, to: text.length, at: [17] })).toEqual({ seconds: [1.7], aligned: false })
  })
})
