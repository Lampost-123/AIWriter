import { describe, expect, it } from 'vitest'
import { aboutWords, pricePerMillionWords, shortWords, wordsFor } from './words'

describe('words for tokens', () => {
  it('rounds to two figures', () => {
    expect(wordsFor(128_000)).toBe(96_000)
    expect(wordsFor(32_768)).toBe(25_000)
    expect(wordsFor(16_000)).toBe(12_000)
    expect(wordsFor(0)).toBe(0)
  })
  it('says it in plain words', () => {
    expect(aboutWords(128_000)).toBe('about 96,000 words')
    expect(aboutWords(2_000_000)).toBe('about 1.5 million words')
    expect(aboutWords(1_048_576)).toBe('about 790,000 words')
  })
  it('has a short form for the list', () => {
    expect(shortWords(128_000)).toBe('96K')
    expect(shortWords(2_000_000)).toBe('1.5M')
    expect(shortWords(null)).toBe('—')
  })
  it('prices a million words', () => {
    // $3 a million tokens is $4 a million words.
    expect(pricePerMillionWords(0.000003)).toBe('$4')
    expect(pricePerMillionWords(0)).toBe('Free')
    expect(pricePerMillionWords(null)).toBe('—')
  })
})
