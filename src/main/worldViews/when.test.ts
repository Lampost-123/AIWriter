import { describe, expect, it } from 'vitest'
import { compareKeys, dayName, dayWords, parseWhen, placeWhens, type PlacedWhen, type WhenStory } from './when'

const parts = (text: string) => {
  const p = parseWhen(text)
  return p && { year: p.year, month: p.month, day: p.day, minute: p.minute }
}

/** The texts in the order the timeline puts them (the ones with a sort key, by key then reading order). */
const ordered = (texts: string[]): string[] => {
  const placed = placeWhens(texts)
  return texts
    .map((t, i) => ({ t, i, key: placed[i]?.key }))
    .filter((x): x is { t: string; i: number; key: number[] } => !!x.key)
    .sort((a, b) => compareKeys(a.key, b.key) || a.i - b.i)
    .map((x) => x.t)
}

/** A placed text's sort key, which the test expects it to have. */
const key = (p: PlacedWhen | null): number[] => {
  expect(p?.key).toBeTruthy()
  return p!.key!
}

/** Two books read one after the other: the second follows on from the first, and may count its days afresh. */
const books = (first: string[], second: string[]): (PlacedWhen | null)[] =>
  placeWhens(
    [...first.map((text) => ({ text, story: 'b1' })), ...second.map((text) => ({ text, story: 'b2' }))],
    new Map<string, WhenStory>([['b2', { from: { story: 'b1', at: first.length }, fresh: true }]])
  )

/**
 * A book with a side story, in reading order: the side story starts after the book's first `starts`
 * texts and is read whole after its first `added` texts (where it ends). Returns the book's texts and
 * the side story's, placed.
 */
const withSide = (
  book: string[],
  side: string[],
  starts: number,
  added: number
): { book: (PlacedWhen | null)[]; side: (PlacedWhen | null)[] } => {
  const items = [
    ...book.slice(0, added).map((text) => ({ text, story: 'book' })),
    ...side.map((text) => ({ text, story: 'side' })),
    ...book.slice(added).map((text) => ({ text, story: 'book' }))
  ]
  const placed = placeWhens(items, new Map<string, WhenStory>([['side', { from: { story: 'book', at: starts }, fresh: false }]]))
  return { book: [...placed.slice(0, added), ...placed.slice(added + side.length)], side: placed.slice(added, added + side.length) }
}

