import { describe, expect, it } from 'vitest'
import { HOW_NOTE, MARK_PROMPT, MOOD_NOTE } from '../readAloud/speakers'
import { NARRATION_TAG_LINE, SPEAKER_TAG_LINE, SpeakerTagFilter } from './speakerTags'

describe('what the writer is asked for', () => {
  it('is the same kind of note the marker writes: how each line is said always, pace and sound when they apply', () => {
    expect(SPEAKER_TAG_LINE).toContain(HOW_NOTE)
    expect(MARK_PROMPT([])).toContain(HOW_NOTE)
    expect(NARRATION_TAG_LINE).toContain(MOOD_NOTE)
    expect(MARK_PROMPT([])).toContain(MOOD_NOTE)
    expect(SPEAKER_TAG_LINE).toContain('how it is said (always)')
    expect(SPEAKER_TAG_LINE).toContain('{Tobin|thick with tears, barely holding together|slow|sob}')
    expect(NARRATION_TAG_LINE).toContain('carries on until the next tilde tag')
  })
})

/** Streams `text` in chunks of `size` and gives back what the page gets, and the speakers. */
function stream(text: string, size: number) {
  const f = new SpeakerTagFilter()
  let out = ''
  for (let i = 0; i < text.length; i += size) out += f.push(text.slice(i, i + size))
  out += f.flush()
  return { out, speakers: f.speakers(out) }
}

const DRAFT =
  'The door opened. {Mara|coldly, barely above a whisper}“Get out,” she said. {Tobin}“No.”\n\n{the guard|bored}“Move along.” Nobody moved. {Mara}“Fine,” she said, {Mara|softer}“have it your way.”'
const PAGE = 'The door opened. “Get out,” she said. “No.”\n\n“Move along.” Nobody moved. “Fine,” she said, “have it your way.”'

describe('the writer’s speaker tags', () => {
  it('never reach the page, in chunks of any size, and say who says each line and how', () => {
    for (const size of [1, 2, 3, 7, 50, 1000]) {
      const { out, speakers } = stream(DRAFT, size)
      expect(out, `chunks of ${size}`).toBe(PAGE)
      expect(speakers).toEqual([
        { key: 'get out', who: 'Mara', tone: 'coldly, barely above a whisper' },
        { key: 'no', who: 'Tobin', tone: '' },
        { key: 'move along', who: 'the guard', tone: 'bored' },
        { key: 'fine', who: 'Mara', tone: '' },
        { key: 'have it your way', who: 'Mara', tone: 'softer' }
      ])
    }
  })

  it('says how the narrator reads a sentence, from a tilde tag', () => {
    const { out, speakers } = stream('{~hushed, dread building}The stairs went on. {Mara}“Wait.”', 4)
    expect(out).toBe('The stairs went on. “Wait.”')
    expect(speakers).toEqual([
      { key: '~the stairs went on', who: '', tone: 'hushed, dread building' },
      { key: 'wait', who: 'Mara', tone: '' }
    ])
  })

  it('names speech in italics too', () => {
    const { out, speakers } = stream('{Ring|sly}*Go on,* said the ring. {Ring}*Take the floor, boy.*', 5)
    expect(out).toBe('*Go on,* said the ring. *Take the floor, boy.*')
    expect(speakers).toEqual([
      { key: 'go on', who: 'Ring', tone: 'sly' },
      { key: 'take the floor boy', who: 'Ring', tone: '' }
    ])
  })

  it('takes out a long narration mood, and a long name, so neither reaches the page', () => {
    const long = '{~hushed and tight, dread building with every careful step up the stairs}The stairs went on.'
    expect(stream(long, 5)).toEqual({
      out: 'The stairs went on.',
      speakers: [{ key: '~the stairs went on', who: '', tone: 'hushed and tight, dread building with every careful step up the stairs' }]
    })
    expect(stream('{Mara the ferry woman from the harbour who never smiles at anyone|cold}“Go.”', 4).out).toBe('“Go.”')
  })

  it('gives a tag to the next line in its paragraph, or the line it sits inside', () => {
    const { out, speakers } = stream('{Mara|cold} Mara turned. “Get out.”\n\n“{Tobin|dry}No.” {Mara}He left. “Good.”\n\n{Tobin}Nothing.\n\n“Wait.”', 3)
    expect(out).toBe('Mara turned. “Get out.”\n\n“No.” He left. “Good.”\n\nNothing.\n\n“Wait.”')
    expect(speakers).toEqual([
      { key: 'get out', who: 'Mara', tone: 'cold' },
      { key: 'no', who: 'Tobin', tone: 'dry' },
      { key: 'good', who: 'Mara', tone: '' }
    ])
  })

  it('reads pace and sound as the marker does', () => {
    const { speakers } = stream('{Mara|thick with tears|slow|sob}“I can’t.”', 4)
    expect(speakers[0]).toMatchObject({ key: 'i can t', who: 'Mara', tone: 'thick with tears', pace: 'slow' })
    expect(speakers[0].sound).toBeTruthy()
  })

  it('leaves braces that aren’t tags, and drops a tag cut off at the end', () => {
    expect(stream('A {note across\nlines} stays.', 4).out).toBe('A {note across\nlines} stays.')
    expect(stream('She waited. {Mara|cold', 3).out).toBe('She waited. ')
    expect(stream('No tags at all.', 2)).toEqual({ out: 'No tags at all.', speakers: [] })
  })
})
