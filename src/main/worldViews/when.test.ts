import { describe, expect, it } from 'vitest'
import { compareKeys, dayName, dayWords, parseWhen, placeWhens } from './when'

const parts = (text: string) => {
  const p = parseWhen(text)
  return p && { year: p.year, month: p.month, day: p.day, minute: p.minute }
}

/** The texts in the order the timeline puts them (readable ones only, by key then reading order). */
const ordered = (texts: string[]): string[] => {
  const placed = placeWhens(texts)
  return texts
    .map((t, i) => ({ t, i, p: placed[i] }))
    .filter((x) => x.p)
    .sort((a, b) => compareKeys(a.p!.key, b.p!.key) || a.i - b.i)
    .map((x) => x.t)
}

describe('reading a When box', () => {
  it('reads days, years and times of day in a world calendar', () => {
    expect(parts('Day 12, Year 3, dusk')).toEqual({ year: 3, month: null, day: 12, minute: 1110 })
    expect(parts('Year three, day twelve')).toEqual({ year: 3, month: null, day: 12, minute: null })
    expect(parts('the twelfth day of the third year')).toEqual({ year: 3, month: null, day: 12, minute: null })
    expect(parts('Day 12 of the siege, at first light')).toEqual({ year: null, month: null, day: 12, minute: 330 })
    expect(parts('Y3 D12')).toEqual({ year: 3, month: null, day: 12, minute: null })
  })

  it('reads month names, ordinals and numbers', () => {
    expect(parts('12 March 1204')).toEqual({ year: 1204, month: 3, day: 12, minute: null })
    expect(parts('March 12th, 1204, late evening')).toEqual({ year: 1204, month: 3, day: 12, minute: 1260 })
    expect(parts('the 3rd of Sept')).toEqual({ year: null, month: 9, day: 3, minute: null })
    expect(parts('June 1204')).toEqual({ year: 1204, month: 6, day: null, minute: null })
    expect(parts('1204-03-12')).toEqual({ year: 1204, month: 3, day: 12, minute: null })
    expect(parts('12/03/1204')).toEqual({ year: 1204, month: 3, day: 12, minute: null })
    expect(parts('03/25/1204')).toEqual({ year: 1204, month: 3, day: 25, minute: null })
    expect(parts('1204')).toEqual({ year: 1204, month: null, day: null, minute: null })
    expect(parts('300 BC')).toEqual({ year: -300, month: null, day: null, minute: null })
    expect(parts('Year 312 after the Founding')).toEqual({ year: 312, month: null, day: null, minute: null })
  })

  it('reads clock times and seasons', () => {
    expect(parts('Day 4, 3pm')?.minute).toBe(900)
    expect(parts('Day 4, 3 p.m.')?.minute).toBe(900)
    expect(parts('Day 4 at 15:30')?.minute).toBe(930)
    expect(parts("Day 4, three o'clock")?.minute).toBe(180)
    expect(parts('Midnight')?.minute).toBe(1440)
    expect(parts('Spring of Year 3')).toEqual({ year: 3, month: 3.5, day: null, minute: null })
    expect(parts('Year 3, late winter')?.month).toBeCloseTo(13.1)
  })

  it('reads steps from the scene before', () => {
    expect(parseWhen('The next day')?.step).toEqual({ unit: 'day', n: 1 })
    expect(parseWhen('the following morning')).toMatchObject({ step: { unit: 'day', n: 1 }, minute: 540 })
    expect(parseWhen('Two days later')?.step).toMatchObject({ unit: 'day', n: 2 })
    expect(parseWhen('a week later')?.step).toMatchObject({ unit: 'day', n: 7 })
    expect(parseWhen('Three years later')?.step).toMatchObject({ unit: 'year', n: 3 })
    expect(parseWhen('Later that night')).toMatchObject({ step: { unit: 'day', n: 0 }, minute: 1320 })
    expect(parseWhen('the morning after')).toMatchObject({ step: { unit: 'day', n: 1 }, minute: 540 })
    expect(parseWhen('days later')?.step).toMatchObject({ unit: 'day', n: 1, vague: true })
  })

  it("leaves text it can't place unread rather than guessing", () => {
    expect(parseWhen('')).toBeNull()
    expect(parseWhen('   ')).toBeNull()
    expect(parseWhen('Long ago')).toBeNull()
    expect(parseWhen('the winter before the war')).toBeNull()
    expect(parseWhen('the day after the battle')).toBeNull()
    expect(parseWhen('the day of the festival')).toBeNull()
    expect(parseWhen('Soon')).toBeNull()
    // Times that sound like ties are still times.
    expect(parts('Just before dawn')?.minute).toBe(270)
    expect(parts('after dark')?.minute).toBe(1230)
  })

  it('never takes a number that counts something else for a date', () => {
    for (const text of [
      '3 days before the wedding',
      '5 years ago',
      'Summer, 3 years after the war',
      'Chapter 3',
      'the 3rd, after the battle',
      'Day one hundred',
      'a hundred years later'
    ]) {
      expect(parseWhen(text), text).toBeNull()
    }
    expect(parts('Day 12, hour 3')).toEqual({ year: null, month: null, day: 12, minute: null })
    expect(parts('Monday 12th')).toEqual({ year: null, month: null, day: 12, minute: null })
    expect(parts('in 1204')).toEqual({ year: 1204, month: null, day: null, minute: null })
  })

  it('leaves a numbered week unread, since it has no place in the calendar here', () => {
    expect(parseWhen('Week 3')).toBeNull()
    expect(parseWhen('Week 3, Day 2')).toBeNull()
    expect(parseWhen('Day 2 of week three')).toBeNull()
    // A step of weeks is still a step.
    expect(parseWhen('Two weeks later')?.step).toMatchObject({ unit: 'day', n: 14 })
  })

  it('reads May, March and fall as a month or season only where they are one', () => {
    expect(parseWhen('I may go')).toBeNull()
    expect(parseWhen('The march to the sea')).toBeNull()
    expect(parseWhen('10 days after the fall')).toBeNull()
    expect(parseWhen('After the fall')).toBeNull()
    expect(parts('May')?.month).toBe(5)
    expect(parts('early May')?.month).toBe(5)
    expect(parts('May 5')).toEqual({ year: null, month: 5, day: 5, minute: null })
    expect(parts('the 5th of May')).toEqual({ year: null, month: 5, day: 5, minute: null })
    expect(parts('the 3rd of March')).toEqual({ year: null, month: 3, day: 3, minute: null })
    expect(parts('fall of 1204')).toEqual({ year: 1204, month: 9.5, day: null, minute: null })
    expect(parts('Fall, Year 3')).toEqual({ year: 3, month: 9.5, day: null, minute: null })
  })

  it('reads numbers written with a hyphen as one number', () => {
    expect(parts('the twenty-first of June')).toEqual({ year: null, month: 6, day: 21, minute: null })
    expect(parts('Day twenty-one')).toEqual({ year: null, month: null, day: 21, minute: null })
  })
})

