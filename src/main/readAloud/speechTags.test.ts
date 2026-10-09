// "Skip 'he said' after a voiced line": the dialogue tag beside an own-voiced quote isn't spoken; an action it carries is.
import { describe, expect, it } from 'vitest'
import { castOf, everyone } from './cast'
import { planClips, type PlanSettings } from './plan'
import { withoutSpeechTags } from './speechTags'

const after = (t: string): string => withoutSpeechTags(t, { after: true })
const before = (t: string): string => withoutSpeechTags(t, { before: true })

describe('a dialogue tag beside a voiced line', () => {
  it('goes when it is only a tag, after the line or before it', () => {
    expect(after(' she said.')).toBe('')
    expect(after(' said Mara. The kettle began to sing.')).toBe('The kettle began to sing.')
    expect(after(' I said.')).toBe('')
    expect(after(' the guard muttered.')).toBe('')
    expect(before('Mara said, ')).toBe('')
    expect(before('The lamp guttered. She said: ')).toBe('The lamp guttered.')
  })

  it('goes with an adverb and whom it was said to', () => {
    expect(after(' she said quietly to Mara.')).toBe('')
    expect(after(' he whispered to her.')).toBe('')
    expect(after(' Tomas told him softly.')).toBe('')
  })

  it('goes in the split form, the words between two parts of one line', () => {
    expect(withoutSpeechTags(' she said, ', { after: true, before: true })).toBe('')
  })

  it('keeps the action a tag carries, from a capital letter', () => {
    expect(after(' she said, slamming the door.')).toBe('Slamming the door.')
    expect(after(' he said as he turned away.')).toBe('As he turned away.')
    expect(after(' Mara said, her voice cracking.')).toBe('Her voice cracking.')
    expect(after(' she said, and set the cup down.')).toBe('Set the cup down.')
    expect(before('He turned and said, ')).toBe('He turned.')
  })

  it('leaves narration that only looks like a tag', () => {
    expect(after(' She said nothing.')).toBe(' She said nothing.')
    expect(after(' He left.')).toBe(' He left.')
    expect(before('The rain fell.')).toBe('The rain fell.')
  })
})

describe('in a reading', () => {
  const settings: PlanSettings = {
    engine: 'breeze',
    narratorVoice: 'narrator',
    narratorDescription: '',
    dialogueVoice: 'warm',
    style: '',
    castVoices: true,
    steadyNarrator: false,
    sounds: false
  }
  const cast = everyone(
    castOf([
      { id: 'mara', name: 'Mara', aliases: [], about: '', voice: { design: '', voice: 'clip:mara.wav' } },
      { id: 'ann', name: 'Ann', aliases: [], about: '' }
    ])
  )
  const spoken = (text: string, s: Partial<PlanSettings> = {}): string[] =>
    planClips({ paragraphs: [{ pid: 'p1', text }], settings: { ...settings, ...s }, cast, lexicon: [], marks: new Map() }).clips.map(
      (c) => c.clip.input
    )

  it('skips the tag of a line in the character’s own voice, keeping its action', () => {
    expect(spoken('“Get out,” said Mara, slamming the door.')).toEqual(['Get out,', 'Slamming the door.'])
    expect(spoken('“I know,” said Mara, “but not tonight.”')).toEqual(['I know,', 'but not tonight.'])
  })

  it('keeps the tag of a line in the dialogue voice, and every tag with the setting off; the page is never changed', () => {
    expect(spoken('“Hello,” said Ann.')).toEqual(['Hello,', 'said Ann.'])
    // Read in the narrator's voice (no dialogue voice), the tag stays too.
    expect(spoken('“Hello,” said Ann.', { dialogueVoice: '' })).toEqual(['Hello,', 'said Ann.'])
    expect(spoken('“Get out,” said Mara.', { skipSpeechTags: false })).toEqual(['Get out,', 'said Mara.'])
  })
})
