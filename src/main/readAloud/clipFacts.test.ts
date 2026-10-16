import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BREEZE_COMMIT, BREEZE_MODEL, engineFingerprint, isWav, MOOD_CLIPS, studioKeyParts } from './clipFacts'

const server = join(__dirname, '..', '..', '..', 'speech-server')
const worker = readFileSync(join(server, 'app', 'workers', 'breeze.py'), 'utf8')

describe('what the clip cache knows about Breeze', () => {
  it('names the Breeze the voices download installs, and its weights', () => {
    const install = readFileSync(join(server, 'tools', 'install.py'), 'utf8')
    expect(install).toContain(`BREEZE_COMMIT = "${BREEZE_COMMIT}"`)
    expect(worker).toContain(`"AIWRITE_BREEZE_MODEL", "${BREEZE_MODEL}"`)
  })

  it('reads a feeling from the same acted clip the speech server does', () => {
    const block = worker.match(/MOOD_CLIPS = \{([\s\S]*?)\n\}/)?.[1] ?? ''
    const python = Object.fromEntries([...block.matchAll(/"([a-z]+)": "([a-z]+)"/g)].map((m) => [m[1], m[2]]))
    expect(Object.keys(python).length).toBeGreaterThan(10)
    expect(MOOD_CLIPS).toEqual(python)
  })

  it('changes with every switch the worker reads', () => {
    const plain = engineFingerprint({})
    for (const name of ['AIWRITE_BREEZE_CFG', 'AIWRITE_BREEZE_NARRATION_CFG', 'AIWRITE_BREEZE_FAST', 'AIWRITE_BREEZE_COMPILE', 'AIWRITE_BREEZE_MODEL']) {
      expect(worker).toContain(`"${name}"`)
      expect(engineFingerprint({ [name]: 'off' })).not.toEqual(plain)
    }
  })

  it('takes only a WAV clip for one', () => {
    const clip = Buffer.alloc(100)
    clip.write('RIFF', 0, 'ascii')
    clip.write('WAVE', 8, 'ascii')
    expect(isWav(clip)).toBe(true)
    expect(isWav(clip.subarray(0, 44))).toBe(false)
    expect(isWav(Buffer.from('<html><body>Not found</body></html>'.padEnd(100)))).toBe(false)
  })
})

describe('a studio voice in the key', () => {
  let dir = ''
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'aw-studio-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const voice = (id: string, acted: string[] = []): void => {
    writeFileSync(join(dir, `${id}.wav`), '')
    writeFileSync(join(dir, `${id}.txt`), 'words')
    mkdirSync(join(dir, id), { recursive: true })
    for (const a of acted) {
      writeFileSync(join(dir, id, `${a}.wav`), '')
      writeFileSync(join(dir, id, `${a}.txt`), 'words')
    }
  }
  /** The list changing is what tells the key to look again, as a download does. */
  const touch = (t: number): void => {
    writeFileSync(join(dir, 'index.json'), '[]')
    utimesSync(join(dir, 'index.json'), t, t)
  }

  it('adds nothing for a voice that has what the line asks for', () => {
    voice('p001', ['anger'])
    touch(1000)
    expect(studioKeyParts('clip:library/p001.wav', undefined, 'angry', dir)).toEqual({})
    expect(studioKeyParts('clip:library/p001.wav', undefined, undefined, dir)).toEqual({})
  })

  it('marks a feeling read from the calm clip, until its acted clip is there', () => {
    voice('p002')
    touch(2000)
    expect(studioKeyParts('clip:library/p002.wav', undefined, 'sad', dir)).toEqual({ calmFor: 'sad' })
    voice('p002', ['sadness'])
    touch(2001)
    expect(studioKeyParts('clip:library/p002.wav', undefined, 'sad', dir)).toEqual({})
  })

  it('marks a voice that is gone, which the worker reads in a designed voice instead', () => {
    touch(3000)
    expect(studioKeyParts('clip:library/p404.wav', undefined, undefined, dir)).toEqual({ missing: true })
  })

  it('leaves out lines made from a description, other voices, and a computer without the folder', () => {
    touch(4000)
    expect(studioKeyParts('clip:library/p404.wav', 'A dry voice.', 'sad', dir)).toEqual({})
    expect(studioKeyParts('narrator', undefined, 'sad', dir)).toEqual({})
    expect(studioKeyParts('clip:library/p404.wav', undefined, 'sad', null)).toEqual({})
  })
})
