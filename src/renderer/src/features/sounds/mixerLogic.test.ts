import { describe, expect, it } from 'vitest'
import {
  BED_DUCK_DB,
  LEAD,
  Lru,
  bedAfterEdge,
  bedChange,
  cueVolume,
  dbToGain,
  decodedBytes,
  dueEdges,
  effectsToDrop,
  estimateTimes,
  leftAtEnd,
  volumeGain
} from './mixerLogic'

const db = (gain: number): number => 20 * Math.log10(gain)

describe('how loud the sounds are', () => {
  it('sits under the voice at the default, rises evenly, and is silent at the bottom', () => {
    expect(volumeGain(0)).toBe(0)
    expect(volumeGain(-1)).toBe(0)
    expect(volumeGain(Number.NaN)).toBe(0)
    // The default (0.5): about 8 dB down, under a loudness-matched voice but clearly heard.
    expect(db(volumeGain(0.5))).toBeCloseTo(-8, 0)
    expect(db(volumeGain(1))).toBeCloseTo(2, 0)
    expect(volumeGain(2)).toBe(volumeGain(1))
    // Every step up is louder, by even steps in decibels across the middle.
    const steps = [0.1, 0.3, 0.5, 0.7, 0.9].map((v) => db(volumeGain(v)))
    for (let i = 1; i < steps.length; i++) expect(steps[i] - steps[i - 1]).toBeCloseTo(4, 5)
    // Near the bottom it fades to nothing rather than stopping at a floor.
    expect(volumeGain(0.01)).toBeLessThan(volumeGain(0.05) / 4)
  })

  it('dips the ambience about 5 dB under a line', () => {
    expect(BED_DUCK_DB).toBe(-5)
    expect(dbToGain(-5)).toBeCloseTo(0.562, 3)
  })
})

describe('which ambience plays', () => {
  it('keeps the same one, starts, crosses over to another, or fades out', () => {
    expect(bedChange('rain', 'rain')).toBe('keep')
    expect(bedChange(null, null)).toBe('keep')
    expect(bedChange(null, '')).toBe('keep')
    expect(bedChange(null, undefined)).toBe('keep')
    expect(bedChange(null, 'rain')).toBe('start')
    expect(bedChange('rain', 'harbour')).toBe('crossfade')
    expect(bedChange('rain', null)).toBe('stop')
    // A sound not chosen yet plays nothing.
    expect(bedChange('rain', '')).toBe('stop')
    // The same ambience at another volume moves to its new level; as loud as before, nothing changes.
    expect(bedChange('rain', 'rain', 1, 1.5)).toBe('level')
    expect(bedChange('rain', 'rain', undefined, 1)).toBe('keep')
    expect(bedChange('rain', 'rain', 0.5, 0.5)).toBe('keep')
    expect(bedChange(null, null, 1, 2)).toBe('keep')
    expect(bedChange('rain', 'harbour', 1, 2)).toBe('crossfade')
  })

  it('reads a sound’s own volume between a quarter and twice as made', () => {
    expect(cueVolume(undefined)).toBe(1)
    expect(cueVolume(null)).toBe(1)
    expect(cueVolume(Number.NaN)).toBe(1)
    expect(cueVolume(1.5)).toBe(1.5)
    expect(cueVolume(0.1)).toBe(0.25)
    expect(cueVolume(5)).toBe(2)
  })

  it('follows a clip’s edges: a start replaces any other, an end fades only its own', () => {
    expect(bedAfterEdge(null, { edge: 'start', soundId: 'rain' })).toBe('rain')
    expect(bedAfterEdge('harbour', { edge: 'start', soundId: 'rain' })).toBe('rain')
    expect(bedAfterEdge('rain', { edge: 'end', soundId: 'rain' })).toBeNull()
    expect(bedAfterEdge('harbour', { edge: 'end', soundId: 'rain' })).toBeUndefined()
    expect(bedAfterEdge(null, { edge: 'end', soundId: '' })).toBeUndefined()
    expect(bedAfterEdge('rain', { edge: 'fire', soundId: 'door' })).toBeUndefined()
  })
})

