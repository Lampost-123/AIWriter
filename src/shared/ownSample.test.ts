import { describe, expect, it } from 'vitest'
import { ownSampleOn, ownSamplePref, ownWritingNote, SOUND_BLOCK } from './ownSample'

describe('Use my own writing as the sample', () => {
  it('is on while the sample passage is empty, unless Adam chose', () => {
    expect(ownSampleOn(undefined, '')).toBe(true)
    expect(ownSampleOn(undefined, '   ')).toBe(true)
    expect(ownSampleOn(undefined, 'The kettle sang.')).toBe(false)
    expect(ownSampleOn(true, 'The kettle sang.')).toBe(true)
    expect(ownSampleOn(false, '')).toBe(false)
  })

  it('saves what the switch means for the sample passage it sits under', () => {
    // Turned on under an empty sample: left out, so filling the sample passage later still wins.
    expect(ownSamplePref(true, '')).toBeUndefined()
    // Turned on over a sample passage: his own writing over it.
    expect(ownSamplePref(true, 'The kettle sang.')).toBe(true)
    expect(ownSamplePref(false, '')).toBe(false)
    expect(ownSamplePref(false, 'The kettle sang.')).toBe(false)
  })

  it('says in What the AI saw that the sample is his own writing', () => {
    expect(ownWritingNote({ id: 'instructions', ownWriting: { words: 412, from: ['Ch 3, Sc 2', 'Ch 1, Sc 4'] } })).toBe(
      'The sample passage is your own writing: 412 words from Ch 3, Sc 2 and Ch 1, Sc 4. Nothing the AI wrote unchanged is in it.'
    )
    expect(ownWritingNote({ id: 'instructions', ownWriting: { words: 300, from: ['Ch 5, Sc 1', 'Ch 4, Sc 2', 'Ch 4, Sc 1', 'Ch 2, Sc 3', 'Ch 1, Sc 1'] } })).toContain(
      'from Ch 5, Sc 1, Ch 4, Sc 2, Ch 4, Sc 1 and 2 more scenes.'
    )
    expect(ownWritingNote({ id: SOUND_BLOCK.id, ownWriting: { words: 118, from: ['Ch 3, Sc 2'] } })).toBe(
      'Your own words again, from Ch 3, Sc 2, said just before the AI writes so it keeps your voice.'
    )
    expect(ownWritingNote({ id: 'instructions' })).toBeNull()
  })
})
