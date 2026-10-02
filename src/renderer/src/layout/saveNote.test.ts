import { describe, expect, it } from 'vitest'
import { saveNote } from './saveNote'

describe('saveNote', () => {
  it('says how the scene is saving while Adam is writing', () => {
    expect(saveNote('saving', true)).toBe('Saving…')
    expect(saveNote('saved', true)).toBe('Saved')
    expect(saveNote('idle', true)).toBe('')
    expect(saveNote('error', true)).toBe('Not saved, retrying')
  })

  it("keeps quiet on other pages, which have their own save notes, so the two can't disagree", () => {
    expect(saveNote('saving', false)).toBe('')
    expect(saveNote('saved', false)).toBe('')
    expect(saveNote('idle', false)).toBe('')
  })

  it('still says when the scene could not be saved, naming the scene', () => {
    expect(saveNote('error', false)).toBe('Scene not saved, retrying')
  })
})
