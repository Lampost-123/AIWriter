import { describe, expect, it } from 'vitest'
import { insertSpoken } from './insertText'

describe('dictated words go in at the cursor', () => {
  it('adds a space before them after a word, and none at the start', () => {
    expect(insertSpoken('She ran', 7, 7, 'to the door')).toEqual({ value: 'She ran to the door', caret: 19 })
    expect(insertSpoken('', 0, 0, ' Hello ')).toEqual({ value: 'Hello', caret: 5 })
  })

  it('replaces a selection, with a space after them before a word', () => {
    expect(insertSpoken('a big dog', 2, 5, 'small')).toEqual({ value: 'a small dog', caret: 7 })
    expect(insertSpoken('ab', 1, 1, 'x')).toEqual({ value: 'a x b', caret: 3 })
  })

  it('leaves the text alone when nothing was said', () => {
    expect(insertSpoken('same', 2, 2, '  ')).toEqual({ value: 'same', caret: 2 })
  })

  it('puts no space before punctuation that follows', () => {
    expect(insertSpoken('Wait.', 4, 4, 'for me')).toEqual({ value: 'Wait for me.', caret: 11 })
  })
})
