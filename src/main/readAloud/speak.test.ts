import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClipRequest } from '@shared/contracts/readAloud'
import { AudioCache } from './audioCache'
import { clipKey, speak, speechPayload, SPEECH_FAILED, VOICES_NOT_READY, type Fetcher } from './speak'
import { listVoices, voicesFrom } from './voices'

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aw-speak-'))
})
afterEach(() => {
  vi.restoreAllMocks()
  rmSync(dir, { recursive: true, force: true })
})

const clip: ClipRequest = {
  input: 'Get out,',
  voice: 'narrator',
  voiceDesign: 'A low, dry voice.',
  instruct: '',
  delivery: 'sharp and irritated',
  pace: '',
  gentle: false,
  sounds: true
}
const wav = (): Response => new Response(new Uint8Array(400), { status: 200, headers: { 'content-type': 'audio/wav' } })

/** A speech server that answers each request with `answer`, and remembers what it was sent. */
function server(answer: () => Response | Promise<Response>): { fetcher: Fetcher; sent: { path: string; body: unknown }[] } {
  const sent: { path: string; body: unknown }[] = []
  return {
    sent,
    fetcher: async (path, init) => {
      sent.push({ path, body: init.body ? JSON.parse(String(init.body)) : null })
      return answer()
    }
  }
}

describe('asking the speech server for a clip', () => {
  it('sends what MCreader sends, at the server’s own pace', () => {
    expect(speechPayload(clip)).toEqual({
      model: 'breeze',
      input: 'Get out,',
      voice: 'narrator',
      speed: 1,
      response_format: 'wav',
      sfx: true,
      voice_design: 'A low, dry voice.',
      delivery: 'sharp and irritated'
    })
  })

  it('speaks a clip once, and plays it from the disk after', async () => {
    const s = server(wav)
    const cache = new AudioCache(dir, () => 10_000_000)
    const [a, b] = await Promise.all([speak(clip, cache, 'breeze', s.fetcher), speak(clip, cache, 'breeze', s.fetcher)])
    expect(a.length).toBe(400)
    expect(b.length).toBe(400)
    expect(await speak(clip, cache, 'breeze', s.fetcher)).toHaveLength(400)
    expect(s.sent).toHaveLength(1)
    expect(s.sent[0].path).toBe('/audio/speech')
    expect(await cache.get(clipKey(clip))).not.toBeNull()
  })

  it('says in plain words when the voices aren’t ready, or a line can’t be read', async () => {
    // The server's own words go to the log only.
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const cache = new AudioCache(dir, () => 10_000_000)
    const busy = server(() => new Response('{"error":"CUDA out of memory"}', { status: 503 }))
    await expect(speak(clip, cache, 'breeze', busy.fetcher)).rejects.toMatchObject({ message: VOICES_NOT_READY, code: 'voices-not-ready' })
    const broken = server(() => new Response('Traceback...', { status: 500 }))
    await expect(speak({ ...clip, input: 'Other words.' }, cache, 'breeze', broken.fetcher)).rejects.toMatchObject({
      message: SPEECH_FAILED,
      code: 'speech-failed'
    })
    const empty = server(() => new Response(new Uint8Array(44)))
    await expect(speak({ ...clip, input: 'Third.' }, cache, 'breeze', empty.fetcher)).rejects.toMatchObject({ code: 'speech-failed' })
    // Nothing failed is kept.
    expect((await cache.stats()).files).toBe(0)
  })
})

describe('the voices on offer', () => {
  it('lists the engine’s voices in plain words, Adam’s own clips marked as his', async () => {
    const list = [
      { id: 'narrator', name: 'Narrator', engine: 'breeze', gender: 'female', traits: 'designed · warm, measured', recommended: true },
      { id: 'clip:gran.wav', name: 'gran', engine: 'breeze', gender: '', traits: 'your clip · gran.wav' },
      { id: 'other', name: 'Other', engine: 'kokoro' },
      { id: 'narrator', name: 'Again', engine: 'breeze' }
    ]
    expect(voicesFrom(list, 'breeze')).toEqual([
      { id: 'narrator', name: 'Narrator', about: 'female · warm, measured', clip: false, recommended: true },
      { id: 'clip:gran.wav', name: 'gran', about: 'Your own clip · gran.wav', clip: true, recommended: false }
    ])
    const s = server(() => new Response(JSON.stringify(list)))
    expect(await listVoices('breeze', s.fetcher)).toHaveLength(2)
    expect(s.sent[0].path).toBe('/voices?engine=breeze')
  })

  it('says the voices aren’t ready when the engine isn’t', async () => {
    const s = server(() => new Response('', { status: 503 }))
    await expect(listVoices('breeze', s.fetcher)).rejects.toMatchObject({ code: 'voices-not-ready' })
  })
})
