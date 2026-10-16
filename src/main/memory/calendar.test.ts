import { describe, expect, it } from 'vitest'
import type { WhenStory } from '../worldViews/when'
import {
  ageFrom,
  ageWords,
  buildCalendar,
  civilFromDays,
  dateLabel,
  dateOfText,
  daysFromCivil,
  elapsedBetween,
  elapsedWords,
  goesBack,
  goingBack,
  readAge,
  sameDay,
  sameMoment,
  storyDayWords,
  withCues,
  type Calendar,
  type StoryDate
} from './calendar'

/** A story's scenes in reading order, named s1, s2 ... after their place. */
const story = (whens: string[], storyId = 'book'): Calendar =>
  buildCalendar(whens.map((when, i) => ({ id: `s${i + 1}`, story: storyId, when })))

const at = (cal: Calendar, n: number): StoryDate => cal.dates.get(`s${n}`)!
const days = (cal: Calendar): (number | null)[] => cal.order.map((id) => cal.dates.get(id)!.day)
const gap = (cal: Calendar, a: number, b: number): string => {
  const e = elapsedBetween(at(cal, a), at(cal, b))
  return e ? elapsedWords(e) : 'unknown'
}

describe('days on the Common Era calendar', () => {
  it('counts days across months and leap years, both ways', () => {
    expect(daysFromCivil(1970, 1, 1)).toBe(0)
    expect(daysFromCivil(1820, 3, 1) - daysFromCivil(1820, 2, 28)).toBe(2)
    expect(daysFromCivil(1821, 3, 1) - daysFromCivil(1821, 2, 28)).toBe(1)
    expect(civilFromDays(daysFromCivil(1204, 3, 12))).toEqual([1204, 3, 12])
    expect(civilFromDays(daysFromCivil(-300, 6, 1))).toEqual([-300, 6, 1])
    // A day past the month's end runs on into the next.
    expect(civilFromDays(daysFromCivil(1820, 1, 35))).toEqual([1820, 2, 4])
  })
})

