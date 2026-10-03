import { describe, expect, it, vi } from 'vitest'
import { ALIGN_TIMEOUT_MS, alignedTimes, alignWords, CueTimer, estimateTimes, NO_ALIGNER_MS, pageWords, type ClipStore, type HeardWord } from './align'
import { silentWav, wavInfo, wavSeconds } from './wav'

/** Words heard one after another, `gap` seconds apart, each lasting most of that. */
const heard = (words: string[], gap = 0.5, start = 0.2): HeardWord[] =>
  words.map((word, i) => ({ word, start: start + i * gap, end: start + i * gap + gap * 0.8 }))

describe('a WAV’s length', () => {
  it('is read from its header, other chunks skipped', () => {
    expect(wavSeconds(silentWav(1.5))).toBeCloseTo(1.5)
    expect(wavInfo(silentWav(2, 44_100, 2))).toMatchObject({ sampleRate: 44_100, channels: 2, bitsPerSample: 16, seconds: 2 })
    // A LIST chunk before the data.
    const plain = silentWav(1)
    const list = Buffer.concat([Buffer.from('LIST'), Buffer.from([4, 0, 0, 0]), Buffer.from('INFO')])
    const withList = Buffer.concat([plain.subarray(0, 36), list, plain.subarray(36)])
    expect(wavSeconds(withList)).toBeCloseTo(1)
    expect(wavSeconds(Buffer.from('not a wav at all'))).toBeNull()
  })
})

describe('lining up the page’s words with the words heard', () => {
  it('matches the same words', () => {
    expect(alignWords(['the', 'door', 'slammed'], ['the', 'door', 'slammed']).map((x) => x.j)).toEqual([0, 1, 2])
  })

  it('forgives a respelled name ("Say it as") and a word heard as two', () => {
    const lined = alignWords(['siobhan', 'slammed', 'the', 'door'], ['shiv', 'awn', 'slammed', 'the', 'door'])
    expect(lined.map((x) => x.j)).toEqual([0, 2, 3, 4])
    expect(lined[0]!.match).toBe(false)
    expect(lined[1]!.match).toBe(true)
  })

  it('leaves a word that wasn’t heard unmatched', () => {
    expect(alignWords(['he', 'very', 'quietly', 'left'], ['he', 'quietly', 'left']).map((x) => x.j)).toEqual([0, null, 1, 2])
  })

  it('takes a word heard a little differently as the same', () => {
    expect(alignWords(['colour', 'grey'], ['color', 'gray']).every((x) => x.match)).toBe(true)
  })
})

describe('when a sound is heard', () => {
  const text = 'Behind him, the door slammed shut.'
  const at = (word: string): number => text.indexOf(word)

  it('is when its word was heard', () => {
    const words = heard(['behind', 'him', 'the', 'door', 'slammed', 'shut'])
    expect(alignedTimes({ text, from: 0, to: text.length, at: [at('slammed'), at('Behind')], heard: words })).toEqual([2.2, 0.2])
    // A place between words is the next word's.
    expect(alignedTimes({ text, from: 0, to: text.length, at: [at('door') - 1], heard: words })).toEqual([1.7])
  })

  it('works from the clip’s own stretch of the paragraph', () => {
    const from = at('the')
    expect(pageWords(text, from, text.length).map((w) => w.word)).toEqual(['the', 'door', 'slammed', 'shut'])
    expect(alignedTimes({ text, from, to: text.length, at: [at('slammed')], heard: heard(['the', 'door', 'slammed', 'shut']) })).toEqual([1.2])
  })

  it('puts a word that wasn’t heard between its neighbours', () => {
    const words = heard(['behind', 'him', 'the', 'slammed', 'shut'])
    const [t] = alignedTimes({ text, from: 0, to: text.length, at: [at('door')], heard: words })!
    expect(t).toBeGreaterThan(words[2]!.end)
    expect(t).toBeLessThan(words[3]!.start)
  })

  it('isn’t trusted when too few words line up', () => {
    expect(alignedTimes({ text, from: 0, to: text.length, at: [at('door')], heard: heard(['completely', 'different', 'words', 'here']) })).toBeNull()
    expect(alignedTimes({ text, from: 0, to: text.length, at: [at('door')], heard: [] })).toBeNull()
  })

  it('is estimated by its place in the clip when the words aren’t known', () => {
    expect(estimateTimes({ from: 10, to: 30, at: [10, 20, 40], duration: 4 })).toEqual([0, 2, 4])
    // No clip to hand: at a rough speaking speed.
    expect(estimateTimes({ from: 0, to: 300, at: [150], duration: null })).toEqual([10])
  })
})

