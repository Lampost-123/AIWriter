import { describe, expect, it } from 'vitest'
import type { CastEntry, ReadAloudVoice } from '@shared/contracts/readAloud'
import { castVoiceText, givenText, voiceless, voiceName } from './castText'

const voices: ReadAloudVoice[] = [
  { id: 'ava', name: 'Ava', about: 'female', clip: false, recommended: true },
  { id: 'clip:library/p001.wav', name: 'Clara', about: 'Studio recording', clip: false, studio: true, recommended: false }
]

const row = (over: Partial<CastEntry> & { voice?: string; design?: string } = {}): CastEntry => ({
  id: over.id ?? 'e1',
  name: over.name ?? 'Wren',
  image: null,
  value: { voice: { voice: over.voice ?? '', design: over.design ?? '' }, say: '' },
  auto: over.auto ?? false,
  studioName: over.studioName ?? null
})

describe('the voice the Cast list shows for a character', () => {
  it('names a voice picked from the list, saying when it is a studio voice and when the app gave it', () => {
    expect(castVoiceText(row({ voice: 'ava' }), voices)).toBe('Ava')
    expect(castVoiceText(row({ voice: 'clip:library/p001.wav' }), voices)).toBe('Clara (studio voice)')
    expect(castVoiceText(row({ voice: 'clip:library/p001.wav', auto: true }), voices)).toBe('Auto: Clara (studio voice)')
  })

  it('uses the studio voice’s own name, or a tidy id, before the list has loaded', () => {
    expect(castVoiceText(row({ voice: 'clip:library/p002.wav', studioName: 'Arthur', auto: true }), null)).toBe(
      'Auto: Arthur (studio voice)'
    )
    expect(castVoiceText(row({ voice: 'clip:library/p002.wav' }), null)).toBe('p002 (studio voice)')
    expect(voiceName('clip:mine.wav', null)).toBe('mine')
  })

  it('says made from their description, else the dialogue voice', () => {
    expect(castVoiceText(row({ design: 'Low and dry.' }), voices)).toBe('Made from their description')
    expect(castVoiceText(row({ design: '   ' }), voices)).toBe('Dialogue voice')
    expect(castVoiceText(row(), voices)).toBe('Dialogue voice')
  })

  it('a picked voice wins over a description', () => {
    expect(castVoiceText(row({ voice: 'ava', design: 'Low and dry.' }), voices)).toBe('Ava')
  })
})

describe('Give everyone without a voice a voice', () => {
  it('is for characters with neither a voice picked nor a description', () => {
    expect(voiceless(row())).toBe(true)
    expect(voiceless(row({ design: 'Low.' }))).toBe(false)
    expect(voiceless(row({ voice: 'ava' }))).toBe(false)
  })

  it('says who was given which voice, in the order given', () => {
    const rows = [
      row({ id: 'a', name: 'Wren', voice: 'clip:library/p001.wav' }),
      row({ id: 'b', name: 'Ansel', voice: 'clip:library/p002.wav', studioName: 'Arthur' })
    ]
    expect(givenText(['b', 'a', 'gone'], rows, voices)).toBe('Ansel: Arthur · Wren: Clara')
  })
})
