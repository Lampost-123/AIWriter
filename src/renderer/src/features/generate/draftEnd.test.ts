import { describe, expect, it } from 'vitest'
import { draftEndActions } from './draftEnd'

const DROPPED = 'The connection to OpenRouter dropped before the draft was finished. The text that arrived is kept.'
const here = { cutOff: false, wrote: true, here: true }

describe('draftEndActions', () => {
  it('offers Continue from here, with What the AI saw beside it, when a draft stops short with its words on the page', () => {
    // Cut off at the reply limit.
    expect(draftEndActions({ error: null, cutOff: true, wrote: true, here: true })).toEqual(['continue', 'record'])
    // The connection dropped part-way (or went silent part-way), or something else broke off the draft.
    expect(draftEndActions({ ...here, error: DROPPED })).toEqual(['continue', 'record'])
    expect(draftEndActions({ ...here, error: 'Something went wrong while writing: socket hang up. The text that arrived is kept.' })).toEqual([
      'continue',
      'record'
    ])
  })

  it('points to the fix the message names first', () => {
    expect(draftEndActions({ ...here, error: 'Your OpenRouter credit has run out. Top up, or switch the writer model in Settings.' })).toEqual(['settings'])
    expect(
      draftEndActions({
        ...here,
        error: "The writer model refused this scene. Some models won't write explicit sex at the level your style guide sets, so pick a different writer model in Settings › Models. The text that arrived is kept."
      })
    ).toEqual(['settings'])
    expect(draftEndActions({ ...here, error: "This model can't write that much in one reply. Lower the length in the draft options, or pick another writer model in Settings › Models." })).toEqual([
      'options'
    ])
  })

  it('offers only What the AI saw when there is nothing on the page to carry on from, or the scene is not on screen', () => {
    expect(draftEndActions({ error: "Fake didn't answer in time. Try again in a moment.", cutOff: false, wrote: false, here: true })).toEqual(['record'])
    expect(draftEndActions({ error: null, cutOff: true, wrote: true, here: false })).toEqual(['record'])
    expect(draftEndActions({ error: DROPPED, cutOff: false, wrote: true, here: false })).toEqual(['record'])
  })
})
