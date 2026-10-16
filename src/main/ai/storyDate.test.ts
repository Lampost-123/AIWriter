import { describe, expect, it } from 'vitest'
import { emptySceneCard } from '@shared/defaults'
import { buildCalendar, dateOfText, type AgeHere, type SceneCalendar } from '../memory/calendar'
import { datesOf, elapsedNote, storyDateAges, storyDateLines, storyDateMarks, type DateInput } from './storyDate'

const FIT = "Make the time that has passed fit (travel, sleep, healing), and don't say more or less of it has gone by."

/** A scene and the one before it, from their cards' When alone (no calendar given). */
const cards = (now: string, then: string | undefined, otherStory = false): DateInput => ({
  scene: { card: { ...emptySceneCard(), when: now } },
  memory: {
    previous: {
      sceneId: 'p',
      title: '',
      text: 'x',
      storyId: 's',
      storyTitle: '',
      when: then,
      otherStory: otherStory ? { ended: true, timeGap: '' } : null
    }
  }
})

/** The same, with the story calendar of a whole story: the scene is the last of `whens`, the scene before the one before it. */
function withCalendar(whens: string[], extra: Partial<SceneCalendar> = {}): DateInput {
  const cal = buildCalendar(whens.map((when, i) => ({ id: `s${i + 1}`, story: 'book', when })))
  const n = whens.length
  return {
    ...cards(whens[n - 1], whens[n - 2]),
    calendar: { here: cal.dates.get(`s${n}`)!, previous: cal.dates.get(`s${n - 1}`) ?? null, landmarks: [], ages: [], ...extra }
  }
}

describe('the story date on the scene card', () => {
  it('says how long after the previous scene this one is, from both cards', () => {
    expect(storyDateLines(cards('Day 8, noon', 'Day 5, dusk'))).toEqual(['Story date: Day 8, noon (3 days since the scene before)', FIT])
    expect(storyDateLines(cards('Day 10, dawn', 'Day 9, night'))[0]).toBe('Story date: Day 10, dawn (1 day since the scene before)')
    expect(storyDateLines(cards('Day 13, dusk', 'Day 13, afternoon'))[0]).toBe(
      'Story date: Day 13, dusk (the same day as the scene before)'
    )
    // A When that can't be placed: the scene before in Adam's words, as before the calendar.
    expect(storyDateLines(cards('Spring, the year after', 'Winter'))).toEqual([`The previous scene was Winter. ${FIT}`])
    // Nothing to add to the When: no story date, and no reminder without the scene before's When.
    expect(storyDateLines(cards('Day 8', ''))).toEqual([])
    expect(storyDateLines(cards('Day 8', 'Day 5', true))).toEqual([])
  })

  it('works out a When that leans on the scene before, and says the date the sums give', () => {
    expect(storyDateLines(cards('That night', 'Day 3, dusk'))).toEqual(['Story date: Day 3, night (the same day as the scene before)', FIT])
    // The whole story's calendar: a step from a step.
    const story = withCalendar(['Day 3, evening', 'The next morning', 'Three weeks later'])
    expect(storyDateLines(story)).toEqual(['Story date: Day 25 (3 weeks since the scene before)', FIT])
    // Without it, the scene before ("The next morning") can't be placed: its words, as before.
    expect(storyDateLines(cards('Three weeks later', 'The next morning'))).toEqual([`The previous scene was The next morning. ${FIT}`])
    // A real date gets its day since the story began.
    expect(storyDateLines(withCalendar(['12 March 1820', '30 March 1820', '1 April 1820, dusk']))[0]).toBe(
      'Story date: 1 April 1820, day 21 of the story, dusk (2 days since the scene before)'
    )
  })

  it('counts from a few earlier days, more on models that read more', () => {
    const cal = buildCalendar(
      ['Day 1', 'Day 20', 'Day 30', 'Day 35', 'Day 39, dusk', 'Day 41, evening'].map((when, i) => ({
        id: `s${i + 1}`,
        story: 'book',
        when
      }))
    )
    const d = (n: number) => cal.dates.get(`s${n}`)!
    const input = withCalendar(['Day 1', 'Day 20', 'Day 30', 'Day 35', 'Day 39, dusk', 'Day 41, evening'], {
      landmarks: [
        { name: 'the start of Ch 6', date: d(4) },
        { name: 'the start of Ch 5', date: d(3) },
        { name: 'the start of Ch 4: The Siege', date: d(2) },
        { name: 'the start of Ch 1', date: d(1) }
      ]
    })
    expect(storyDateLines(input, 1)[0]).toBe('Story date: Day 41, evening (6 days since the start of Ch 6; 2 days since the scene before)')
    expect(storyDateLines(input, 3.6)[0]).toBe(
      'Story date: Day 41, evening (6 days since the start of Ch 6; 11 days since the start of Ch 5; 3 weeks since the start of Ch 4: The Siege; 2 days since the scene before)'
    )
    expect([1, 1.5, 2, 2.25, 3.6].map(storyDateMarks)).toEqual([1, 1, 2, 2, 3])
    expect([1, 1.5, 2, 3.6].map(storyDateAges)).toEqual([3, 5, 6, 6])
  })

  it('says a flashback goes back, and how far', () => {
    expect(storyDateLines(cards('Flashback: Day 2', 'Day 10'))[0]).toBe('Story date: Day 2 (8 days before the scene before, a flashback)')
    expect(storyDateLines(cards('Day 2', 'Day 10'))[0]).toBe('Story date: Day 2 (8 days before the scene before)')
  })

  it('works out the ages of those on the card, when the sums change them', () => {
    const cal = buildCalendar(['1 March 1820', '20 June 1820'].map((when, i) => ({ id: `s${i + 1}`, story: 'book', when })))
    const born: AgeHere = { age: { lo: 30, hi: 30, about: false }, basis: 'born 12 March 1790', born: true }
    const later: AgeHere = { age: { lo: 37, hi: 38, about: false }, basis: "34 at the story's start", born: false, given: 34 }
    const same: AgeHere = { age: { lo: 34, hi: 35, about: false }, basis: "34 at the story's start", born: false, given: 34 }
    const input = withCalendar(['1 March 1820', '20 June 1820'], {
      ages: [
        { name: 'Mara', age: born },
        { name: 'Tobin', age: later },
        { name: 'Ash', age: same }
      ]
    })
    expect(dateOfText(cal, '12 March 1790', null)?.year).toBe(1790)
    expect(storyDateLines(input)).toContain("Ages here: Mara 30 (born 12 March 1790); Tobin 37 or 38 (34 at the story's start)")
    // Fewer on the smallest models.
    const many = withCalendar(['Day 1'], { ages: Array.from({ length: 8 }, (_, i) => ({ name: `P${i}`, age: born })) })
    expect(
      storyDateLines(many, 1)
        .find((l) => l.startsWith('Ages here'))!
        .split('; ')
    ).toHaveLength(3)
  })
})

