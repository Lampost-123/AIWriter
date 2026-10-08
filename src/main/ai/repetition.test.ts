import { describe, expect, it } from 'vitest'
import { beatsOnPage, speechSamples, STOCK_TICS } from './repetition'

describe('speech samples', () => {
  it('keeps only what is said: the words in quote marks, or a bare line that is not narration', () => {
    expect(speechSamples('“Bearings first,” she said.\nHe looked at the fire.\n‘That’s the way of it.’\nMove.\n- “Not again.”')).toEqual([
      'Bearings first',
      'That’s the way of it.',
      'Move.',
      'Not again.'
    ])
    expect(speechSamples('She said nothing for a while.')).toEqual([])
    expect(speechSamples('')).toEqual([])
  })
})

describe('stock tics', () => {
  it('each finds its tic in its usual wordings, and not in plain words', () => {
    const tic = (label: string): RegExp => STOCK_TICS.find((t) => t.label === label)!.re
    expect(tic('the rain went on').test('The rain kept on over the roof.')).toBe(true)
    expect(tic('neither of them said').test('Neither of them spoke.')).toBe(true)
    expect(tic('let out a breath').test('She let out a slow breath.')).toBe(true)
    expect(STOCK_TICS.some((t) => t.re.test('She opened the door and went down to the harbour.'))).toBe(false)
  })
})

describe('beats already on the page', () => {
  const beats = ['Wren and Ash stop for the night at an inn on the coast road', 'They talk about what comes next', 'Ash goes out to the stable']
  it('counts the beats whose own words are on the page, in order', () => {
    expect(beatsOnPage(beats, '')).toBe(0)
    expect(beatsOnPage(beats, 'Wren and Ash stopped for the night at the inn on the coast road.')).toBe(1)
    // A later beat on the page means the ones before it are done too.
    expect(beatsOnPage(beats, 'Wren sat by the fire. Ash went out to the stable to see to the horses.')).toBe(3)
    expect(beatsOnPage(beats, 'They talked a while about what would come next.')).toBe(2)
  })
})
