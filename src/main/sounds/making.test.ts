import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SoundLibrary } from './library'
import {
  generateSound,
  GIVE_UP_AFTER,
  HOLD_MS,
  PAUSE_MS,
  PLAYING_MS,
  RETRY_MS,
  SoundMaker,
  TAKES,
  type MakeRequest,
  type MakeResult
} from './making'
import { silentWav } from './wav'

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aw-making-'))
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})
afterEach(() => {
  vi.restoreAllMocks()
  rmSync(dir, { recursive: true, force: true })
})

/** A maker with a real library and a speech server that answers as `answer` says. */
function harness(answer: (req: MakeRequest) => MakeResult = () => ({ ok: true, wav: silentWav(1), seconds: 1, score: 0.5 })) {
  let now = 1_000_000
  const lib = new SoundLibrary(join(dir, 'sounds'), () => now)
  const state = { enabled: true, ready: true, beside: true }
  const made: [string, boolean][] = []
  const retook: [string, boolean][] = []
  const asked: MakeRequest[] = []
  const maker = new SoundMaker({
    library: lib,
    enabled: () => state.enabled,
    ready: async () => state.ready,
    beside: async () => state.beside,
    generate: async (req) => {
      asked.push(req)
      return answer(req)
    },
    made: (id, ok) => made.push([id, ok]),
    retook: (id, ok) => retook.push([id, ok]),
    changed: () => undefined,
    now: () => now
  })
  const want = (description: string, kind: 'effect' | 'ambience' = 'effect'): string => lib.want(kind, description)!.id
  return { lib, maker, state, made, retook, asked, want, later: (ms: number) => (now += ms) }
}

