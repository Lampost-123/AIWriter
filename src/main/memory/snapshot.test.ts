// How an end-of-chapter snapshot is said (long story memory fix 15): what changed in the chapter, how things stand at its
// end, the days it runs, and the few facts an older chapter's line in the writer's timeline gains. Pure; invented names.

import { describe, expect, it } from 'vitest'
import { buildCalendar } from './calendar'
import { changedLines, endLines, endPart, localPart, spanOf, timelineFacts, type ChapterSnapshot } from './snapshot'

const NAMES: Record<string, string> = {
  mara: 'Mara',
  tobin: 'Tobin',
  ash: 'Ash',
  wen: 'Old Wen',
  ivo: 'Ivo',
  edric: 'Edric',
  mill: 'the Mill',
  key: 'the brass key',
  letter: 'Who sent the letter?',
  debt: 'The ferryman’s debt',
  toll: 'The toll'
}
const nameOf = (id: string): string | null => NAMES[id] ?? null

const snapshot = (over: Partial<ChapterSnapshot> = {}): ChapterSnapshot => ({
  v: 1,
  chapterId: 'c2',
  storyId: 'b1',
  sceneId: 's4',
  span: 'Day 3, dusk to Day 5, morning (2 days)',
  days: 'Day 3 to Day 5',
  changed: [
    { who: 'mara', note: 'lost her knife in the river', sc: 1 },
    { who: 'edric', note: 'died in his chair', sc: 3 },
    { who: 'mara', with: 'tobin', note: 'rivals', sc: 2 }
  ],
  learned: [
    { who: ['tobin', 'ash'], fact: 'Mara is the heir', sc: 3, how: 'saw' },
    { who: ['ivo'], fact: 'the ferry runs at dawn', sc: 4, how: 'told', from: 'wen' },
    { who: ['tobin'], fact: 'Mara sent the letter', sc: 4, wrong: true }
  ],
  threads: [
    { thread: 'letter', step: 'set up', sc: 1 },
    { thread: 'debt', step: 'paid off', sc: 4 }
  ],
  people: [
    { who: 'mara', at: 'mill', atSc: 4, looks: ['Distinguishing marks: left hand missing'], holds: ['key'] },
    { who: 'edric', dead: true },
    { who: 'tobin', believes: ['Mara sent the letter'] }
  ],
  open: ['letter', 'toll'],
  ...over
})

describe('what changed in a chapter, from the record', () => {
  it('says when it runs, each change with its scene, who learned what and how, and the plot threads', () => {
    expect(changedLines(snapshot(), nameOf)).toEqual([
      'When: Day 3, dusk to Day 5, morning (2 days)',
      'Mara: lost her knife in the river (scene 1)',
      'Edric: died in his chair (scene 3)',
      'Mara and Tobin: rivals (scene 2)',
      'Tobin and Ash learned: Mara is the heir (saw it, scene 3)',
      'Ivo learned: the ferry runs at dawn (heard it from Old Wen, scene 4)',
      'Tobin came to believe wrongly: Mara sent the letter (scene 4)',
      'Plot thread set up: Who sent the letter? (scene 1)',
      'Plot thread paid off: The ferryman’s debt (scene 4)'
    ])
  })

  it('leaves out what names an entry that is gone, and says nothing of a time it doesn’t know', () => {
    const lines = changedLines(snapshot({ span: '', changed: [{ who: 'gone', note: 'left', sc: 1 }], learned: [], threads: [{ thread: 'gone', step: 'set up', sc: 1 }] }), nameOf)
    expect(lines).toEqual([])
  })

  it('names a crowd that learned something only so far', () => {
    const lines = changedLines(snapshot({ changed: [], threads: [], span: '', learned: [{ who: ['mara', 'tobin', 'ash', 'ivo', 'wen'], fact: 'the bell rang', sc: 2, how: 'saw' }] }), nameOf)
    expect(lines).toEqual(['Mara, Tobin, Ash and 2 more learned: the bell rang (saw it, scene 2)'])
  })
})

describe('how things stand at the end of a chapter, from the record', () => {
  it('says where each character last was, their looks, what they hold and believe wrongly, who is dead, and what is open', () => {
    expect(endLines(snapshot(), nameOf)).toEqual([
      'Mara: last at the Mill (scene 4); Distinguishing marks: left hand missing; has the brass key',
      'Edric: dead',
      'Tobin: wrongly believes: Mara sent the letter',
      'Plot threads still open: Who sent the letter?; The toll'
    ])
  })
})

describe('an older chapter’s line in the writer’s timeline', () => {
  it('gains who learned what first, then threads paid off and set up, at most as many as asked', () => {
    expect(timelineFacts(snapshot(), nameOf)).toEqual(['Tobin and Ash learned: Mara is the heir', 'Ivo learned: the ferry runs at dawn'])
    expect(timelineFacts(snapshot({ learned: [] }), nameOf, 3)).toEqual(['paid off: The ferryman’s debt', 'set up: Who sent the letter?'])
    expect(timelineFacts(snapshot({ learned: [], threads: [] }), nameOf)).toEqual([])
  })
})

describe('what a summary is tied to', () => {
  it('a chapter’s own part changes with what changed in it, not with how things stand at its end; the end part the other way', () => {
    const a = snapshot()
    const moved = snapshot({ people: [{ who: 'mara', at: 'mill', atSc: 2 }] })
    expect(localPart(moved)).toBe(localPart(a))
    expect(endPart(moved)).not.toBe(endPart(a))
    const more = snapshot({ changed: [...a.changed, { who: 'tobin', note: 'cut his hand', sc: 4 }] })
    expect(localPart(more)).not.toBe(localPart(a))
    expect(endPart(more)).toBe(endPart(a))
    expect(localPart(null)).toBe('')
  })
})

describe('the days a chapter runs', () => {
  const dates = (whens: string[]) => {
    const cal = buildCalendar(whens.map((when, i) => ({ id: `s${i + 1}`, story: 'b1', when })))
    return whens.map((_, i) => cal.dates.get(`s${i + 1}`))
  }

  it('from the first dated scene to the last, with how long that is', () => {
    expect(spanOf(dates(['Day 3, dusk', 'That night', 'Day 5, morning']))).toEqual({
      span: 'Day 3, dusk to Day 5, morning (2 days)',
      days: 'Day 3 to Day 5'
    })
    expect(spanOf(dates(['12 March 1820', 'three weeks later']))).toEqual({
      span: '12 March 1820 to 2 April 1820, day 22 of the story (3 weeks)',
      days: '12 March 1820 to 2 April 1820'
    })
  })

  it('one day once, a flashback left out, and nothing when no scene is dated', () => {
    expect(spanOf(dates(['Day 3, dawn', 'Day 3, dusk']))).toEqual({ span: 'Day 3, dawn to Day 3, dusk (the same day)', days: 'Day 3' })
    expect(spanOf(dates(['Day 8', 'Flashback: Day 2', 'Day 9']))).toMatchObject({ days: 'Day 8 to Day 9' })
    expect(spanOf(dates(['', 'after the wedding']))).toEqual({ span: '', days: '' })
  })
})
