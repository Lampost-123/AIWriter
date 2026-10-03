import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import fs from 'node:fs/promises'
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

  it('counts each clip once when two are kept at the same moment over the limit', async () => {
    const cache = new AudioCache(dir, () => 250)
    await cache.put(key('a'), clip(1))
    later(1)
    await cache.put(key('b'), clip(2))
    later(1)
    await Promise.all([cache.put(key('c'), clip(3)), cache.put(key('d'), clip(4))])
    const stats = await cache.stats()
    expect(stats).toMatchObject({ files: 2, bytes: 200 })
    // What it counts is what is on the disk.
    const onDisk = readdirSync(dir).flatMap((shard) => readdirSync(join(dir, shard)))
    expect(onDisk).toHaveLength(2)
    expect(await cache.get(key('c'))).not.toBeNull()
    expect(await cache.get(key('d'))).not.toBeNull()
  })

  it('clears only its own clips', async () => {
    const cache = new AudioCache(dir, () => 10_000)
    await cache.put(key('a'), clip(1))
    writeFileSync(join(dir, 'keep.txt'), 'not a clip')
    // A clip half written when the app closed goes too.
    mkdirSync(join(dir, 'ab'), { recursive: true })
    writeFileSync(join(dir, 'ab', `${key('x')}.wav.1234.tmp`), 'half')
    await cache.clear()
    expect(readdirSync(dir)).toEqual(['keep.txt'])
    expect(await cache.stats()).toMatchObject({ files: 0, bytes: 0 })
  })

  it('clears what it can when a clip is in use, and says so in plain words', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const cache = new AudioCache(dir, () => 10_000)
    await cache.put(key('a'), clip(1))
    await cache.put(key('b'), clip(2))
    // On Windows a file that is open can't be deleted.
    const rm = fs.rm
    const busy = vi.spyOn(fs, 'rm').mockImplementation(async (file, options) => {
      if (String(file).includes(key('a'))) throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' })
      return rm(file, options)
    })
    await expect(cache.clear()).rejects.toThrow("Some saved audio is in use and couldn't be cleared. Try again in a moment.")
    expect(await cache.stats()).toMatchObject({ files: 1, bytes: 100 })
    expect(await cache.get(key('b'))).toBeNull()
    // Trimming to a lower limit leaves it too, rather than failing.
    const small = new AudioCache(dir, () => 10)
    expect(await small.prune()).toBe(0)
    busy.mockRestore()
    await cache.clear()
    expect(readdirSync(dir)).toEqual([])
  })

  it('never makes a path from anything but a hash', async () => {
    const cache = new AudioCache(dir, () => 10_000)
    await expect(cache.put('../../escape', clip(1))).rejects.toThrow()
    expect(await cache.get('../../escape')).toBeNull()
    expect(existsSync(join(dir, '..', 'escape.wav'))).toBe(false)
  })
})

describe('what is kept beside a clip (the words heard in it, for sound effects)', () => {
  const shard = (k: string): string[] => readdirSync(join(dir, k.slice(0, 2))).sort()

  it('keeps it beside the clip, gives it back, and counts only clips', async () => {
    const cache = new AudioCache(dir, () => 10_000)
    await cache.put(key('a'), clip(1))
    await cache.putExtra(key('a'), 'words', '{"v":1}')
    expect(await cache.getExtra(key('a'), 'words')).toBe('{"v":1}')
    expect(shard(key('a'))).toEqual([`${key('a')}.wav`, `${key('a')}.words.json`].sort())
    expect(await cache.stats()).toMatchObject({ files: 1, bytes: 100 })
    // After a restart too.
    const again = new AudioCache(dir, () => 10_000)
    expect(await again.stats()).toMatchObject({ files: 1, bytes: 100 })
    expect(await again.getExtra(key('a'), 'words')).toBe('{"v":1}')
  })

  it('keeps nothing for a clip it hasn’t got', async () => {
    const cache = new AudioCache(dir, () => 10_000)
    await cache.putExtra(key('a'), 'words', '{}')
    expect(await cache.getExtra(key('a'), 'words')).toBeNull()
    expect(readdirSync(dir)).toEqual([])
    await expect(cache.putExtra(key('a'), '../x', '{}')).resolves.toBeUndefined()
  })

  it('goes with its clip when the clip is trimmed', async () => {
    const cache = new AudioCache(dir, () => 150)
    await cache.put(key('a'), clip(1))
    await cache.putExtra(key('a'), 'words', '{}')
    later(1)
    await cache.put(key('b'), clip(2))
    expect(await cache.get(key('a'))).toBeNull()
    expect(existsSync(join(dir, key('a').slice(0, 2), `${key('a')}.words.json`))).toBe(false)
  })

  it('goes with its clip when the cache is cleared, and stays with a clip in use', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const cache = new AudioCache(dir, () => 10_000)
    await cache.put(key('a'), clip(1))
    await cache.put(key('b'), clip(2))
    await cache.putExtra(key('a'), 'words', '{}')
    await cache.putExtra(key('b'), 'words', '{}')
    const rm = fs.rm
    const busy = vi.spyOn(fs, 'rm').mockImplementation(async (file, options) => {
      if (String(file).endsWith(`${key('a')}.wav`)) throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' })
      return rm(file, options)
    })
    await expect(cache.clear()).rejects.toThrow()
    expect(await cache.getExtra(key('a'), 'words')).toBe('{}')
    expect(existsSync(join(dir, key('b').slice(0, 2), `${key('b')}.words.json`))).toBe(false)
    busy.mockRestore()
    await cache.clear()
    expect(readdirSync(dir)).toEqual([])
  })

  it('is let go when the clip is made again', async () => {
    const cache = new AudioCache(dir, () => 10_000)
    await cache.put(key('a'), clip(1))
    await cache.putExtra(key('a'), 'words', '{}')
    await cache.put(key('a'), clip(2))
    expect(await cache.getExtra(key('a'), 'words')).toBeNull()
  })
})