describe('placing When boxes in reading order', () => {
  it('orders by the in-world date, then the time of day', () => {
    const days = ['Day 3, dusk', 'Day 1', 'Day 3, dawn', 'Day 2, night']
    expect(ordered(days)).toEqual(['Day 1', 'Day 2, night', 'Day 3, dawn', 'Day 3, dusk'])
    const dates = ['12 March 1204', '2 January 1205', '30 December 1204']
    expect(ordered(dates)).toEqual(['12 March 1204', '30 December 1204', '2 January 1205'])
  })

  it('takes a year or month left out from the dated scene before', () => {
    const [a, b, c] = placeWhens(['Day 12, Year 3', 'Day 14', 'Day 12, Year 2'])
    expect(b!.key[0]).toBe(3)
    expect(compareKeys(c!.key, a!.key)).toBeLessThan(0)
    expect(compareKeys(b!.key, a!.key)).toBeGreaterThan(0)
    const [, fifth] = placeWhens(['3 March 1204', 'the 5th'])
    expect([fifth!.key[0], fifth!.key[2], fifth!.key[3]]).toEqual([1204, 3, 5])
    // Nothing wraps round: only Adam knows whether a year went by.
    const [dec, mar] = placeWhens(['December, Year 2', 'March'])
    expect(compareKeys(mar!.key, dec!.key)).toBeLessThan(0)
    // Unless he says so.
    const [dec2, next] = placeWhens(['December, Year 2', 'next spring'])
    expect(next!.key[0]).toBe(3)
    expect(compareKeys(next!.key, dec2!.key)).toBeGreaterThan(0)
  })

  it('steps from the dated scene before, and needs one to step from', () => {
    const [a, b, c] = placeWhens(['Day 12, Year 3, dusk', 'The next day', 'Later that night'])
    expect(b!.day).toBe(placeWhens(['Day 13, Year 3'])[0]!.day)
    expect(c!.day).toBe(b!.day)
    expect(compareKeys(c!.key, b!.key)).toBeGreaterThan(0)
    expect(compareKeys(b!.key, a!.key)).toBeGreaterThan(0)
    expect(placeWhens(['The next day'])[0]).toBeNull()
    expect(placeWhens(['Spring, Year 3', 'The next day'])[1]).toBeNull()
  })

  it('puts a time of day on its own later the same day, without naming the day', () => {
    const [a, b] = placeWhens(['Day 12, morning', 'Dusk'])
    expect(compareKeys(b!.key, a!.key)).toBeGreaterThan(0)
    expect(b!.day).toBeNull()
    expect(placeWhens(['Dusk'])[0]).toBeNull()
  })

  it('names the same day the same way, however it is written', () => {
    const placed = placeWhens(['Day 12, Year 3, dawn', 'Day 12, Year 3, at dusk', 'Year 3, Day 12', 'Day 12', 'Day 13'])
    expect(new Set(placed.slice(0, 4).map((p) => p!.day)).size).toBe(1)
    expect(placed[4]!.day).not.toBe(placed[0]!.day)
    // A day of the month is never the same as a count of days.
    const [count, date] = placeWhens(['Day 3, Year 1', '3 March, Year 1'])
    expect(count!.day).not.toBe(date!.day)
  })

  it('puts a text that names its own day and a step on the day it names', () => {
    const [ten, twelve] = placeWhens(['Day 10', 'Day 12, 3 hours later'])
    expect(twelve!.day).toBe(placeWhens(['Day 12'])[0]!.day)
    expect(compareKeys(twelve!.key, ten!.key)).toBeGreaterThan(0)
  })

  it('keeps each book that counts its days afresh to its own calendar', () => {
    const placed = placeWhens([{ text: 'Day 1' }, { text: 'Day 2' }, { text: 'Day 1', fresh: true }, { text: 'Day 2' }])
    // Book 2's days are not Book 1's days...
    expect(placed[2]!.day).not.toBe(placed[0]!.day)
    // ...and come after them.
    expect(ordered(['Day 1', 'Day 2'])).toEqual(['Day 1', 'Day 2'])
    expect(compareKeys(placed[2]!.key, placed[1]!.key)).toBeGreaterThan(0)
    expect(compareKeys(placed[3]!.key, placed[2]!.key)).toBeGreaterThan(0)
    // Nothing steps across into a new book.
    expect(placeWhens([{ text: 'Day 1' }, { text: 'The next day', fresh: true }])[1]).toBeNull()
    // A book with no years sorts after the last year named before it; dates with a year are shared.
    const years = placeWhens([
      { text: 'Day 1, Year 300' },
      { text: 'Day 40' },
      { text: 'Day 41', fresh: true },
      { text: 'Day 2, Year 301' }
    ])
    expect(compareKeys(years[2]!.key, years[1]!.key)).toBeGreaterThan(0)
    expect(compareKeys(years[3]!.key, years[2]!.key)).toBeGreaterThan(0)
    const [a, b] = placeWhens([{ text: 'Day 5, Year 2' }, { text: 'Day 5, Year 2', fresh: true }])
    expect(a!.day).toBe(b!.day)
  })

  it('reads an event on its own: it takes only a year, and gives nothing to the scenes after it', () => {
    const placed = placeWhens([
      { text: 'Day 40, Year 300' },
      { text: 'Day 1, Year 1', aside: true },
      { text: 'Day 41' },
      { text: 'Day 9', aside: true }
    ])
    expect(placed[2]!.key[0]).toBe(300)
    expect(placed[3]!.key[0]).toBe(300)
    expect(placeWhens([{ text: 'Day 1' }, { text: 'The next day', aside: true }])[1]).toBeNull()
  })

  it('keeps reading order for the same moment', () => {
    expect(ordered(['Day 2', 'Day 2', 'Day 1'])).toEqual(['Day 1', 'Day 2', 'Day 2'])
    const placed = placeWhens(['Day 2, dusk', 'Day 2'])
    expect(compareKeys(placed[0]!.key, placed[1]!.key)).toBe(0)
  })
})

