import { describe, expect, it } from 'vitest'
import { calmPunctuation, cleanForSpeech } from './cleanText'

describe('punctuation a voice can’t read', () => {
  it('turns runs of dots, question and exclamation marks into one', () => {
    expect(calmPunctuation('Well. . . maybe.')).toBe('Well… maybe.')
    expect(calmPunctuation('What?!?!')).toBe('What?!')
    expect(calmPunctuation('No!!!')).toBe('No!')
    expect(calmPunctuation('...and then she left.')).toBe('and then she left.')
  })

  it('says nothing for a clip with no words', () => {
    expect(calmPunctuation('...')).toBe('')
    expect(calmPunctuation('?!')).toBe('')
  })

  it('takes out invisible characters and odd spaces', () => {
    expect(cleanForSpeech('co­operate now')).toBe('cooperate now')
  })
})
