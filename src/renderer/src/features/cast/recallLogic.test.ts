import { describe, expect, it } from 'vitest'
import { uncheckedNote } from './recallLogic'

describe('what Recall says about a state carried on from the scene before', () => {
  it('says the memory model turned the scene down, and what to do', () => {
    expect(uncheckedNote({ unchecked: true, refused: true })).toEqual({
      lead: 'Turned down:',
      text: 'the memory model wouldn’t read this scene (some models won’t read explicit scenes), so this is carried on from the scene before and doesn’t show what this scene changed. Put right what changed here, or pick another memory model in Settings › Models and press Read again.'
    })
  })

  it('says a scene not read yet is carried on, and that it can be put right', () => {
    expect(uncheckedNote({ unchecked: true, refused: false })?.lead).toBe('Not read yet:')
    expect(uncheckedNote({ unchecked: true })?.text).toMatch(/^this is carried on from the scene before/)
  })

  it('says nothing of a state read from the scene', () => {
    expect(uncheckedNote({})).toBeNull()
    expect(uncheckedNote(null)).toBeNull()
  })
})
