import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { autoCaster, CastingStore, labelKey, pickFor } from './autocast'
import { castOf } from './cast'
import { studioClip, type StudioVoice } from './studio'

const voices: StudioVoice[] = [
  { id: 'f1', gender: 'female', age: '18-25', pitch: 'high' },
  { id: 'f2', gender: 'female', age: '26-35', pitch: 'mid' },
  { id: 'f3', gender: 'female', age: '66-75', pitch: 'low' },
  { id: 'm1', gender: 'male', age: '18-25', pitch: 'mid' },
  { id: 'm2', gender: 'male', age: '46-55', pitch: 'low' },
  { id: 'm3', gender: 'male', age: '66-75', pitch: 'mid' }
]

const cast = castOf([
  { id: 'mara', name: 'Mara', aliases: [], about: 'A young woman, a courier. She is quick and sharp.' },
  { id: 'tom', name: 'Tomas', aliases: [], about: 'An old man, a retired ferryman. He grumbles.' },
  { id: 'ines', name: 'Ines', aliases: [], about: 'She runs the inn.', voice: { design: '', voice: studioClip('f2') } },
  { id: 'sam', name: 'Sam', aliases: [], about: '', voice: { design: 'A soft, breathy voice.', voice: '' } }
])
const [mara, tom, ines, sam] = cast

describe('a voice for a speaker who has none', () => {
  it('matches what the page says of them: gender and age', () => {
    const c = autoCaster({ voices, narrator: 'narrator', cast })
    expect(c.voiceFor(mara!)).toBe(studioClip('f1'))
    expect(c.voiceFor(tom!)).toBe(studioClip('m3'))
  })

  it('never casts someone with a voice of their own, a picked one or a description', () => {
    const c = autoCaster({ voices, narrator: 'narrator', cast })
    expect(c.voiceFor(ines!)).toBeNull()
    expect(c.voiceFor(sam!)).toBeNull()
  })

  it('gives the same speaker the same voice every time, and keeps it once given', () => {
    const a = autoCaster({ voices, narrator: 'narrator', cast })
    const first = a.voiceFor(mara!)
    expect(a.voiceFor(mara!)).toBe(first)
    // A new caster with what was kept: the same, even with someone new cast first.
    const b = autoCaster({ voices, narrator: 'narrator', cast, kept: a.given()! })
    expect(b.voiceFor(null, 'the guard')).not.toBe(first)
    expect(b.voiceFor(mara!)).toBe(first)
    // Picked by a steady hash, so even with nothing kept the first pick is the same.
    expect(autoCaster({ voices, narrator: 'narrator', cast }).voiceFor(null, 'the guard')).toBe(
      autoCaster({ voices, narrator: 'narrator', cast }).voiceFor(null, 'The Guard')
    )
  })

  it('never gives the narrator’s voice, nor one a character has, while others are free', () => {
    const c = autoCaster({ voices, narrator: studioClip('f1'), cast })
    // Mara would fit f1 best, but it is the narrator's; f2 is Ines's.
    expect(c.voiceFor(mara!)).toBe(studioClip('f3'))
    const everyone = new Set(['young woman', 'girl', 'student', 'lady'].map((l) => c.voiceFor(null, l)))
    expect(everyone.has(studioClip('f1'))).toBe(false)
  })

  it('casts someone the marks name by their label, but nobody in particular gets none', () => {
    const c = autoCaster({ voices, narrator: 'narrator', cast })
    expect(c.voiceFor(null, 'new:the old woman')).toBe(studioClip('f3'))
    expect(c.voiceFor(null, 'the old woman')).toBe(studioClip('f3'))
    expect(c.voiceFor(null, 'someone')).toBeNull()
    expect(c.voiceFor(null, '?')).toBeNull()
    expect(c.voiceFor(null, undefined)).toBeNull()
    expect(labelKey('The Guard!')).toBe('label:guard')
    expect(labelKey('a voice')).toBeNull()
  })

  it('shares the best fit when every fitting voice is taken, and gives none with no studio voices', () => {
    const two: StudioVoice[] = [voices[0]!, voices[3]!]
    expect(pickFor({ key: 'x', words: 'a woman' }, two, new Set(['f1']), 'narrator')).toBe(studioClip('f1'))
    expect(autoCaster({ voices: [], narrator: 'narrator', cast }).voiceFor(mara!)).toBeNull()
  })
})

describe('the voices kept per world', () => {
  let dir = ''
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('keeps each world’s castings apart, in the app’s user data', () => {
    dir = mkdtempSync(join(tmpdir(), 'aw-cast-'))
    const store = new CastingStore(join(dir, 'speech-cache', 'autocast.json'))
    expect(store.load('w1')).toEqual({})
    store.save('w1', { mara: studioClip('f1') })
    store.save('w2', { 'label:guard': studioClip('m1') })
    expect(store.load('w1')).toEqual({ mara: studioClip('f1') })
    expect(store.load('w2')).toEqual({ 'label:guard': studioClip('m1') })
  })
})
