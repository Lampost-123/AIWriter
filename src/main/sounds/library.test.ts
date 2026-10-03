import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AMBIENCE_SECONDS,
  contentWords,
  EFFECT_SECONDS,
  nearDuplicate,
  normaliseKey,
  SoundLibrary,
  soundIdOf,
  stem,
  UNDO_CLEAR_MS,
  wantSeconds
} from './library'
import { silentWav } from './wav'

let root = ''
let dir = ''
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'aw-sounds-'))
  dir = join(root, 'sounds')
})
afterEach(() => {
  vi.useRealTimers()
  rmSync(root, { recursive: true, force: true })
})

describe('the key a sound is kept under', () => {
  it('is its words in lower case, without punctuation, articles or extra spaces', () => {
    expect(normaliseKey('The heavy  door, slamming!')).toBe('heavy door slamming')
    expect(normaliseKey('A dog’s bark, an echo')).toBe('dogs bark echo')
    expect(normaliseKey('Rain on THE roof')).toBe(normaliseKey('rain on the roof.'))
    expect(normaliseKey('  ')).toBe('')
  })

  it('stems words lightly', () => {
    expect(['slams', 'slamming', 'slammed', 'slam'].map(stem)).toEqual(['slam', 'slam', 'slam', 'slam'])
    expect(['creaks', 'creaking', 'creaked'].map(stem)).toEqual(['creak', 'creak', 'creak'])
    expect(['falling', 'glasses', 'roofs', 'grass'].map(stem)).toEqual(['fall', 'glass', 'roof', 'grass'])
    expect(contentWords('the steady rain on a tin roof')).toEqual(['steady', 'rain', 'tin', 'roof'])
  })

  it('gives the same sound the same id, and a different kind another', () => {
    expect(soundIdOf('effect', 'door slam')).toMatch(/^[0-9a-f]{16}$/)
    expect(soundIdOf('effect', 'door slam')).toBe(soundIdOf('effect', 'door slam'))
    expect(soundIdOf('effect', 'rain')).not.toBe(soundIdOf('ambience', 'rain'))
  })

  it('asks for effects a few seconds long and ambience long enough to loop', () => {
    expect(wantSeconds('effect')).toBe(EFFECT_SECONDS)
    expect(wantSeconds('effect', 0.2)).toBe(1)
    expect(wantSeconds('effect', 30)).toBe(10)
    expect(wantSeconds('effect', 2.3)).toBe(2.5)
    expect(wantSeconds('ambience', 3)).toBe(AMBIENCE_SECONDS)
  })
})

describe('near-duplicate descriptions', () => {
  const same: [string, string][] = [
    ['rain on a roof', 'steady rain on a roof'],
    ['a heavy wooden door slamming shut', 'heavy wooden door slams shut'],
    ['a heavy wooden door slamming shut', 'a heavy oak door slamming shut'],
    ['steady rain on a tin roof', 'light rain on a tin roof'],
    ['wooden door creaking open', 'a wooden door creaks open slowly']
  ]
  const different: [string, string][] = [
    ['door slams', 'door creaks open'],
    ['glass shatters on the floor', 'plate shatters on the floor'],
    ['wind howling through trees', 'wind rustling through trees'],
    ['door', 'a heavy wooden door slamming shut'],
    ['distant thunder rumbling', 'distant traffic rumbling'],
    ['rain', 'steady rain drumming on a tin roof with wind']
  ]
  it.each(same)('"%s" is "%s"', (a, b) => {
    expect(nearDuplicate(a, b)).toBe(true)
    expect(nearDuplicate(b, a)).toBe(true)
  })
  it.each(different)('"%s" is not "%s"', (a, b) => {
    expect(nearDuplicate(a, b)).toBe(false)
    expect(nearDuplicate(b, a)).toBe(false)
  })
})