describe('when a clip’s sounds are heard', () => {
  it('estimates by the share of the words before each, until the speech server says', () => {
    expect(estimateTimes({ from: 10, to: 110 }, [10, 60, 110], 4)).toEqual([0, 2, 4])
    // Outside the clip: held to its ends. An empty clip or unknown length: at the start.
    expect(estimateTimes({ from: 10, to: 110 }, [0, 200], 4)).toEqual([0, 4])
    expect(estimateTimes({ from: 5, to: 5 }, [5], 4)).toEqual([0])
    expect(estimateTimes({ from: 0, to: 10 }, [5], 0)).toEqual([0])
  })

  it('hands each sound to the audio clock just before its word, at any speed', () => {
    const edges = [
      { at: 1, done: false },
      { at: 2, done: false },
      { at: null, done: false },
      { at: 0.5, done: true }
    ]
    expect(dueEdges(edges, 0, 1)).toEqual([])
    expect(dueEdges(edges, 1 - LEAD / 2, 1)).toEqual([{ index: 0, delay: expect.closeTo(LEAD / 2, 6) }])
    // Past it already (a late look): at once.
    expect(dueEdges(edges, 1.5, 1)).toEqual([{ index: 0, delay: 0 }])
    // At double speed the clip's next 0.1 s pass on the clock in 0.05 s.
    expect(dueEdges(edges, 0.9, 2)).toEqual([{ index: 0, delay: expect.closeTo(0.05, 6) }])
    expect(dueEdges(edges, 0.9, 0.5)).toEqual([])
    // A rate the element doesn't report counts as normal speed.
    expect(dueEdges(edges, 1, 0)).toEqual([{ index: 0, delay: 0 }])
  })

  it('owes whatever was not heard when the clip played to its end', () => {
    expect(
      leftAtEnd([
        { at: 1, done: true },
        { at: 9, done: false },
        { at: null, done: false }
      ])
    ).toEqual([1, 2])
  })
})

describe('effects and kept sounds', () => {
  it('lets the oldest effects go so at most three play at once', () => {
    expect(effectsToDrop(0)).toBe(0)
    expect(effectsToDrop(2)).toBe(0)
    expect(effectsToDrop(3)).toBe(1)
    expect(effectsToDrop(5)).toBe(3)
  })

  it('keeps the sounds used most recently', () => {
    const lru = new Lru<string, number>(2)
    lru.set('a', 1)
    lru.set('b', 2)
    expect(lru.get('a')).toBe(1)
    lru.set('c', 3)
    // 'b' was used least recently.
    expect(lru.has('b')).toBe(false)
    expect(lru.has('a')).toBe(true)
    expect(lru.size).toBe(2)
    lru.delete('a')
    expect(lru.get('a')).toBeUndefined()
  })

  it('keeps decoded sounds by their size, not their number', () => {
    const mb = 1024 * 1024
    // A stereo ambience of 30 s at 48 kHz: about 11 MB decoded.
    expect(decodedBytes({ length: 30 * 48000, numberOfChannels: 2 }) / mb).toBeCloseTo(11, 0)
    const lru = new Lru<string, { mb: number }>(80, (v) => v.mb)
    for (let i = 0; i < 7; i++) lru.set(`bed${i}`, { mb: 11 })
    expect(lru.size).toBe(7)
    expect(lru.weight).toBe(77)
    lru.set('bed7', { mb: 11 })
    // Past 80: the oldest used goes.
    expect(lru.has('bed0')).toBe(false)
    expect(lru.weight).toBe(77)
    // Many small effects fit where few beds do.
    for (let i = 0; i < 40; i++) lru.set(`fx${i}`, { mb: 0.3 })
    expect(lru.weight).toBeLessThanOrEqual(80)
    expect(lru.has('fx39')).toBe(true)
    // Replacing an item counts it once; one item over the limit on its own is still kept.
    lru.set('fx39', { mb: 0.5 })
    expect(lru.has('fx39')).toBe(true)
    lru.set('huge', { mb: 200 })
    expect(lru.size).toBe(1)
    expect(lru.has('huge')).toBe(true)
    lru.clear()
    expect(lru.weight).toBe(0)
  })
})