describe('making the library’s sounds', () => {
  it('makes the reading’s sounds nearest first, then the rest, and Listen now before all', async () => {
    const h = harness()
    const [a, b, c, d] = ['a bell', 'a dog barking', 'a gunshot', 'an owl hooting'].map((x) => h.want(x))
    h.maker.background([c!])
    h.maker.forReading('w:s', [b!, a!])
    h.maker.first(d!)
    await h.maker.run()
    expect(h.asked.map((r) => r.prompt)).toEqual(['an owl hooting', 'a dog barking', 'a bell', 'a gunshot'])
    expect(h.asked[0]).toEqual({ prompt: 'an owl hooting', kind: 'effect', seconds: 3, takes: TAKES })
    expect(h.made).toEqual([d, b, a, c].map((id) => [id, true]))
    expect(h.lib.get(a!)?.state).toBe('ready')
    expect(h.maker.status()).toEqual({ making: null, waiting: 0 })
  })

  it('lets a reading’s new order replace its old one, and sends what it no longer wants to the back', async () => {
    const h = harness()
    const [a, b, c] = ['a bell', 'a dog barking', 'a gunshot'].map((x) => h.want(x))
    h.state.enabled = false
    h.maker.forReading('w:s', [a!, b!])
    h.maker.background([c!])
    h.maker.forReading('w:s', [c!])
    await h.maker.run()
    h.state.enabled = true
    await h.maker.run()
    expect(h.asked.map((r) => r.prompt)).toEqual(['a gunshot', 'a bell', 'a dog barking'])
  })

  it('makes nothing while sound effects are off or the sound model isn’t ready, then carries on', async () => {
    const h = harness()
    const a = h.want('a bell')
    h.state.enabled = false
    h.maker.background([a])
    await h.maker.run()
    h.state.enabled = true
    h.state.ready = false
    await h.maker.run()
    expect(h.asked).toEqual([])
    expect(h.maker.status()).toEqual({ making: null, waiting: 1 })
    h.state.ready = true
    await h.maker.run()
    expect(h.made).toEqual([[a, true]])
  })

  it('waits while a reading plays when the server can’t make sounds beside the voices', async () => {
    const h = harness()
    const a = h.want('a bell')
    h.state.beside = false
    h.maker.playing()
    h.maker.background([a])
    await h.maker.run()
    expect(h.asked).toEqual([])
    // The reading stopped.
    h.maker.stopped()
    await h.maker.run()
    expect(h.made).toEqual([[a, true]])
  })

  it('carries on beside a reading when the server can, and after a reading goes quiet', async () => {
    const h = harness()
    const [a, b] = [h.want('a bell'), h.want('a gong')]
    h.maker.playing()
    h.maker.background([a])
    await h.maker.run()
    expect(h.made).toHaveLength(1)
    h.state.beside = false
    h.maker.playing()
    h.later(PLAYING_MS + 1)
    h.maker.background([b])
    await h.maker.run()
    expect(h.made).toHaveLength(2)
  })

  it('tries a failed sound again later, gives up after a few failures, and tries again for Listen now', async () => {
    const h = harness(() => ({ ok: false, hold: false, error: '500 boom' }))
    const a = h.want('a bell')
    h.maker.background([a])
    for (let i = 1; i < GIVE_UP_AFTER; i++) {
      await h.maker.run()
      expect(h.lib.get(a)).toMatchObject({ state: 'waiting', failures: i })
      // Not again until a while later.
      await h.maker.run()
      expect(h.asked).toHaveLength(i)
      h.later(RETRY_MS + 1)
    }
    await h.maker.run()
    expect(h.lib.get(a)).toMatchObject({ state: 'failed', failures: GIVE_UP_AFTER })
    expect(h.made).toEqual([[a, false]])
    // Wanted by a reading: not made again by itself.
    h.maker.forReading('w:s', [a])
    await h.maker.run()
    expect(h.asked).toHaveLength(GIVE_UP_AFTER)
    // Listen now.
    h.lib.retry(a)
    h.maker.first(a)
    await h.maker.run()
    expect(h.asked).toHaveLength(GIVE_UP_AFTER + 1)
  })

  it('doesn’t count it against a sound when the server can’t make it now, and gives the others a turn', async () => {
    let busy = true
    const h = harness((req) =>
      busy && req.prompt === 'a bell' ? { ok: false, hold: true, error: '503 retry' } : { ok: true, wav: silentWav(1), seconds: 1, score: null }
    )
    const [a, b] = [h.want('a bell'), h.want('a gong')]
    h.maker.forReading('w:s', [a, b])
    await h.maker.run()
    // The bell waits (not counted), and the gong is made meanwhile rather than the bell being asked for again and again.
    expect(h.lib.get(a)).toMatchObject({ state: 'waiting', failures: 0 })
    expect(h.lib.get(b)?.state).toBe('ready')
    expect(h.asked.map((r) => r.prompt)).toEqual(['a bell', 'a gong'])
    await h.maker.run()
    expect(h.asked).toHaveLength(2)
    // It waits longer each time.
    h.later(HOLD_MS + 1)
    await h.maker.run()
    expect(h.asked).toHaveLength(3)
    h.later(HOLD_MS + 1)
    await h.maker.run()
    expect(h.asked).toHaveLength(3)
    busy = false
    h.later(HOLD_MS + 1)
    await h.maker.run()
    expect(h.lib.get(a)?.state).toBe('ready')
  })

  it('gives up at once on a description the server turns down', async () => {
    const h = harness(() => ({ ok: false, hold: false, final: true, error: '400 too long' }))
    const a = h.want('a bell')
    h.maker.background([a])
    await h.maker.run()
    expect(h.lib.get(a)).toMatchObject({ state: 'failed', failures: 1 })
    expect(h.made).toEqual([[a, false]])
  })

  it('rests the whole queue, longer each time, when the server can’t make any sound', async () => {
    const h = harness(() => ({ ok: false, hold: false, serverWide: true, error: '503 not downloaded' }))
    const ids = [h.want('a bell'), h.want('a gong'), h.want('a horn')]
    h.maker.background(ids)
    await h.maker.run()
    // One try, not one per sound: the model isn't loaded again and again.
    expect(h.asked).toHaveLength(1)
    h.later(PAUSE_MS + 1)
    await h.maker.run()
    expect(h.asked).toHaveLength(2)
    // Twice as long now.
    h.later(PAUSE_MS + 1)
    await h.maker.run()
    expect(h.asked).toHaveLength(2)
    h.later(PAUSE_MS)
    await h.maker.run()
    expect(h.asked).toHaveLength(3)
  })

  it('isn’t started, and doesn’t look again, while sound effects are off', async () => {
    vi.useFakeTimers()
    try {
      const h = harness()
      h.state.enabled = false
      h.maker.background([h.want('a bell')])
      await h.maker.run()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('skips sounds already made or no longer in the library', async () => {
    const h = harness()
    const a = h.want('a bell')
    await h.lib.saveClip(a, silentWav(1), 1)
    h.maker.background([a, '0123456789abcdef'])
    await h.maker.run()
    expect(h.asked).toEqual([])
    expect(h.maker.status().waiting).toBe(0)
  })

  it('keeps making the library’s sounds when the world closes, in the order they were wanted', async () => {
    const h = harness()
    const [a, b] = [h.want('a bell'), h.want('a gong')]
    h.state.enabled = false
    h.maker.background([a])
    h.maker.forReading('w:s', [b])
    h.maker.dropReadings()
    h.state.enabled = true
    await h.maker.run()
    expect(h.asked.map((r) => r.prompt)).toEqual(['a bell', 'a gong'])
  })
})

describe('making a new take', () => {
  it('makes a made sound afresh, first, with its seed, and says so', async () => {
    const h = harness()
    const [a, b] = [h.want('a bell'), h.want('a gong')]
    await h.lib.saveClip(a, silentWav(1), 1)
    h.lib.startRetake(a)
    h.maker.background([b])
    h.maker.first(a)
    await h.maker.run()
    expect(h.asked.map((r) => r.prompt)).toEqual(['a bell', 'a gong'])
    expect(h.asked[0]!.seed).toBe(h.lib.get(a)!.seed)
    expect(h.asked[1]).not.toHaveProperty('seed')
    expect(h.lib.get(a)).toMatchObject({ state: 'ready', retake: 'ready' })
    expect(h.retook).toEqual([[a, true]])
    expect(h.made).toEqual([
      [a, true],
      [b, true]
    ])
  })

  it('leaves the sound playing as it was while the new take waits or fails', async () => {
    let busy = true
    const h = harness(() => (busy ? { ok: false, hold: true, error: '503 retry' } : { ok: false, hold: false, error: '500 boom' }))
    const a = h.want('a bell')
    await h.lib.saveClip(a, silentWav(1), 1)
    h.lib.startRetake(a)
    h.maker.first(a)
    await h.maker.run()
    expect(h.lib.get(a)).toMatchObject({ state: 'ready', retake: 'making' })
    busy = false
    for (let i = 0; i < GIVE_UP_AFTER; i++) {
      h.later(RETRY_MS + 1)
      await h.maker.run()
    }
    expect(h.lib.get(a)).toMatchObject({ state: 'ready', failures: 0 })
    expect(h.lib.get(a)!.retake).toBeUndefined()
    expect(h.retook).toEqual([[a, false]])
    expect(h.made).toEqual([])
  })

  it('isn’t made once called off', async () => {
    const h = harness()
    const a = h.want('a bell')
    await h.lib.saveClip(a, silentWav(1), 1)
    h.state.enabled = false
    h.lib.startRetake(a)
    h.maker.first(a)
    await h.lib.keepTake(a, false)
    h.state.enabled = true
    await h.maker.run()
    expect(h.asked).toEqual([])
  })
})

describe('asking the speech server for a sound', () => {
  const wav = silentWav(2, 44_100, 2)
  const reply = (status: number, body: ConstructorParameters<typeof Response>[0], headers: Record<string, string> = {}): Response =>
    new Response(body, { status, headers })

  it('sends the description and takes, and keeps the WAV with its length and score', async () => {
    const fetcher = vi.fn(async (_path: string, _init: RequestInit) => reply(200, new Uint8Array(wav), { 'x-sound-score': '0.42', 'x-sound-seconds': '1.95' }))
    const got = await generateSound(fetcher, { prompt: 'a door slamming', kind: 'effect', seconds: 2, takes: 3 })
    expect(got).toMatchObject({ ok: true, seconds: 1.95, score: 0.42 })
    expect(fetcher.mock.calls[0]![0]).toBe('/sounds/generate')
    expect(JSON.parse(String((fetcher.mock.calls[0]![1] as RequestInit).body))).toEqual({ prompt: 'a door slamming', kind: 'effect', seconds: 2, takes: 3 })
    // No headers: its length from the WAV, no score.
    const plain = await generateSound(async () => reply(200, new Uint8Array(wav)), { prompt: 'x', kind: 'effect', seconds: 2, takes: 3 })
    expect(plain).toMatchObject({ ok: true, seconds: 2, score: null })
  })

  it('waits when the server says to try later, and counts every other failure', async () => {
    const req: MakeRequest = { prompt: 'x', kind: 'effect', seconds: 2, takes: 3 }
    // The voices are reading, it was interrupted for them, or it ran out of memory: try later.
    expect(await generateSound(async () => reply(503, '{"detail":"Breeze is reading"}', { 'x-sound-retry': '1' }), req)).toMatchObject({
      ok: false,
      hold: true
    })
    // Not downloaded there, or it can't load: counted, and the queue rests.
    expect(await generateSound(async () => reply(503, 'Not downloaded yet.'), req)).toMatchObject({ ok: false, hold: false, serverWide: true })
    // A description it won't make: given up on at once.
    expect(await generateSound(async () => reply(400, 'Say what the sound is.'), req)).toMatchObject({ ok: false, hold: false, final: true })
    expect(await generateSound(async () => reply(500, 'boom'), req)).toMatchObject({ ok: false, hold: false })
    expect(await generateSound(async () => reply(200, 'not a wav'), req)).toMatchObject({ ok: false, hold: false })
  })

  it('waits for a server that isn’t answering, but counts one cut off while it was making the sound', async () => {
    const req: MakeRequest = { prompt: 'x', kind: 'effect', seconds: 2, takes: 3 }
    const refused = async (): Promise<Response> => {
      throw new Error('not running')
    }
    expect(await generateSound(refused, req, () => false)).toMatchObject({ ok: false, hold: true })
    expect(await generateSound(refused, req, () => true)).toMatchObject({ ok: false, hold: false })
  })

  it('counts running out of time as a failure, not a wait', async () => {
    const req: MakeRequest = { prompt: 'x', kind: 'effect', seconds: 2, takes: 3 }
    const hangs = (_path: string, init: RequestInit): Promise<Response> =>
      new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted'))))
    expect(await generateSound(hangs, req, () => false, 20)).toMatchObject({ ok: false, hold: false, error: expect.stringContaining('no sound') })
  })
})
