import { describe, expect, it } from 'vitest'
import { SpeakerTagFilter } from './speakerTags'

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

  it('leaves braces that aren’t tags, and drops a tag cut off at the end', () => {
    expect(stream('A {note across\nlines} stays.', 4).out).toBe('A {note across\nlines} stays.')
    expect(stream('She waited. {Mara|cold', 3).out).toBe('She waited. ')
    expect(stream('No tags at all.', 2)).toEqual({ out: 'No tags at all.', speakers: [] })
  })
})
