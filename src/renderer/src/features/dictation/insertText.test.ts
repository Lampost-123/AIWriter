import { describe, expect, it } from 'vitest'
import { insertSpoken, spaced } from './insertText'

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

  it('adds no space after a space, a new line or the start of a quotation', () => {
    expect(insertSpoken('She said ', 9, 9, 'hello')).toEqual({ value: 'She said hello', caret: 14 })
    expect(insertSpoken('First line\n', 11, 11, 'Second')).toEqual({ value: 'First line\nSecond', caret: 17 })
    expect(insertSpoken('He said, “', 10, 10, 'Wait.')).toEqual({ value: 'He said, “Wait.', caret: 15 })
    expect(insertSpoken('He said, "', 10, 10, 'Wait.')).toEqual({ value: 'He said, "Wait.', caret: 15 })
    expect(insertSpoken('(', 1, 1, 'aside')).toEqual({ value: '(aside', caret: 6 })
  })

  it('adds a space after a closing quote', () => {
    expect(insertSpoken('"Hi."', 5, 5, 'She waved.')).toEqual({ value: '"Hi." She waved.', caret: 16 })
    expect(insertSpoken('“Hi.”', 5, 5, 'She waved.')).toEqual({ value: '“Hi.” She waved.', caret: 16 })
  })

  it('follows a joining dash or a slash straight on', () => {
    expect(insertSpoken('He paused—', 10, 10, 'then ran')).toEqual({ value: 'He paused—then ran', caret: 18 })
    expect(insertSpoken('self-', 5, 5, 'made')).toEqual({ value: 'self-made', caret: 9 })
    expect(insertSpoken('and/', 4, 4, 'or')).toEqual({ value: 'and/or', caret: 6 })
  })

  it('joins words that start with punctuation to the word before', () => {
    expect(insertSpoken('She stopped', 11, 11, ', then turned.')).toEqual({ value: 'She stopped, then turned.', caret: 25 })
  })

  it('adds a space after them before an opening quote, a bracket or a spaced dash', () => {
    expect(insertSpoken('“No.”', 0, 0, 'She said')).toEqual({ value: 'She said “No.”', caret: 8 })
    expect(insertSpoken('"No."', 0, 0, 'She said')).toEqual({ value: 'She said "No."', caret: 8 })
    expect(insertSpoken('(twice)', 0, 0, 'It rang')).toEqual({ value: 'It rang (twice)', caret: 7 })
    expect(insertSpoken('– then', 0, 0, 'Quiet')).toEqual({ value: 'Quiet – then', caret: 5 })
  })

  it('keeps the words on one line', () => {
    expect(insertSpoken('', 0, 0, 'The lantern\nflickered   twice.')).toEqual({ value: 'The lantern flickered twice.', caret: 28 })
  })
})

describe('the spaces round dictated words', () => {
  it('says what to type and where the words start in it', () => {
    expect(spaced('She ran', '', 'to the door')).toEqual({ text: ' to the door', lead: 1, words: 'to the door' })
    expect(spaced('a ', ' dog', 'small')).toEqual({ text: 'small', lead: 0, words: 'small' })
    expect(spaced('a', 'b', 'x')).toEqual({ text: ' x ', lead: 1, words: 'x' })
    expect(spaced('', '', '   ')).toEqual({ text: '', lead: 0, words: '' })
  })
})
