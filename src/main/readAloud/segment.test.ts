import { describe, expect, it } from 'vitest'
import {
  CLIP_MAX,
  PARAGRAPH_REST_MS,
  quickStart,
  restBetween,
  segmentParagraph,
  sentencesOf,
  stressed,
  TURN_REST_MS,
  withItalics
} from './segment'

const words = (u: { para: string; from: number; to: number }): string => u.para.slice(u.from, u.to)

describe('splitting a paragraph into clips', () => {
  it('packs short sentences of narration together, and keeps every clip where it is in the paragraph', () => {
    const text = 'The rain came. It did not stop. The river rose in the night and took the bridge with it, and nobody slept.'
    const clips = segmentParagraph('p1', text)
    expect(clips).toHaveLength(1)
    expect(words(clips[0])).toBe(text)
    expect(clips[0]).toMatchObject({ pid: 'p1', role: 'narrator', from: 0, to: text.length })
  })

  it('never puts a quote in the same clip as the narration around it, and keeps a quote of several sentences whole', () => {
    const text = 'Mara turned. “Go to your room now! And stay there.” She shut the door.'
    const clips = segmentParagraph('p1', text)
    expect(clips.map((c) => [c.role, words(c)])).toEqual([
      ['narrator', 'Mara turned.'],
      ['other', '“Go to your room now! And stay there.”'],
      ['narrator', 'She shut the door.']
    ])
    expect(clips[1].quote).toEqual({ at: 13, len: 38 })
  })

  it('cuts a very long sentence at a comma, so no clip is unwieldy', () => {
    const long = Array.from({ length: 30 }, (_, i) => `the ${i}th lantern swinging`).join(', ') + '.'
    const clips = segmentParagraph('p1', long)
    expect(clips.length).toBeGreaterThan(1)
    for (const c of clips) expect(c.to - c.from).toBeLessThanOrEqual(CLIP_MAX)
    expect(clips.map(words).join(' ')).toBe(long)
  })

  it('starts where reading starts inside the paragraph', () => {
    const text = 'First she waited. Then she ran for the gate, as fast as she could.'
    const clips = segmentParagraph('p1', text, text.indexOf('Then'))
    expect(clips.map(words)).toEqual(['Then she ran for the gate, as fast as she could.'])
    // A start in the middle of a sentence reads from there.
    expect(words(segmentParagraph('p1', text, text.indexOf('ran'))[0])).toBe('ran for the gate, as fast as she could.')
  })

  it('treats a line break as the end of a sentence', () => {
    const text = 'A list of what was lost\nThe boat. The nets.'
    expect(sentencesOf({ para: text, from: 0, to: text.length })).toEqual([
      [0, 23],
      [24, 33],
      [34, 43]
    ])
  })
})

describe('a quick start', () => {
  it('cuts the first clip down to its first sentence, so the sound starts quickly', () => {
    const text = 'The lamps along the harbour wall went out one by one. Then the dark came down over the water like a cloth.'
    const clips = quickStart(segmentParagraph('p1', text))
    expect(clips.map(words)).toEqual([
      'The lamps along the harbour wall went out one by one.',
      'Then the dark came down over the water like a cloth.'
    ])
  })

  it('keeps a very short first sentence with the next, since on its own it comes out off the voice', () => {
    const text = 'No. She would not go back there, not for anything in the world.'
    expect(quickStart(segmentParagraph('p1', text)).map(words)).toEqual([text])
  })
})

describe('the breath between clips', () => {
  it('rests between paragraphs and where the voice changes, and not between clips of one voice', () => {
    const a = segmentParagraph('p1', 'He waited. “Come in,” she said.')
    const b = segmentParagraph('p2', 'The door opened.')
    expect(restBetween(a[0], a[1])).toBe(TURN_REST_MS)
    expect(restBetween(a[2], b[0])).toBe(PARAGRAPH_REST_MS)
    expect(restBetween(b[0], undefined)).toBe(0)
  })
})

describe('italics', () => {
  const text = 'She had never, not once, said she was sorry. He sighs. Then she *meant* it.'
  it('finds the words set in italics for stress, but not a written sound or a long run', () => {
    const at = (w: string): [number, number] => [text.indexOf(w), text.indexOf(w) + w.length]
    expect(stressed(text, [at('never'), at('sighs'), at('said she was sorry')], 0, text.length)).toEqual(['never'])
    // Only inside the clip.
    expect(stressed(text, [at('never')], 30, text.length)).toEqual([])
  })

  it('puts asterisks around italics, so written sounds in italics can be found', () => {
    const t = 'He sighs and goes.'
    expect(withItalics(t, [[3, 8]], 0, t.length)).toBe('He *sighs* and goes.')
    expect(withItalics(t, [[3, 8]], 6, t.length)).toBe('*hs* and goes.')
  })
})
