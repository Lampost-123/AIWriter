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

  it('follows a tag the writer put elsewhere: inside the quote, after it, before the narration, or at the paragraph’s end', () => {
    const cases: [string, string, string[]][] = [
      ['“{Mara}Get out,” she said.', '“Get out,” she said.', ['get out']],
      ['“Get out,” {Mara} she said.', '“Get out,” she said.', ['get out']],
      ['{Mara} She turned to him. “Get out.”', 'She turned to him. “Get out.”', ['get out']],
      ['“Get out,” she said. {Mara}', '“Get out,” she said. ', ['get out']],
      ['{Mara}\n“Get out.”', '\n“Get out.”', ['get out']]
    ]
    for (const [draft, page, keys] of cases) {
      const { out, speakers } = stream(draft, 3)
      expect(out, draft).toBe(page)
      expect(speakers.map((x) => [x.key, x.who]), draft).toEqual(keys.map((k) => [k, 'Mara']))
    }
  })

  it('gives each line one tag, and a tag that only says “she” names nobody', () => {
    const { speakers } = stream('{Mara}“Get out,” she said. {Tobin}“No.” {Mara}', 5)
    expect(speakers).toEqual([
      { key: 'get out', who: 'Mara', tone: '' },
      { key: 'no', who: 'Tobin', tone: '' }
    ])
    expect(stream('{she}“Fine.” {He|gruff}“Go.”', 4).speakers).toEqual([])
    // A tag before narration never reaches into the next paragraph.
    expect(stream('{Mara} She waited.\n\n“Get out,” said Tobin.', 4).speakers).toEqual([])
  })

  it('leaves braces that aren’t tags, and drops a tag cut off at the end', () => {
    expect(stream('A {note across\nlines} stays.', 4).out).toBe('A {note across\nlines} stays.')
    expect(stream('She waited. {Mara|cold', 3).out).toBe('She waited. ')
    expect(stream('No tags at all.', 2)).toEqual({ out: 'No tags at all.', speakers: [] })
  })
})
