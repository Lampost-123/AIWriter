import { describe, expect, it } from 'vitest'
import { chapterLabel, numberWords } from './numberWords'

describe('numbers as words', () => {
  it('spells one to ninety-nine, hyphenating the tens', () => {
    expect([1, 2, 7, 11, 13, 19].map(numberWords)).toEqual(['One', 'Two', 'Seven', 'Eleven', 'Thirteen', 'Nineteen'])
    expect([20, 21, 34, 40, 58, 90, 99].map(numberWords)).toEqual(['Twenty', 'Twenty-One', 'Thirty-Four', 'Forty', 'Fifty-Eight', 'Ninety', 'Ninety-Nine'])
  })

  it('uses figures from 100, and for anything that isn’t a whole number from 1', () => {
    expect(numberWords(100)).toBe('100')
    expect(numberWords(250)).toBe('250')
    expect(numberWords(0)).toBe('0')
    expect(numberWords(-3)).toBe('-3')
    expect(numberWords(2.5)).toBe('2.5')
  })
})

describe('the chapter line over a scene’s title', () => {
  it('names the chapter in words, then its title', () => {
    expect(chapterLabel(1, 'The Night Ferry')).toBe('Chapter One · The Night Ferry')
    expect(chapterLabel(2, '  The Drowned Steps ')).toBe('Chapter Two · The Drowned Steps')
    expect(chapterLabel(104, 'The Last Bell')).toBe('Chapter 104 · The Last Bell')
  })

  it('is the chapter alone with no title, and the title alone when it names itself', () => {
    expect(chapterLabel(12, '')).toBe('Chapter Twelve')
    expect(chapterLabel(1, 'Prologue')).toBe('Prologue')
    expect(chapterLabel(30, 'Epilogue: After the Storm')).toBe('Epilogue: After the Storm')
    expect(chapterLabel(3, 'Chapter 3')).toBe('Chapter 3')
    // A title that only starts with the same letters isn't one of them.
    expect(chapterLabel(4, 'Chapterhouse')).toBe('Chapter Four · Chapterhouse')
  })
})