/** The day key a text gets when it is read on its own. */
const dayOf = (text: string): string | null => placeWhens([text])[0]?.day ?? null

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
    expect(parseWhen('The year after')?.step).toMatchObject({ unit: 'year', n: 1 })
  })

  it('reads steps of months, and the start or end of a month', () => {
    expect(parseWhen('A month later')?.step).toMatchObject({ unit: 'month', n: 1 })
    expect(parseWhen('Two months later')?.step).toMatchObject({ unit: 'month', n: 2 })
    expect(parseWhen('Six months later')?.step).toMatchObject({ unit: 'month', n: 6 })
    expect(parseWhen('Next month')?.step).toMatchObject({ unit: 'month', n: 1 })
    expect(parts('End of March')?.month).toBe(3)
    expect(parts('the end of March')?.month).toBe(3)
    expect(parts('Beginning of May')?.month).toBe(5)
    expect(parts('Start of June')?.month).toBe(6)
  })

  it('never reads a day or year across a comma', () => {
    expect(parts('Christmas Day, 1204')).toEqual({ year: 1204, month: null, day: null, minute: null })
    expect(parts('Tuesday the 5th, Year 1204')).toEqual({ year: 1204, month: null, day: 5, minute: null })
    expect(parts('the 12th, Year 3')).toEqual({ year: 3, month: null, day: 12, minute: null })
    expect(parts('The 3rd. Year 4')).toEqual({ year: 4, month: null, day: 3, minute: null })
  })

  it("keeps the words of a calendar it doesn't know with the day", () => {
    expect(parseWhen('the 3rd of Frostmoon')).toMatchObject({ day: 3, month: null, qual: 'frostmoon' })
    expect(parseWhen('Frostmoon the 3rd')).toMatchObject({ day: 3, month: null, qual: 'frostmoon' })
    expect(parseWhen('Day 3 of Frostmoon')).toMatchObject({ day: 3, dayCount: true, qual: 'frostmoon' })
    expect(parseWhen('3rd day of Thawmoon')).toMatchObject({ day: 3, dayCount: true, qual: 'thawmoon' })
    expect(parseWhen('Day 12 of the siege, at first light')).toMatchObject({ day: 12, minute: 330, qual: 'siege' })
    expect(parseWhen('Christmas Day, 1204')).toMatchObject({ year: 1204, day: null, qual: 'christmas day' })
    expect(parseWhen("Midwinter's Eve, Year 3")).toMatchObject({ year: 3, qual: "midwinter's eve" })
    // Words the reader knows are no calendar of their own.
    expect(parseWhen('Tuesday the 5th')?.qual).toBe('')
    expect(parseWhen('Day 12, Year 3')?.qual).toBe('')
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

  it('reads a date tied to something else only when the tie counts from something other than that date', () => {
    expect(parseWhen('The night before Day 12')).toBeNull()
    expect(parseWhen('Two days after Day 12')).toBeNull()
    expect(parts('Year 312 after the Founding')?.year).toBe(312)
    expect(parts('Day 12, three days before the wedding')?.day).toBe(12)
    expect(parts('Three days before the wedding, Day 12')?.day).toBe(12)
  })

  it('never takes a number that counts something else for a date', () => {
    for (const text of [
      '3 days before the wedding',
      '5 years ago',
      'Summer, 3 years after the war',
      'Chapter 3',
      'the 3rd, after the battle',
      'Day one hundred',
      'a hundred years later',
      '40 miles from Ashford',
      'Ashford 12'
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
    expect(key(b)[0]).toBe(3)
    expect(compareKeys(key(c), key(a))).toBeLessThan(0)
    expect(compareKeys(key(b), key(a))).toBeGreaterThan(0)
    const [, fifth] = placeWhens(['3 March 1204', 'the 5th'])
    expect([key(fifth)[0], key(fifth)[2], key(fifth)[3]]).toEqual([1204, 3, 5])
    // Nothing wraps round: only Adam knows whether a year went by.
    const [dec, mar] = placeWhens(['December, Year 2', 'March'])
    expect(compareKeys(key(mar), key(dec))).toBeLessThan(0)
    // Unless he says so.
    const [dec2, next] = placeWhens(['December, Year 2', 'next spring'])
    expect(key(next)[0]).toBe(3)
    expect(compareKeys(key(next), key(dec2))).toBeGreaterThan(0)
  })

  it('steps from the dated scene before, and needs one to step from', () => {
    const [a, b, c] = placeWhens(['Day 12, Year 3, dusk', 'The next day', 'Later that night'])
    expect(b!.day).toBe(dayOf('Day 13, Year 3'))
    expect(c!.day).toBe(b!.day)
    expect(compareKeys(key(c), key(b))).toBeGreaterThan(0)
    expect(compareKeys(key(b), key(a))).toBeGreaterThan(0)
    expect(placeWhens(['The next day'])[0]).toBeNull()
    expect(placeWhens(['Spring, Year 3', 'The next day'])[1]).toBeNull()
  })

  it('steps months from a month, and never from a count of days', () => {
    const [march, sixLater] = placeWhens(['March, Year 3', 'Six months later'])
    expect(key(sixLater).slice(0, 3)).toEqual([3, -Infinity, 9])
    expect(compareKeys(key(sixLater), key(march))).toBeGreaterThan(0)
    expect(key(placeWhens(['September, Year 3', 'Six months later'])[1]).slice(0, 3)).toEqual([4, -Infinity, 3])
    expect(placeWhens(['Day 3', 'A month later'])[1]).toBeNull()
    // A month on from a day is only about that day, so it names none.
    const [, monthOn] = placeWhens(['3 March 1204', 'A month later'])
    expect(key(monthOn).slice(0, 3)).toEqual([1204, -Infinity, 4])
    expect(monthOn!.day).toBeNull()
  })

  it('puts a time of day on its own later the same day, without naming the day', () => {
    const [a, b] = placeWhens(['Day 12, morning', 'Dusk'])
    expect(compareKeys(key(b), key(a))).toBeGreaterThan(0)
    expect(b!.day).toBeNull()
    expect(placeWhens(['Dusk'])[0]).toBeNull()
  })

  it('names no day after a vague step until a text names its own', () => {
    const days = placeWhens(['Day 12', 'Days later', 'The next day', 'Day 14'])
    expect(compareKeys(key(days[1]), key(days[0]))).toBeGreaterThan(0)
    expect(days.slice(1, 3).map((p) => p!.day)).toEqual([null, null])
    expect(days[3]!.day).toBe(dayOf('Day 14'))
    const years = placeWhens(['Day 1, Year 3', 'Years later', 'Day 12', 'Day 12, Year 4'])
    expect(years.slice(1, 3).map((p) => p!.day)).toEqual([null, null])
    expect(years[3]!.day).toBe(dayOf('Day 12, Year 4'))
    expect(compareKeys(key(years[1]), key(years[0]))).toBeGreaterThan(0)
  })

  it("keeps a date it can't place among the others in reading order, and never makes up its day", () => {
    // Days of calendars the reader doesn't know: the same day only when the words are the same.
    const moons = placeWhens(['The 3rd of Frostmoon, 1204', 'The 3rd of Thawmoon, 1204', 'the 3rd of Frostmoon, 1204, dusk'])
    expect(moons.map((p) => p!.key)).toEqual([null, null, null])
    expect(moons[0]!.day).not.toBe(moons[1]!.day)
    expect(moons[2]!.day).toBe(moons[0]!.day)
    expect(dayOf('Day 3 of Frostmoon')).not.toBe(dayOf('Day 3 of Thawmoon'))
    expect(dayOf('Day 12 of the siege')).not.toBe(dayOf('Day 12'))
    expect(dayOf('Day 3 of spring')).not.toBe(dayOf('Day 3 of summer'))
    // A day with a name of its own names no day the reader knows.
    const [march, christmas, midsummer] = placeWhens(['12 March 1204', 'Christmas Day, 1204', 'Midsummer Day, 1204'])
    expect(christmas).toEqual({ key: null, day: null })
    expect(midsummer!.day).toBeNull()
    expect(compareKeys(key(midsummer), key(march))).toBeGreaterThan(0)
    // A day of the month with no month to go with it.
    expect(placeWhens(['Tuesday the 5th, Year 1204'])[0]).toEqual({ key: null, day: null })
    expect(placeWhens(['the 12th, Year 3'])[0]).toEqual({ key: null, day: null })
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
    expect(twelve!.day).toBe(dayOf('Day 12'))
    expect(compareKeys(key(twelve), key(ten))).toBeGreaterThan(0)
  })

  it('reads an event on its own: it takes only a year, and gives nothing to the scenes after it', () => {
    const placed = placeWhens([
      { text: 'Day 40, Year 300' },
      { text: 'Day 1, Year 1', aside: true },
      { text: 'Day 41' },
      { text: 'Day 9', aside: true }
    ])
    expect(key(placed[2])[0]).toBe(300)
    expect(key(placed[3])[0]).toBe(300)
    expect(placeWhens([{ text: 'Day 1' }, { text: 'The next day', aside: true }])[1]).toBeNull()
  })

  it('keeps reading order for the same moment', () => {
    expect(ordered(['Day 2', 'Day 2', 'Day 1'])).toEqual(['Day 1', 'Day 2', 'Day 2'])
    const placed = placeWhens(['Day 2, dusk', 'Day 2'])
    expect(compareKeys(key(placed[0]), key(placed[1]))).toBe(0)
  })
})

describe('placing the When boxes of several stories', () => {
  it("counts a book's dates on from its own scenes, not from a side story read partway through it", () => {
    // The side story runs from after Ch 1 to after Ch 3 and is read whole there.
    const { book, side } = withSide(['Day 1', 'Day 2', 'Day 5', 'The next day', 'Two days later'], ['Day 2', 'Day 3'], 1, 3)
    expect(book.map((p) => p!.day)).toEqual(['Day 1', 'Day 2', 'Day 5', 'Day 6', 'Day 8'].map(dayOf))
    expect(side.map((p) => p!.day)).toEqual(['Day 2', 'Day 3'].map(dayOf))
    // "That evening" is the evening of the book's own day.
    const evening = withSide(['Day 1', 'Day 2', 'Day 5', 'That evening'], ['Day 2', 'Day 3'], 1, 3).book[3]
    expect(evening!.day).toBe(dayOf('Day 5'))
    expect(compareKeys(key(evening), key(placeWhens(['Day 5, dusk'])[0]))).toBeGreaterThan(0)
  })

  it('reads a side story the same on its own and inside its book', () => {
    // On the book's timeline, the side story is read after Ch 3; on its own, only Ch 1 comes before it.
    const inBook = withSide(['Day 1', 'Day 2', 'Day 5'], ['The next day', 'Dusk'], 1, 3).side
    const alone = withSide(['Day 1'], ['The next day', 'Dusk'], 1, 1).side
    expect(inBook).toEqual(alone)
    expect(inBook[0]!.day).toBe(dayOf('Day 2'))
  })

  it('keeps each book that counts its days afresh to its own calendar', () => {
    const placed = books(['Day 1', 'Day 2'], ['Day 1', 'Day 2'])
    // Book 2's days are not Book 1's days...
    expect(placed[2]!.day).not.toBe(placed[0]!.day)
    // ...and come after them.
    expect(compareKeys(key(placed[2]), key(placed[1]))).toBeGreaterThan(0)
    expect(compareKeys(key(placed[3]), key(placed[2]))).toBeGreaterThan(0)
    // Dates that name their year are shared.
    const [a, b] = books(['Day 5, Year 2'], ['Day 5, Year 2'])
    expect(a!.day).toBe(b!.day)
  })

  it("carries a book's opening steps on from the end of the book before", () => {
    const opening = books(['Day 1', 'Day 2', 'Day 3, dusk'], ['The next morning', 'Later that day', 'Two days later'])
    expect(opening.slice(3).map((p) => p!.day)).toEqual(['Day 4', 'Day 4', 'Day 6'].map(dayOf))
    expect(compareKeys(key(opening[3]), key(opening[2]))).toBeGreaterThan(0)
    const seasons = books(['Spring, Year 1', 'Summer'], ['A year later', 'Next spring'])
    expect(key(seasons[2]).slice(0, 3)).toEqual([2, -Infinity, 6.5])
    expect(key(seasons[3]).slice(0, 3)).toEqual([3, -Infinity, 3.5])
    // Once the book names a day of its own, it counts afresh from there.
    const afresh = books(['Day 1', 'Day 2'], ['The next morning', 'Day 1', 'The next day'])
    expect(afresh[2]!.day).toBe(dayOf('Day 3'))
    expect(afresh[3]!.day).not.toBe(afresh[0]!.day)
    expect(afresh[4]!.day).not.toBe(afresh[1]!.day)
    expect(compareKeys(key(afresh[3]), key(afresh[2]))).toBeGreaterThan(0)
  })

  it("puts a book's days without a year in the year it goes on to name", () => {
    const placed = books(['Day 1, Year 3', 'Day 40'], ['Day 41', 'Day 42, Year 3', 'Day 43'])
    const order = placed.map((p, i) => ({ k: key(p), i })).sort((a, b) => compareKeys(a.k, b.k) || a.i - b.i)
    expect(order.map((x) => x.i)).toEqual([0, 1, 2, 3, 4])
    // A book with no years sorts after the last year named before it.
    const later = books(['Day 1, Year 300', 'Day 40'], ['Day 41', 'Day 2, Year 301'])
    expect(compareKeys(key(later[2]), key(later[1]))).toBeGreaterThan(0)
    expect(compareKeys(key(later[3]), key(later[2]))).toBeGreaterThan(0)
  })

  it('takes nothing across a time gap', () => {
    const placed = placeWhens(
      [
        { text: 'Day 1', story: 'b1' },
        { text: 'The next morning', story: 'b2' }
      ],
      new Map<string, WhenStory>([['b2', { from: null, fresh: true }]])
    )
    expect(placed[1]).toBeNull()
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