describe('the words that name the day', () => {
  it('leave out the time of day', () => {
    expect(dayWords('Day 12, Year 3, dusk')).toBe('Day 12, Year 3')
    expect(dayWords('Day 12, Year 3, at dusk')).toBe('Day 12, Year 3')
    expect(dayWords('12 March 1204 at 3pm')).toBe('12 March 1204')
    expect(dayWords('Late evening, the 3rd of March')).toBe('the 3rd of March')
    expect(dayWords('Day 12')).toBe('Day 12')
  })

  it('make a plain sentence, whatever words surround the day', () => {
    expect(dayName('Day 12')).toBe('Day 12')
    expect(dayName('On Day 12')).toBe('Day 12')
    expect(dayName('Dusk on Day 12')).toBe('Day 12')
    expect(dayName('Day 12.')).toBe('Day 12')
    expect(dayName('Day 12, Year 3, at dusk')).toBe('Day 12, Year 3')
    expect(dayName('The morning of the 3rd of March')).toBe('3 March')
    expect(dayName('March 12th, 1204, late evening')).toBe('12 March 1204')
    expect(dayName('3 March, Year 3')).toBe('3 March, Year 3')
    expect(dayName('12 March 300 BC')).toBe('12 March 300 BC')
    // Anything else in Adam's own words.
    expect(dayName('Dusk on the 3rd')).toBe('the 3rd')
    expect(dayName('Day 3 of spring')).toBe('Day 3 of spring')
    // No day of its own.
    expect(dayName('The next day')).toBeNull()
    expect(dayName('Spring, Year 3')).toBeNull()
  })
})