describe('the story calendar', () => {
  it('reads the sample world: counted days and the time of day', () => {
    const cal = story(['Day 1, dusk', 'Day 1, night', 'Day 2, morning', 'Day 3, low tide at noon'])
    expect(days(cal)).toEqual([1, 1, 2, 3])
    expect(cal.order.map((id) => dateLabel(cal.dates.get(id)))).toEqual([
      'Day 1 · dusk',
      'Day 1 · night',
      'Day 2 · morning',
      'Day 3 · noon'
    ])
    expect(at(cal, 1)).toMatchObject({ reading: 'read', leans: false, back: false, timeFrom: 'card', minute: 1110 })
    expect(gap(cal, 1, 4)).toBe('2 days')
    expect(gap(cal, 1, 2)).toBe('the same day')
    expect(elapsedBetween(at(cal, 1), at(cal, 2))).toEqual({ days: 0, minutes: 210 })
  })

  it('counts on from the dated scene before: that night, the next morning, three weeks later', () => {
    const cal = story(['Day 3, evening', 'That night', 'The next morning', 'Three weeks later', 'Two days later', 'Later that day'])
    expect(days(cal)).toEqual([3, 3, 4, 25, 27, 27])
    expect(cal.order.map((id) => dateLabel(cal.dates.get(id)))).toEqual([
      'Day 3 · evening',
      'Day 3 · night',
      'Day 4 · morning',
      'Day 25',
      'Day 27',
      'Day 27'
    ])
    expect([2, 3, 4].map((n) => at(cal, n).leans)).toEqual([true, true, true])
    expect(gap(cal, 3, 4)).toBe('3 weeks')
    expect(gap(cal, 3, 5)).toBe('3 weeks and 2 days')
  })

  it('reads real dates, with the days since the story began beside them', () => {
    const cal = story(['12 March 1820', 'the next day', '1 April 1820, dusk', 'three weeks later', 'Five days later'])
    expect(days(cal)).toEqual([1, 2, 21, 42, 47])
    expect(cal.order.map((id) => cal.dates.get(id)!.date)).toEqual([
      '12 March 1820',
      '13 March 1820',
      '1 April 1820',
      '22 April 1820',
      '27 April 1820'
    ])
    expect(storyDayWords(at(cal, 1))).toBe('')
    expect(dateLabel(at(cal, 3))).toBe('1 April 1820 · day 21 of the story · dusk')
    // Months of their real length, and leap years.
    expect(story(['30 January 1820', 'five days later']).dates.get('s2')!.date).toBe('4 February 1820')
    expect(story(['28 February 1820', 'the next day']).dates.get('s2')!.date).toBe('29 February 1820')
    expect(story(['28 February 1821', 'the next day']).dates.get('s2')!.date).toBe('1 March 1821')
    // A year told with a word is said that way.
    expect(story(['12 March, Year 3', 'the next day']).dates.get('s2')!.date).toBe('13 March, Year 3')
  })

  it('does its sums in a calendar of the world’s own, by days counted or stepped', () => {
    const cal = story(['the 3rd of Frostmoon', 'two days later', 'the 9th of Frostmoon', 'the 2nd of Thawmoon'])
    expect(at(cal, 1).date).toBe('the 3rd of Frostmoon')
    expect(days(cal)).toEqual([1, 3, 7, null])
    // A stepped day of a month the app doesn't know isn't named, only counted.
    expect(dateLabel(at(cal, 2))).toBe('Day 3 of the story')
    expect(dateLabel(at(cal, 3))).toBe('the 9th of Frostmoon · day 7 of the story')
    expect(gap(cal, 1, 3)).toBe('6 days')
    // Another month of its own: how far on isn't known.
    expect(gap(cal, 3, 4)).toBe('unknown')
  })

  it('knows a season or a year without its day, about so far apart', () => {
    const cal = story(['Year 2 of the reign, spring', 'Year 2 of the reign, autumn', 'Year 5, spring', 'June 1820', 'March 1820'])
    expect(at(cal, 1)).toMatchObject({ axis: null, year: 2, month: 3.5, date: 'spring, Year 2' })
    expect(gap(cal, 1, 2)).toBe('about 6 months')
    expect(gap(cal, 1, 3)).toBe('about 3 years')
    expect(at(cal, 4).date).toBe('June 1820')
    expect(gap(cal, 5, 4)).toBe('about 3 months')
    // A year told with a word and one told as a number are never compared.
    expect(gap(cal, 1, 4)).toBe('unknown')
    // Counted days may run across years: "Day 300, Year 1" and "Day 5, Year 2" aren't about a year apart.
    const counts = story(['Day 300, Year 1', 'Day 5, Year 2'])
    expect(gap(counts, 1, 2)).toBe('unknown')
  })

  it('says how a When was read, and never makes up a date', () => {
    const cal = story(['', 'after the wedding', 'The next day', 'Day 3', 'Days later', 'The next day', 'Dusk'])
    expect(cal.order.map((id) => cal.dates.get(id)!.reading)).toEqual(['empty', 'unclear', 'unanchored', 'read', 'vague', 'read', 'read'])
    expect(days(cal)).toEqual([null, null, null, 3, null, null, null])
    // After a vague step the day isn't known, though the order is.
    expect(at(cal, 6)).toMatchObject({ axis: null, date: '' })
    // A time of day on its own names no day.
    expect(at(cal, 7)).toMatchObject({ axis: null, time: 'dusk', minute: 1110, leans: true })
    expect(dateLabel(at(cal, 7))).toBe('dusk')
    expect(story(['Dusk']).dates.get('s1')!.reading).toBe('read')
  })

  it('keeps each book that counts its days afresh to its own count', () => {
    const items = [
      ...['Day 1', 'Day 3'].map((when, i) => ({ id: `a${i + 1}`, story: 'b1', when })),
      ...['The next morning', 'Day 1', 'Day 2'].map((when, i) => ({ id: `b${i + 1}`, story: 'b2', when }))
    ]
    const cal = buildCalendar(items, new Map<string, WhenStory>([['b2', { from: { story: 'b1', at: 2 }, fresh: true }]]))
    // Its opening step carries on from the book before; its own Day 1 starts its own count.
    expect(cal.dates.get('b1')!.day).toBe(4)
    expect(cal.dates.get('b2')!.day).toBe(1)
    expect(elapsedBetween(cal.dates.get('a2'), cal.dates.get('b2'))).toBeNull()
    expect(elapsedBetween(cal.dates.get('b2'), cal.dates.get('b3'))).toEqual({ days: 1 })
  })

  it('reads a side story where it is added, leaning on its host where it starts', () => {
    // The book's first two scenes, then the side story (started after the first), then the rest of the book.
    const items = [
      { id: 'h1', story: 'host', when: 'Day 10' },
      { id: 'h2', story: 'host', when: 'Day 20' },
      { id: 'x1', story: 'side', when: 'The next day' },
      { id: 'x2', story: 'side', when: 'Day 30' },
      { id: 'h3', story: 'host', when: 'The next day' }
    ]
    const cal = buildCalendar(items, new Map<string, WhenStory>([['side', { from: { story: 'host', at: 1 }, fresh: false }]]))
    expect(cal.dates.get('x1')!.day).toBe(11)
    // The book counts on from its own scenes, not from the side story read before it.
    expect(cal.dates.get('h3')!.day).toBe(21)
    expect(goingBack(cal, new Map(items.map((x) => [x.id, x.story])))).toEqual([])
  })
})

