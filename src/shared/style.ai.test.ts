import { describe, expect, it } from 'vitest'
import type { StyleGuide, WritingPrefs } from '@shared/types'
import { defaultStyleGuide } from '@shared/defaults'
import { effectiveStyle, mergePhrases } from './style'

const prefs = (p: Partial<WritingPrefs> = {}): WritingPrefs => ({ spelling: 'UK', pov: 'Close third person', tense: 'Past tense', voiceNotes: '', avoidWords: [], ...p })
const world = (w: Partial<StyleGuide> = {}): StyleGuide => ({ ...defaultStyleGuide(), ...w })

describe('effectiveStyle', () => {
  it('stacks preferences, then the world, then the story', () => {
    const s = effectiveStyle(prefs(), world({ pov: 'First person', spelling: 'US' }), { tense: 'Present tense' })
    expect(s.pov).toBe('First person')
    expect(s.tense).toBe('Present tense')
    expect(s.spelling).toBe('US')
  })

  it('treats empty and blank values as not set', () => {
    const s = effectiveStyle(prefs(), world({ pov: '  ', spelling: '' }), { pov: '', spelling: '' })
    expect(s.pov).toBe('Close third person')
    expect(s.spelling).toBe('UK')
  })

  it('uses my voice notes as the notes when nothing else sets them', () => {
    expect(effectiveStyle(prefs({ voiceNotes: 'Dry humour' }), world(), {}).notes).toBe('Dry humour')
    expect(effectiveStyle(prefs({ voiceNotes: 'Dry humour' }), world({ notes: 'World notes' }), {}).notes).toBe('World notes')
  })

  it('combines phrases to avoid from every level, without repeats', () => {
    const s = effectiveStyle(prefs({ avoidWords: ['suddenly', ' very '] }), world({ avoidPhrases: ['Suddenly', 'orbs'] }), { avoidPhrases: ['orbs', 'smirked'] })
    expect(s.avoidPhrases).toEqual(['suddenly', 'very', 'orbs', 'smirked'])
  })

  it('keeps fields that only the world and story have', () => {
    const s = effectiveStyle(prefs(), world({ proseStyle: 'Spare', samplePassage: 'The rain came.' }), { contentLimits: 'Fade to black' })
    expect(s.proseStyle).toBe('Spare')
    expect(s.samplePassage).toBe('The rain came.')
    expect(s.contentLimits).toBe('Fade to black')
  })

  it('merges lists ignoring case and blanks', () => {
    expect(mergePhrases(['A', ''], ['a', 'b'], [' B ', 'c'])).toEqual(['A', 'b', 'c'])
  })
})
