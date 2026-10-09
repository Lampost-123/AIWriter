import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ageFieldBand, ageHint, castingPrompt, genderOf, pickVoices, readCasting, readStudioVoices, studioClip, studioIdOf, type StudioVoice } from './studio'

const voices: StudioVoice[] = [
  { id: 'p001', gender: 'female', age: '18-25', pitch: 'high', name: 'Clara' },
  { id: 'p002', gender: 'female', age: '56-65', pitch: 'low', name: 'Maya' },
  { id: 'p003', gender: 'male', age: '26-35', pitch: 'mid', name: 'Arthur' },
  { id: 'p004', gender: 'male', age: '66-75', pitch: 'low', name: 'Ben' }
]

let dir = ''
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = ''
})

describe('the studio voices', () => {
  it('are read from their list, leaving out anything that isn’t a voice', () => {
    dir = mkdtempSync(join(tmpdir(), 'studio-'))
    writeFileSync(
      join(dir, 'index.json'),
      JSON.stringify([...voices, { id: '../bad', gender: 'female', age: '' }, { id: 'p009', gender: 'robot', age: '' }])
    )
    expect(readStudioVoices(dir).map((v) => v.id)).toEqual(['p001', 'p002', 'p003', 'p004'])
    expect(readStudioVoices(join(dir, 'missing'))).toEqual([])
    expect(readStudioVoices(null)).toEqual([])
  })

  it('are played by a clip id', () => {
    expect(studioClip('p001')).toBe('clip:library/p001.wav')
    expect(studioIdOf('clip:library/p001.wav')).toBe('p001')
    expect(studioIdOf('clip:mine.wav')).toBeNull()
  })
})

describe('casting', () => {
  it('reads gender from pronouns first, then the words about them', () => {
    expect(genderOf('she/her', '')).toBe('female')
    expect(genderOf('he/him', 'A woman')).toBe('male')
    expect(genderOf('', 'An old man with a gravelly voice')).toBe('male')
    expect(genderOf('they/them', 'A voice like gravel')).toBeNull()
  })

  it('takes the model’s pick when it fits, else the closest by gender, age and pitch, never one used', () => {
    const needs = [
      { id: 'a', name: 'Mara', gender: 'female' as const, about: 'A young woman' },
      { id: 'b', name: 'Old Tom', gender: 'male' as const, about: 'An elderly man with a deep voice' },
      { id: 'c', name: 'Pip', gender: 'female' as const, about: '' }
    ]
    // The model gave Old Tom a woman's voice: the rules cast him instead. Pip has no woman's voice left.
    const picks = pickVoices(needs, voices, new Set(['p002']), { Mara: 'p001', 'Old Tom': 'p001' })
    expect(picks).toEqual({ a: 'p001', b: 'p004' })
    expect(ageHint('in her sixties')).toBe('56-65')
  })

  it('reads the model’s reply leniently', () => {
    expect(readCasting('Here you go: {"Mara": "p001", "Tom": 3}')).toEqual({ Mara: 'p001' })
    expect(readCasting('no idea')).toEqual({})
  })
})

describe('ages', () => {
  it('reads an Age field as a band: a number, a decade, or words; under 18 the youngest, over 75 the oldest', () => {
    expect(ageFieldBand('34')).toBe('26-35')
    expect(ageFieldBand('34 years old')).toBe('26-35')
    expect(ageFieldBand('mid-30s')).toBe('26-35')
    expect(ageFieldBand('mid-50s')).toBe('46-55')
    expect(ageFieldBand('early twenties')).toBe('18-25')
    expect(ageFieldBand('late forties')).toBe('46-55')
    expect(ageFieldBand('12')).toBe('18-25')
    expect(ageFieldBand('child')).toBe('18-25')
    expect(ageFieldBand('91')).toBe('66-75')
    expect(ageFieldBand('')).toBeNull()
    expect(ageFieldBand('unknown')).toBeNull()
  })

  it('finds an age in the words only when it is said as one, and the Age field wins over them', () => {
    expect(ageHint('a 34-year-old courier')).toBe('26-35')
    expect(ageHint('aged 60, and still rowing')).toBe('56-65')
    expect(ageHint('she has 3 brothers')).toBeNull()
    const need = { id: 'a', name: 'Wren', gender: 'female' as const, about: 'An elderly woman', age: '18-25' }
    expect(pickVoices([need], voices, new Set())).toEqual({ a: 'p001' })
  })

  it('tells the casting model the gender and age band it knows, and reads a Sex field', () => {
    const [, user] = castingPrompt([{ id: 'a', name: 'Wren', gender: 'female', about: 'A courier.', age: '26-35' }], voices)
    expect(user!.content).toContain('- Wren (female, 26-35): A courier.')
    expect(genderOf('', 'A man', 'Female')).toBe('female')
    expect(genderOf('she/her', '', 'M')).toBe('male')
  })
})
