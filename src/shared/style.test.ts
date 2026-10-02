import { describe, expect, it } from 'vitest'
import { defaultStyleGuide } from './defaults'
import { effectiveStyle, mergePhrases } from './style'
import type { StyleGuide, WritingPrefs } from './types'

const prefs = (p: Partial<WritingPrefs> = {}): WritingPrefs => ({
  spelling: 'UK',
  pov: 'Close third person',
  tense: 'Past tense',
  voiceNotes: '',
  avoidWords: [],
  ...p
})
const world = (w: Partial<StyleGuide> = {}): StyleGuide => ({ ...defaultStyleGuide(), ...w })

describe('effectiveStyle', () => {
  it('falls back to my preferences when the world and story leave a field empty', () => {
    const s = effectiveStyle(prefs(), world(), {})
    expect(s.pov).toBe('Close third person')
    expect(s.tense).toBe('Past tense')
    expect(s.spelling).toBe('UK')
    expect(s.sources.pov).toBe('prefs')
    expect(s.sources.tense).toBe('prefs')
    expect(s.sources.spelling).toBe('prefs')
  })

  it('lets the world override my preferences, and the story override the world', () => {
    const s = effectiveStyle(prefs(), world({ pov: 'First person', tense: 'Present tense', spelling: 'US' }), { pov: 'Third person omniscient' })
    expect(s.pov).toBe('Third person omniscient')
    expect(s.sources.pov).toBe('story')
    expect(s.tense).toBe('Present tense')
    expect(s.sources.tense).toBe('world')
    expect(s.spelling).toBe('US')
    expect(s.sources.spelling).toBe('world')
  })

  it('treats blank strings, whitespace and empty spelling as not set', () => {
    const s = effectiveStyle(prefs(), world({ pov: '   ', spelling: '' }), { pov: '', tense: ' ', spelling: '' })
    expect(s.pov).toBe('Close third person')
    expect(s.tense).toBe('Past tense')
    expect(s.spelling).toBe('UK')
  })

  it('reports none when nothing sets a field', () => {
    const s = effectiveStyle(prefs({ pov: '', tense: '' }), world(), {})
    expect(s.pov).toBe('')
    expect(s.sources.pov).toBe('none')
    expect(s.proseStyle).toBe('')
    expect(s.sources.proseStyle).toBe('none')
    expect(s.sources.samplePassage).toBe('none')
    expect(s.sources.avoidPhrases).toBe('none')
    expect(s.avoidPhrases).toEqual([])
  })

  it('uses only the world and story for fields my preferences do not have', () => {
    const s = effectiveStyle(prefs(), world({ proseStyle: 'Spare', samplePassage: 'The rain came.' }), { contentLimits: 'Fade to black' })
    expect(s.proseStyle).toBe('Spare')
    expect(s.samplePassage).toBe('The rain came.')
    expect(s.contentLimits).toBe('Fade to black')
    expect(s.sources.contentLimits).toBe('story')
  })

  it('combines phrases to avoid from all three levels without repeats', () => {
    const s = effectiveStyle(prefs({ avoidWords: ['suddenly', 'very'] }), world({ avoidPhrases: ['Suddenly', 'a shiver ran down'] }), {
      avoidPhrases: ['very', ' delve ', '']
    })
    expect(s.avoidPhrases).toEqual(['suddenly', 'very', 'a shiver ran down', 'delve'])
    expect(s.sources.avoidPhrases).toBe('story')
  })

  it('says where phrases to avoid came from when only lower levels set them', () => {
    expect(effectiveStyle(prefs({ avoidWords: ['very'] }), world(), {}).sources.avoidPhrases).toBe('prefs')
    expect(effectiveStyle(prefs({ avoidWords: ['very'] }), world({ avoidPhrases: ['x'] }), { avoidPhrases: [] }).sources.avoidPhrases).toBe('world')
  })

  it('puts my voice notes into notes only when the world and story have none', () => {
    const p = prefs({ voiceNotes: 'Dry humour. Short sentences in action.' })
    expect(effectiveStyle(p, world(), {}).notes).toBe('Dry humour. Short sentences in action.')
    expect(effectiveStyle(p, world(), {}).sources.notes).toBe('prefs')
    expect(effectiveStyle(p, world({ notes: 'World notes' }), {}).notes).toBe('World notes')
    expect(effectiveStyle(p, world({ notes: 'World notes' }), { notes: 'Story notes' }).notes).toBe('Story notes')
  })

  it('copes with missing fields in stored data', () => {
    const s = effectiveStyle(prefs(), {} as StyleGuide, { avoidPhrases: undefined })
    expect(s.pov).toBe('Close third person')
    expect(s.avoidPhrases).toEqual([])
    expect(s.samplePassage).toBe('')
    const noPrefs = effectiveStyle(undefined as unknown as WritingPrefs, world({ pov: 'First person' }), {})
    expect(noPrefs.pov).toBe('First person')
    expect(noPrefs.spelling).toBe('')
    expect(noPrefs.sources.notes).toBe('none')
  })
})

describe('mergePhrases', () => {
  it('keeps the first spelling of a repeated phrase', () => {
    expect(mergePhrases(['Very'], ['very', 'VERY', 'quite'])).toEqual(['Very', 'quite'])
  })
})
