import { describe, expect, it } from 'vitest'
import { beatsDone, beatsOnPage, beatStand, cardBeatsOf, DRAFT_WORDS, draftWords, type BeatsWritten } from './beats'

describe('beats already on the page', () => {
  const beats = ['Wren and Ash stop for the night at an inn on the coast road', 'They talk about what comes next', 'Ash goes out to the stable']
  it('counts the beats whose own words are on the page, in order', () => {
    expect(beatsOnPage(beats, '')).toBe(0)
    expect(beatsOnPage(beats, null)).toBe(0)
    expect(beatsOnPage(beats, 'Wren and Ash stopped for the night at the inn on the coast road.')).toBe(1)
    // A later beat on the page means the ones before it are done too.
    expect(beatsOnPage(beats, 'Wren sat by the fire. Ash went out to the stable to see to the horses.')).toBe(3)
    expect(beatsOnPage(beats, 'They talked a while about what would come next.')).toBe(2)
  })

  it('reads curly and straight quotes alike, and skips beats of one word', () => {
    expect(beatsOnPage(['Wren’s lamp goes dark'], "Wren's lamp went dark at last.")).toBe(1)
    expect(beatsOnPage(['Storm', 'The ferry comes in early'], 'The ferry came in early, against the wind.')).toBe(2)
  })
})

describe('where the scene stands against its beats (the next-beat chip)', () => {
  const beats = ['Wren climbs the 112 steps', '  ', 'She trims the wick herself', 'The night ferry comes in early']
  it('names the next beat, then offers Mark done once all are written, then says the scene is done', () => {
    expect(cardBeatsOf(beats)).toHaveLength(3)
    expect(beatStand(beats, 0, false)).toEqual({ kind: 'next', index: 0, beat: 'Wren climbs the 112 steps', of: 3 })
    expect(beatStand(beats, 2, false)).toEqual({ kind: 'next', index: 2, beat: 'The night ferry comes in early', of: 3 })
    expect(beatStand(beats, 3, false)).toEqual({ kind: 'all', of: 3 })
    expect(beatStand(beats, 1, true)).toEqual({ kind: 'done' })
  })
  it('shows nothing for a card with no beats', () => {
    expect(beatStand([], 0, false)).toEqual({ kind: 'none' })
    expect(beatStand([' '], 0, false)).toEqual({ kind: 'none' })
    expect(beatStand([], 0, true)).toEqual({ kind: 'none' })
  })
})

describe('beats an AI draft of the whole scene wrote (Adam, 2026-10-21: written chapters never ticked their beats)', () => {
  const beats = [
    'Mara confronts the steward about the missing ledger',
    'He lies; she catches him out with the seal',
    'She leaves with the key, sure her aunt is involved'
  ]
  // The AI says each beat in its own words: few of the beats' own words are on the page.
  const page = [
    '"Where is it?" Mara set both hands flat on his desk. "The account book. The one that was on this shelf yesterday."',
    'The old man would not meet her eyes. "I could not say, miss. Perhaps your father moved it."',
    '"My father has been dead a month." She lifted the wax stamp from beside his inkwell. "And you sealed the letter that went out on Tuesday. With this."',
    'She took the iron key from its hook and was out of the door before he could rise. Only one other person had known where the book was kept. Aunt Celia.'
  ].join('\n')

  const written = (b: string[], text = page): BeatsWritten => ({ beats: b, words: draftWords(text) })

  it('counts them done although the page says them in other words', () => {
    expect(beatsOnPage(beats, page)).toBe(0)
    expect(beatsDone(beats, page, written(beats))).toBe(3)
    expect(beatsDone(beats, page, null)).toBe(0)
  })

  it('counts the card’s beats it wrote from the first only, and none on an empty page', () => {
    expect(beatsDone(beats, '', written(beats))).toBe(0)
    expect(beatsDone(beats, null, written(beats))).toBe(0)
    // A beat changed on the card since: it and those after it go back to what the page shows.
    expect(beatsDone([beats[0], 'Tobin bursts in', beats[2]], page, written(beats))).toBe(1)
    // A beat added after the draft is still to write.
    expect(beatsDone([...beats, 'The bell rings for supper'], page, written(beats))).toBe(3)
    // The words on the page still count past what the draft wrote.
    expect(beatsDone(['Mara confronts the steward', 'Mara takes the iron key from its hook'], page, written(['Mara confronts the steward']))).toBe(2)
  })

  it('counts them only while the page still has most of the draft’s words', () => {
    // Most of the draft kept, with a sentence changed: still the draft's.
    expect(beatsDone(beats, page.replace('His face went grey.', 'He said nothing at all.'), written(beats))).toBe(3)
    // Retyped, or undone back to older words: by the page's words alone.
    expect(beatsDone(beats, 'Rain all night. Nobody came to the door, and the fire burned down to embers.', written(beats))).toBe(0)
    // A draft known by no words counts for nothing.
    expect(beatsDone(beats, page, { beats, words: [] })).toBe(0)
  })

  it('knows a draft by up to 60 of its longer words, spread from its start to its end', () => {
    expect(draftWords('The cat sat on the mat, and then it slept.')).toEqual(['slept'])
    const long = Array.from({ length: 200 }, (_, i) => `word${String(i).padStart(3, '0')}x`).join(' ')
    const sample = draftWords(long)
    expect(sample).toHaveLength(DRAFT_WORDS)
    expect(sample[0]).toBe('word000x')
    expect(sample.at(-1)).toBe('word196x')
  })
})