describe('timing a clip’s sounds', () => {
  const text = 'Behind him, the door slammed shut.'
  const KEY = 'a'.repeat(64)
  const store = (wav: Buffer | null): ClipStore & { extras: Map<string, string> } => {
    const extras = new Map<string, string>()
    return {
      extras,
      get: async (key) => (key === KEY ? wav : null),
      getExtra: async (key, name) => extras.get(`${key}.${name}`) ?? null,
      putExtra: async (key, name, data) => void extras.set(`${key}.${name}`, data)
    }
  }
  const answer = (status: number, body: unknown): Response =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

  it('asks the speech server to hear the clip once, and keeps the words beside it', async () => {
    const cache = store(silentWav(4))
    const fetcher = vi.fn(async (_path: string, _init: RequestInit) =>
      answer(200, { words: heard(['behind', 'him', 'the', 'door', 'slammed', 'shut']), engine: 'parakeet' })
    )
    const timer = new CueTimer(cache, fetcher)
    const req = { key: KEY, text, from: 0, to: text.length, at: [text.indexOf('slammed')] }
    expect(await timer.times(req)).toEqual({ seconds: [2.2], aligned: true })
    expect(await timer.times(req)).toEqual({ seconds: [2.2], aligned: true })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0]![0]).toBe('/align')
    expect(fetcher.mock.calls[0]![1]).toMatchObject({ method: 'POST', headers: { 'content-type': 'audio/wav' } })
    expect(JSON.parse(cache.extras.get(`${KEY}.words`)!)).toMatchObject({ v: 1, engine: 'parakeet' })
  })

  it('estimates, and doesn’t ask again for a minute, when there is no dictation engine', async () => {
    let now = 1_000
    const fetcher = vi.fn(async () => answer(503, { detail: 'no-aligner' }))
    const timer = new CueTimer(store(silentWav(3.4)), fetcher, { now: () => now })
    const req = { key: KEY, text, from: 0, to: text.length, at: [17] }
    expect(await timer.times(req)).toEqual({ seconds: [1.7], aligned: false })
    await timer.times(req)
    expect(fetcher).toHaveBeenCalledTimes(1)
    now += NO_ALIGNER_MS + 1
    await timer.times(req)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('estimates when hearing fails or the server isn’t answering, and never throws', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const req = { key: KEY, text, from: 0, to: text.length, at: [17] }
    const failing = new CueTimer(store(silentWav(3.4)), async () => answer(500, 'boom'))
    expect(await failing.times(req)).toEqual({ seconds: [1.7], aligned: false })
    const down = new CueTimer(store(silentWav(3.4)), async () => {
      throw new Error('not running')
    })
    expect(await down.times(req)).toEqual({ seconds: [1.7], aligned: false })
  })

  it('doesn’t ask at all when the server has no dictation model, but still uses words kept before', async () => {
    const cache = store(silentWav(3.4))
    const fetcher = vi.fn(async (_path: string, _init: RequestInit) => answer(200, { words: [], engine: '' }))
    const timer = new CueTimer(cache, fetcher, { canHear: () => false })
    const req = { key: KEY, text, from: 0, to: text.length, at: [text.indexOf('slammed')] }
    expect(await timer.times(req)).toEqual({ seconds: [2.1], aligned: false })
    expect(fetcher).not.toHaveBeenCalled()
    cache.extras.set(`${KEY}.words`, JSON.stringify({ v: 1, engine: 'whisper', words: heard(['behind', 'him', 'the', 'door', 'slammed', 'shut']) }))
    expect(await timer.times(req)).toEqual({ seconds: [2.2], aligned: true })
  })

  it('waits a short while for the words, not minutes', async () => {
    const fetcher = vi.fn(async (_path: string, _init: RequestInit) => answer(200, { words: [], engine: '' }))
    await new CueTimer(store(silentWav(1)), fetcher).times({ key: KEY, text, from: 0, to: text.length, at: [0] })
    expect(fetcher.mock.calls[0]![1]).toMatchObject({ timeoutMs: ALIGN_TIMEOUT_MS })
    expect(ALIGN_TIMEOUT_MS).toBeLessThanOrEqual(20_000)
  })

  it('estimates from a speaking speed when the clip isn’t to hand', async () => {
    const fetcher = vi.fn()
    const timer = new CueTimer(store(null), fetcher)
    expect(await timer.times({ key: 'b'.repeat(64), text, from: 0, to: text.length, at: [15] })).toEqual({ seconds: [1], aligned: false })
    expect(fetcher).not.toHaveBeenCalled()
  })
})
