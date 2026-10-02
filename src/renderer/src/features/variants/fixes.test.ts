import { describe, expect, it } from 'vitest'
import { fixesFor } from './fixes'

// The messages as the main process words them (src/main/ai/errors.ts, src/main/ai/draftFlow.ts).
const TOO_LONG_TOGETHER =
  'The briefing and the length you asked for are too much for this model together. Lower the length in the draft options, shorten the scene card, or pick a model that can read more in Settings › Models.'
const REPLY_LIMIT =
  "This model can't write that much in one reply. Lower the length in the draft options, or pick another writer model in Settings › Models."
const TOO_LONG_BEFORE =
  'This model can write about 2,400 words in one go. Lower the length in the draft options or on the scene card, or pick a model that can read more in Settings › Models.'
const BRIEFING_TOO_LONG =
  "This model can't read the style guide and the scene card and still write the scene. Pick a model that can read more in Settings › Models, or shorten the scene card or the style guide."
const NO_CREDIT = 'Your OpenRouter credit has run out. Top up, or switch the writer model in Settings.'
const NO_KEY = 'OpenRouter needs an API key. Add one in Settings › Models.'
const DROPPED = 'The connection to OpenRouter dropped before the draft was finished. The text that arrived is kept.'

describe('where the fix for a problem is', () => {
  it('offers the length first and Settings as well when the message names both', () => {
    expect(fixesFor(TOO_LONG_TOGETHER)).toEqual(['length', 'settings'])
    expect(fixesFor(REPLY_LIMIT)).toEqual(['length', 'settings'])
    expect(fixesFor(TOO_LONG_BEFORE, 'too-long')).toEqual(['length', 'settings'])
  })

  it('offers only Settings for the key, the credit or a model that can’t read enough', () => {
    expect(fixesFor(NO_CREDIT)).toEqual(['settings'])
    expect(fixesFor(NO_KEY, 'no-key')).toEqual(['settings'])
    expect(fixesFor(BRIEFING_TOO_LONG, 'briefing-too-long')).toEqual(['settings'])
    // The code alone is enough, whatever the words.
    expect(fixesFor('Choose a writer model first.', 'no-writer-model')).toEqual(['settings'])
  })

  it('goes by the code when the words don’t say, and offers nothing when neither does', () => {
    expect(fixesFor('This model can write about 900 words in one go.', 'too-long')).toEqual(['length'])
    expect(fixesFor(DROPPED)).toEqual([])
    expect(fixesFor('Variants of this scene are already being written. Stop them first, or wait for them to finish.', 'busy')).toEqual([])
  })

  it('reads the words, not parts of words', () => {
    expect(fixesFor('Your settings were saved.')).toEqual([])
    expect(fixesFor('The draft optionsmenu')).toEqual([])
  })
})