describe('going back in time', () => {
  it('knows a When that says it goes back on purpose', () => {
    for (const w of [
      'Flashback: Day 1',
      'flashback, ten years earlier',
      'A flashback to the siege',
      'Earlier that day',
      'Three days earlier',
      'The night before',
      'Yesterday'
    ])
      expect(goesBack(w), w).toBe(true)
    for (const w of ['Day 3', 'The next morning', 'Later that day', 'Earliest light']) expect(goesBack(w), w).toBe(false)
  })

  it('lists the scenes whose date goes back without saying so', () => {
    const cal = story([
      'Day 5',
      'Day 2',
      'Day 6',
      'Flashback: Day 1',
      'Day 7, evening',
      'Day 7, morning',
      'Day 7, night',
      'Day 7, after midnight'
    ])
    expect(goingBack(cal).map((b) => [b.sceneId, b.beforeId, b.elapsed.days])).toEqual([
      ['s2', 's1', -3],
      ['s6', 's5', 0]
    ])
  })

  it('never counts a When that takes its year from the scenes before, or a step forward', () => {
    expect(goingBack(story(['20 December 1820', '12 March', 'The next day']))).toEqual([])
    expect(goingBack(story(['Day 5', 'Flashback: Day 1', 'The next day', 'Day 6']))).toEqual([])
    // A month or a year of its own going back counts.
    expect(goingBack(story(['June 1820', 'March 1819'])).map((b) => b.sceneId)).toEqual(['s2'])
  })
})

describe('same day, same moment', () => {
  it('tells the same day by the calendar, not by the words', () => {
    const cal = story(['Day 3, dusk', 'That night', 'The next day', 'The next day', 'Dusk on Day 5', 'Day 5, dusk', 'Day 5'])
    expect(sameDay(at(cal, 1), at(cal, 2))).toBe(true)
    expect(sameDay(at(cal, 3), at(cal, 4))).toBe(false)
    expect(sameMoment(at(cal, 1), at(cal, 2))).toBe(false)
    expect(sameMoment(at(cal, 3), at(cal, 4))).toBe(false)
    expect(sameMoment(at(cal, 5), at(cal, 6))).toBe(true)
    // One says the time and the other doesn't: a new time.
    expect(sameMoment(at(cal, 6), at(cal, 7))).toBe(false)
    // Neither says it: can't be told.
    expect(sameMoment(story(['Day 5', 'Day 5']).dates.get('s1'), story(['Day 5', 'Day 5']).dates.get('s2'))).toBeNull()
    // Unknown days: can't be told.
    expect(sameDay(story(['Spring']).dates.get('s1'), story(['Spring']).dates.get('s1'))).toBeNull()
  })
})

describe('the memory’s time of day, and dates that aren’t scenes', () => {
  it('takes a time of day from the memory only for a scene with no When, and never a day', () => {
    const cal = withCues(
      story(['Day 3', '', '']),
      new Map([
        ['s2', 'late evening, the lamps lit'],
        ['s3', 'the next morning'],
        ['s1', 'night']
      ])
    )
    expect(at(cal, 2)).toMatchObject({ axis: null, day: null, time: 'late evening', timeFrom: 'memory' })
    expect(at(cal, 3)).toMatchObject({ axis: null, day: null, time: 'morning', timeFrom: 'memory' })
    // A scene with a When keeps it.
    expect(at(cal, 1)).toMatchObject({ time: '', timeFrom: null })
  })

  it('reads an event’s When where the calendar stands at a scene', () => {
    const cal = story(['Day 10, Year 3', 'Day 41, Year 3, evening'])
    const siege = dateOfText(cal, 'Day 20', 's2')!
    expect(siege).toMatchObject({ year: 3, date: 'Day 20, Year 3' })
    expect(elapsedWords(elapsedBetween(siege, at(cal, 2))!)).toBe('3 weeks')
    expect(dateOfText(cal, 'The next day', 's2')).toBeNull()
    expect(dateOfText(cal, 'after the wedding', 's2')).toBeNull()
  })
})

