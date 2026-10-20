import { describe, expect, it } from 'vitest'
import { namedWords, undoWords } from './chapterWriterLogic'

describe('the name Write this chapter gave a chapter, in the window’s words', () => {
  it('is in the report until Undo puts the title back', () => {
    expect(namedWords({ named: { from: 'Chapter 1', to: 'The Far Bank' }, undone: false })).toBe('Named the chapter “The Far Bank”.')
    expect(namedWords({ named: { from: 'Chapter 1', to: 'The Far Bank' }, undone: true })).toBe('')
    expect(namedWords({ undone: false })).toBe('')
  })

  it('is said by Undo when it is put back', () => {
    expect(undoWords(2, true)).toBe('Put back 2 scenes and the chapter’s name as they were before the AI wrote the chapter.')
    expect(undoWords(1, true)).toBe('Put back one scene and the chapter’s name as they were before the AI wrote the chapter.')
    expect(undoWords(2, false)).toBe('Put back 2 scenes as they were before the AI wrote the chapter.')
    expect(undoWords(1, false)).toBe('Put back one scene as it was before the AI wrote the chapter.')
    expect(undoWords(0, true)).toBe('Put back the chapter’s name as it was before the AI wrote the chapter.')
    expect(undoWords(0, false)).toBe('The chapter was already as it was before.')
  })
})
