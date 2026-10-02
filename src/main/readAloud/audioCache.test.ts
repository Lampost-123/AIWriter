import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AudioCache, stableJson } from './audioCache'

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aw-audio-'))
  // Only the clock is faked (from now, as files are written with the real time), so clips can be played in turn.
  vi.useFakeTimers({ toFake: ['Date'] })
})
afterEach(() => {
  vi.useRealTimers()
  rmSync(dir, { recursive: true, force: true })
})

const clip = (n: number): Buffer => Buffer.alloc(100, n)
const key = (name: string): string => AudioCache.keyOf({ input: name })
const later = (seconds: number): void => {
  vi.setSystemTime(Date.now() + seconds * 1000)
}

describe('the key a clip is kept under', () => {
  it('is the same for the same request, whatever order its fields are in', () => {
    expect(AudioCache.keyOf({ input: 'Hi.', voice: 'narrator' })).toBe(AudioCache.keyOf({ voice: 'narrator', input: 'Hi.' }))
    expect(AudioCache.keyOf({ input: 'Hi.', voice: 'narrator' })).not.toBe(AudioCache.keyOf({ input: 'Hi.', voice: 'clip:mara.wav' }))
    expect(stableJson({ b: 1, a: [2, { d: undefined, c: 3 }] })).toBe('{"a":[2,{"c":3}],"b":1}')
  })
})

describe('the spoken audio kept on disk', () => {
  it('gives back what it kept', async () => {
    const cache = new AudioCache(dir, () => 10_000)
    await cache.put(key('a'), clip(1))
    expect((await cache.get(key('a')))?.equals(clip(1))).toBe(true)
    expect(await cache.get(key('b'))).toBeNull()
    expect(await cache.stats()).toEqual({ files: 1, bytes: 100, limitBytes: 10_000 })
  })

  it('removes the clips played longest ago when it is over its limit', async () => {
    const cache = new AudioCache(dir, () => 250)
    await cache.put(key('a'), clip(1))
    later(1)
    await cache.put(key('b'), clip(2))
    later(1)
    // Playing "a" again makes "b" the one played longest ago.
    await cache.get(key('a'))
    later(1)
    await cache.put(key('c'), clip(3))
    expect(await cache.get(key('b'))).toBeNull()
    expect(await cache.get(key('a'))).not.toBeNull()
    expect(await cache.get(key('c'))).not.toBeNull()
    expect((await cache.stats()).bytes).toBe(200)
  })

  it('remembers across restarts which clips were played last', async () => {
    const first = new AudioCache(dir, () => 10_000)
    await first.put(key('a'), clip(1))
    later(5)
    await first.put(key('b'), clip(2))
    later(5)
    await first.get(key('a'))
    // A lower limit after a restart removes the clip played longest ago.
    const again = new AudioCache(dir, () => 150)
    expect(await again.stats()).toMatchObject({ files: 2, bytes: 200 })
    expect(await again.prune()).toBe(1)
    expect(await again.get(key('b'))).toBeNull()
    expect(await again.get(key('a'))).not.toBeNull()
  })

  it('clears only its own clips', async () => {
    const cache = new AudioCache(dir, () => 10_000)
    await cache.put(key('a'), clip(1))
    writeFileSync(join(dir, 'keep.txt'), 'not a clip')
    await cache.clear()
    expect(readdirSync(dir)).toEqual(['keep.txt'])
    expect(await cache.stats()).toMatchObject({ files: 0, bytes: 0 })
  })

  it('never makes a path from anything but a hash', async () => {
    const cache = new AudioCache(dir, () => 10_000)
    await expect(cache.put('../../escape', clip(1))).rejects.toThrow()
    expect(await cache.get('../../escape')).toBeNull()
    expect(existsSync(join(dir, '..', 'escape.wav'))).toBe(false)
  })
})