describe('gaps in words', () => {
  it('says days, weeks, months and years', () => {
    const words = (days: number): string => elapsedWords({ days })
    expect([0, 1, 2, 13, 14, 21, 23, 69].map(words)).toEqual([
      'the same day',
      '1 day',
      '2 days',
      '13 days',
      '2 weeks',
      '3 weeks',
      '3 weeks and 2 days',
      '9 weeks and 6 days'
    ])
    expect(words(121)).toBe('about 4 months (121 days)')
    expect(words(-365)).toBe('about a year (365 days)')
    expect(words(1100)).toBe('about 3 years')
    const months = (m: number): string => elapsedWords({ days: 0, months: m })
    expect([1, 6, 12, 18, 36].map(months)).toEqual(['about 1 month', 'about 6 months', 'about a year', 'about 18 months', 'about 3 years'])
  })
})

describe('ages', () => {
  it('reads a birth date or an age at a date, and leaves a guess alone', () => {
    expect(readAge('born 12 March 1790')).toEqual({ kind: 'born', when: '12 March 1790' })
    expect(readAge('b. 1790')).toEqual({ kind: 'born', when: '1790' })
    expect(readAge('Born in the winter of 1786 (a hard one)')).toEqual({ kind: 'born', when: 'the winter of 1786' })
    expect(readAge('34')).toEqual({ kind: 'age', years: 34, at: '', start: false })
    expect(readAge('34 years old.')).toEqual({ kind: 'age', years: 34, at: '', start: false })
    expect(readAge('thirty-four, looks older')).toEqual({ kind: 'age', years: 34, at: '', start: false })
    expect(readAge('Seventeen in the spring of 1815')).toEqual({ kind: 'age', years: 17, at: 'the spring of 1815', start: false })
    expect(readAge('17 (in 1815)')).toEqual({ kind: 'age', years: 17, at: '1815', start: false })
    expect(readAge('34 (looks older)')).toEqual({ kind: 'age', years: 34, at: '', start: false })
    expect(readAge('34 at the start of the story')).toEqual({ kind: 'age', years: 34, at: '', start: true })
    expect(readAge('aged 9 on Day 3')).toEqual({ kind: 'age', years: 9, at: 'Day 3', start: false })
    for (const guess of [
      'about 40',
      'mid-thirties',
      '40s',
      '34 or 35',
      '34-ish',
      'forty-ish',
      'old',
      '',
      'born on the day of the flood',
      '1790'
    ])
      expect(readAge(guess), guess).toBeNull()
  })

  it('works out an age for a date from a birth date', () => {
    const cal = story(['20 June 1820', '1 March 1820', '1820'])
    const born = (when: string): StoryDate => dateOfText(cal, when, null)!
    expect(ageFrom({ born: born('12 March 1790') }, at(cal, 1))).toEqual({ lo: 30, hi: 30, about: false })
    expect(ageFrom({ born: born('12 March 1790') }, at(cal, 2))).toEqual({ lo: 29, hi: 29, about: false })
    expect(ageWords(ageFrom({ born: born('1790') }, at(cal, 1))!)).toBe('29 or 30')
    expect(ageWords(ageFrom({ born: born('12 March 1790') }, at(cal, 3))!)).toBe('29 or 30')
    // A counted day has no year to go by.
    expect(ageFrom({ born: born('12 March 1790') }, story(['Day 4']).dates.get('s1')!)).toBeNull()
    // Years told with a word are compared with each other only.
    const reign = story(['Day 3, Year 330'])
    expect(ageWords(ageFrom({ born: dateOfText(reign, 'Year 312', null)! }, at(reign, 1))!)).toBe('17 or 18')
    expect(ageFrom({ born: born('1790') }, at(reign, 1))).toBeNull()
  })

  it('works out an age for a date from an age at another', () => {
    const cal = story(['Day 1', 'Day 41', 'Day 1101', 'Day 1462'])
    expect(ageWords(ageFrom({ years: 34, then: at(cal, 1) }, at(cal, 1))!)).toBe('34')
    expect(ageWords(ageFrom({ years: 34, then: at(cal, 1) }, at(cal, 2))!)).toBe('34 or 35')
    expect(ageWords(ageFrom({ years: 34, then: at(cal, 1) }, at(cal, 3))!)).toBe('37 or 38')
    // Back in time too (a flashback).
    expect(ageWords(ageFrom({ years: 34, then: at(cal, 3) }, at(cal, 1))!)).toBe('30 or 31')
    // Only months or years known: about right.
    const rough = story(['spring, 1815', 'autumn, 1820'])
    expect(ageWords(ageFrom({ years: 17, then: at(rough, 1) }, at(rough, 2))!)).toBe('about 22')
    expect(ageFrom({ years: 17, then: at(rough, 1) }, story(['Day 3']).dates.get('s1')!)).toBeNull()
  })
})