describe('the time since the scene before in what must stay true', () => {
  const note = (input: DateInput, inside = false): string =>
    elapsedNote({ ...input, options: {}, memory: { ...input.memory, storyId: 's' } }, inside)
  it('comes from the same sums as the story date', () => {
    expect(note(cards('Day 5', 'Day 3, dusk'))).toBe('Time: 2 days since the scene before (Day 3, dusk); this scene is Day 5')
    expect(note(withCalendar(['Day 3, evening', 'The next morning', 'Three weeks later']))).toBe(
      'Time: 3 weeks since the scene before (Day 4, morning); this scene is Day 25'
    )
    expect(note(cards('Day 3, dusk', 'Day 3, dusk'))).toBe('')
    expect(note(cards('Later that evening', 'Day 3, evening'))).toBe('')
    expect(note(cards('Day 5', 'Day 3'), true)).toBe('')
  })

  it('keeps the cards’ words, or the time gap, where the calendar can’t tell', () => {
    expect(note(cards('Spring', 'Winter'))).toBe('Time: the scene before was Winter; this scene is Spring')
    const first = cards('Day 1', 'Day 9')
    first.memory = {
      previous: {
        ...first.memory.previous!,
        storyId: 'river',
        storyTitle: 'River Days',
        otherStory: { ended: true, timeGap: 'Twenty years.' }
      }
    }
    expect(note(first)).toBe('Time since River Days: Twenty years')
  })
})

describe('the dates a briefing reads', () => {
  it('takes the story calendar when given, else the two cards; nothing from another story', () => {
    expect(datesOf(cards('That night', 'Day 3, dusk')).here?.day).toBe(3)
    expect(datesOf(cards('Day 4', 'Day 3', true)).previous).toBeNull()
    expect(datesOf(withCalendar(['Day 3', 'The next day', 'The next day'])).here?.day).toBe(5)
  })
})