describe('the sound library', () => {
  it('finds a sound by its key, then by a near match it then remembers', () => {
    const lib = new SoundLibrary(dir)
    const rain = lib.want('ambience', 'Steady rain on a roof')!
    expect(rain).toMatchObject({ kind: 'ambience', state: 'waiting', key: 'steady rain on roof', want: AMBIENCE_SECONDS })
    expect(lib.want('ambience', 'steady rain on the roof.')).toBe(rain)
    // Close enough: reused, and the key is remembered so the next lookup is exact.
    expect(lib.find('ambience', 'rain on a roof')).toBe(rain)
    expect(rain.aliases).toEqual(['rain on roof'])
    // Never across kinds.
    expect(lib.find('effect', 'rain on a roof')).toBeNull()
    expect(lib.want('effect', 'door slams')!.id).not.toBe(lib.want('effect', 'door creaks open')!.id)
    // Kept on disk.
    const again = new SoundLibrary(dir)
    expect(again.find('ambience', 'rain on a roof')?.id).toBe(rain.id)
    expect(again.list()).toHaveLength(3)
  })

  it('reuses only sounds that could be made, except by their own key', () => {
    const lib = new SoundLibrary(dir)
    const door = lib.want('effect', 'a heavy wooden door slamming shut')!
    lib.failed(door.id, true)
    expect(lib.find('effect', 'a heavy oak door slamming shut')).toBeNull()
    expect(lib.find('effect', 'A heavy wooden door slamming shut')).toBe(door)
  })

  it('keeps a made sound, plays it, and counts it', async () => {
    const lib = new SoundLibrary(dir)
    const door = lib.want('effect', 'door slam', 2)!
    expect(await lib.audio(door.id)).toBeNull()
    const wav = silentWav(2, 44_100, 2)
    expect(await lib.saveClip(door.id, wav, 2, 0.31)).toBe(true)
    expect(lib.get(door.id)).toMatchObject({ state: 'ready', seconds: 2, bytes: wav.length, score: 0.31 })
    expect((await lib.audio(door.id))?.equals(wav)).toBe(true)
    expect(lib.stats()).toEqual({ count: 1, bytes: wav.length })
    expect(readdirSync(join(dir, 'clips'))).toEqual([`${door.id}.wav`])
    // A clip whose file went is made again.
    rmSync(join(dir, 'clips', `${door.id}.wav`))
    expect(await lib.audio(door.id)).toBeNull()
    expect(lib.get(door.id)?.state).toBe('waiting')
  })

  it('counts failures, and lets Listen now try a failed sound again', () => {
    const lib = new SoundLibrary(dir)
    const s = lib.want('effect', 'a bell tolling')!
    lib.failed(s.id, false)
    expect(lib.get(s.id)).toMatchObject({ state: 'waiting', failures: 1 })
    lib.failed(s.id, true)
    expect(lib.get(s.id)).toMatchObject({ state: 'failed', failures: 2 })
    lib.retry(s.id)
    expect(lib.get(s.id)).toMatchObject({ state: 'waiting', failures: 0 })
  })

  it('waits again for a sound that was being made when the app closed', () => {
    const lib = new SoundLibrary(dir)
    const s = lib.want('effect', 'a bell tolling')!
    lib.setState(s.id, 'making')
    lib.want('effect', 'a dog barking')
    expect(new SoundLibrary(dir).get(s.id)?.state).toBe('waiting')
  })

  it('shows the AI the sounds that share words with a passage, most first', () => {
    const lib = new SoundLibrary(dir)
    lib.want('ambience', 'steady rain on a tin roof')
    lib.want('effect', 'a door slamming')
    lib.want('effect', 'rain dripping from a gutter')
    const shown = lib.relevant('The rain on the roof grew louder.').map((e) => e.description)
    expect(shown).toEqual(['steady rain on a tin roof', 'rain dripping from a gutter'])
  })

  it('never makes a path from anything but an id', async () => {
    const lib = new SoundLibrary(dir)
    expect(lib.get('../library')).toBeNull()
    expect(await lib.saveClip('../x', silentWav(1), 1)).toBe(false)
    expect(await lib.audio('../x')).toBeNull()
  })

  it('is cleared aside for Undo, then deleted', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const lib = new SoundLibrary(dir)
    const s = lib.want('effect', 'door slam')!
    await lib.saveClip(s.id, silentWav(1), 1)
    await lib.clear()
    expect(lib.list()).toEqual([])
    expect(existsSync(dir)).toBe(false)
    expect(await lib.undoClear()).toBe(true)
    expect(lib.get(s.id)?.state).toBe('ready')
    expect((await lib.audio(s.id))?.length).toBeGreaterThan(44)
    // Too late: gone for good.
    await lib.clear()
    vi.advanceTimersByTime(UNDO_CLEAR_MS + 1)
    vi.useRealTimers()
    await vi.waitFor(() => expect(readdirSync(root)).toEqual([]))
    expect(await lib.undoClear()).toBe(false)
  })

  it('throws away libraries cleared in an earlier run', async () => {
    const lib = new SoundLibrary(dir)
    lib.want('effect', 'door slam')
    await lib.clear()
    new SoundLibrary(dir).sweep()
    expect(readdirSync(root)).toEqual([])
  })
})
