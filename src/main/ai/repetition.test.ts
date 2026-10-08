import { describe, expect, it } from 'vitest'
import { beatsOnPage, REPEATED_MOST, repeatedPhrases, speechSamples } from './repetition'

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

describe('phrases the scene has used already', () => {
  it('lists sample lines on the page, stock tics and runs of words said twice, each once, at most eight', () => {
    const text = [
      'The rain went on over the roof. Neither of them said anything.',
      'Ash set the lantern on the table by the window and sat.',
      'Later he set the lantern on the table by the window again. ‘That’s the way of it,’ he said.',
      'The rain went on over the roof.'
    ].join('\n\n')
    const got = repeatedPhrases({ text, samples: ['That’s the way of it.', 'Bearings first, then talk.'] })
    expect(got[0]).toBe('That’s the way of it')
    expect(got).toContain('the rain went on')
    expect(got).toContain('neither of them said')
    expect(got.some((p) => p.includes('lantern on the table'))).toBe(true)
    // Not again in other words: "rain went on over the roof" is the rain line already listed.
    expect(got.some((p) => p.startsWith('rain went on over'))).toBe(false)
    expect(got).not.toContain('Bearings first, then talk')
    expect(got.length).toBeLessThanOrEqual(REPEATED_MOST)
  })

  it('says nothing for a scene with nothing on the page, or nothing said twice', () => {
    expect(repeatedPhrases({ text: '' })).toEqual([])
    expect(repeatedPhrases({ text: 'She opened the door and went down to the harbour.' })).toEqual([])
  })

  it('caps the list', () => {
    const text = Array.from({ length: 20 }, (_, i) => `alpha${i} bravo${i} charlie${i} delta${i} echo${i}. alpha${i} bravo${i} charlie${i} delta${i} echo${i}.`).join(' ')
    expect(repeatedPhrases({ text, most: 3 })).toHaveLength(3)
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
