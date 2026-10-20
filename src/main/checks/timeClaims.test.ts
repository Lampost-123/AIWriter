// Time claims held to the story calendar (free rules, 2026-10-19): each kind of claim with the cases it must flag and, as
// much, the ones it must not: dialogue that remembers, "last March", a cleft "It was March when…", a story with a real
// calendar, a season that may be late or early, a length "about" right, a night that runs past midnight. Invented text.
import { describe, expect, it } from 'vitest'
import { buildCalendar, dateOfText } from '../memory/calendar'
import { dateFacts } from './freeContext'
import { timeClaims, type TimeContext } from './timeClaims'
import { openingOf } from './freeRules'
import { PLANTED } from '../../../tests/traps/book'

/** A context for the last of some cards' Whens, in one story; the one before it is the scene before. */
function ctx(whens: string[], more: Partial<TimeContext> = {}): TimeContext {
  const items = whens.map((when, i) => ({ id: `s${i + 1}`, story: 'st', when }))
  const cal = buildCalendar(items)
  const last = items[items.length - 1]
  const date = cal.dates.get(last.id) ?? null
  const prev = items.length > 1 ? items[items.length - 2] : null
  const counted = [...cal.dates.values()].some((d) => d.dayCount) && ![...cal.dates.values()].some((d) => d.axis?.startsWith('g') || d.real || (d.year !== null && !d.yearWord))
  return {
    date,
    ...dateFacts(date, last.when),
    previous: prev && cal.dates.get(prev.id) ? { sceneId: prev.id, label: `Ch 1, Sc ${items.length - 1}`, date: cal.dates.get(prev.id)! } : null,
    counted,
    knownMonths: new Set(),
    knownYears: new Set(),
    events: [],
    lastAt: () => null,
    places: [],
    parents: new Map(),
    here: null,
    routes: [],
    ...more
  }
}

const found = (text: string, c: TimeContext, opening = 0) => timeClaims(text, c, opening).map((f) => ({ kind: f.kind, words: f.words, fix: f.fix }))
const messages = (text: string, c: TimeContext, opening = 0) => timeClaims(text, c, opening).map((f) => f.message)

describe('a month, day, year, weekday or season given as now', () => {
  const june = ctx(['Monday 12 June 1820, morning'])

  it('flags a month the narration gives as now that the calendar has otherwise, with the right one', () => {
    expect(found('It was a raw March morning, and the gutters ran.', june)).toEqual([{ kind: 'month', words: 'March', fix: 'June' }])
    expect(messages('It was a raw March morning.', june)).toEqual(['This says it is March, but by the scene cards this scene is in June (12 June 1820).'])
    expect(found('It was early March in Linmouth.', june)).toEqual([{ kind: 'month', words: 'March', fix: 'June' }])
  })

  it('flags a day of the month two or more out, a year, a weekday and a season that can’t be', () => {
    expect(found('It was the third of June.', june)).toEqual([{ kind: 'day', words: 'third', fix: 'twelfth' }])
    expect(found('It was 3rd June.', june)).toEqual([{ kind: 'day', words: '3', fix: '12' }])
    expect(found('It was 1823, and the war was over.', june)).toEqual([{ kind: 'year', words: '1823', fix: '1820' }])
    // 12 June 1820 was a Monday.
    expect(found('It was a Thursday, and the market was quiet.', june)).toEqual([{ kind: 'weekday', words: 'Thursday', fix: 'Monday' }])
    expect(found('It was deep winter.', june)).toEqual([{ kind: 'season', words: 'winter', fix: 'summer' }])
  })

  it('flags a dateline that is only a date', () => {
    expect(found('Linmouth, March 1847\n\nThe rain had not stopped.', june)).toEqual([
      { kind: 'month', words: 'March', fix: 'June' },
      { kind: 'year', words: '1847', fix: '1820' }
    ])
  })

  it('says nothing of what fits, nor of a month or day remembered, planned or said in dialogue', () => {
    const fine = [
      'It was a bright June morning.',
      'It was the twelfth of June.',
      'It was the eleventh of June.',
      'It was 1820, and the war was over.',
      'It was a Monday.',
      'It was late spring.', // June may be late spring
      'It was high summer.',
      'Last March, when the mill burned, she had been in Carrow.',
      'She remembered a Thursday in March.',
      'In March they would sail.',
      'It was March when they buried her father.', // a memory of then
      'It was a Thursday that she would never forget.',
      'It was not March yet.',
      'It was nearly winter.',
      '‘It was March,’ Mara said, ‘and cold as this.’',
      '“It’s Thursday,” said Tobin.',
      'She wore a summer dress.',
      'It was a summer dress she wore.',
      'It was a Tuesday crowd at the market.',
      'She turned the letter over. It was dated the third of March.', // a thing's own date
      'It was built in 1790.'
    ]
    for (const t of fine) expect(found(t, june), t).toEqual([])
  })

  it('takes a night that runs past midnight, and the last day of a month, as they may be', () => {
    const night = ctx(['Monday 12 June 1820, night'])
    expect(found('It was Tuesday by the time they reached the bridge.', night)).toEqual([])
    const lastDay = ctx(['30 June 1820, night'])
    expect(found('It was July now.', lastDay)).toEqual([])
  })

  it('holds a month to a season the card names, a month either side fitting', () => {
    const spring = ctx(['Spring, 1820'])
    expect(found('It was a soft April evening.', spring)).toEqual([])
    expect(found('It was June.', spring)).toEqual([])
    expect(found('It was a raw October morning.', spring)).toEqual([{ kind: 'month', words: 'October', fix: null }])
    expect(found('It was autumn.', spring)).toEqual([{ kind: 'season', words: 'autumn', fix: 'spring' }])
  })

  it('says nothing where the calendar doesn’t know the month', () => {
    // A step from a dated scene carries the year but no card names the month.
    expect(found('It was a raw March morning.', ctx(['1820', 'The next day']))).toEqual([])
    expect(found('It was a raw March morning.', ctx(['']))).toEqual([])
    // A world's own year counts are never compared with a number.
    expect(found('It was 1823.', ctx(['Year 3, spring']))).toEqual([])
  })
})

describe('a story that only counts its days', () => {
  const days = ctx(['Day 1, dusk', 'Day 8, morning'])

  it('asks about a month or a year given as now, as new, worth a look only', () => {
    const f = timeClaims('It was a raw March morning, and Day 8 of the siege.', days)
    expect(f.map((x) => [x.kind, x.words, x.severity, x.fix])).toEqual([['invented', 'March', 'minor', null]])
    expect(f[0].message).toBe('The story counts its days (Day 8) and no scene card or codex entry names a month, so March is new here. Keep it, or take it out?')
    expect(found('It was 1847.', days)).toEqual([{ kind: 'invented', words: '1847', fix: null }])
  })

  it('says nothing of a month the codex or a card names, a month in dialogue, or a remembered one', () => {
    expect(found('It was a raw March morning.', { ...days, knownMonths: new Set([3]) })).toEqual([])
    expect(found('‘It was March when we came,’ she said.', days)).toEqual([])
    expect(found('Last March the river froze.', days)).toEqual([])
  })

  it('never takes a story with a real calendar for one that counts its days', () => {
    // "Day 25, Christmas Eve" places every counted day on the real calendar: Day 8 is 7 December.
    const real = ctx(['Day 25, Christmas Eve', 'Day 8, morning'])
    expect(real.counted).toBe(false)
    expect(found('It was a cold December morning.', real)).toEqual([])
    expect(found('It was a raw March morning.', real)).toEqual([{ kind: 'month', words: 'March', fix: 'December' }])
  })
})

describe('a dated event', () => {
  const cal = buildCalendar([
    { id: 's1', story: 'st', when: '2 June 1820' },
    { id: 's2', story: 'st', when: '6 June 1820, evening' }
  ])
  const fire = { id: 'fire', name: 'The mill fire', aliases: [], date: dateOfText(cal, '2 June 1820', 's2')! }
  const c = ctx(['2 June 1820', '6 June 1820, evening'], { events: [fire] })

  it('flags how long since it, when the calendar says otherwise, with the right length', () => {
    expect(found('It had been three weeks since the mill fire, and still the smell hung over the yard.', c)).toEqual([
      { kind: 'elapsed', words: 'three weeks', fix: 'four days' }
    ])
    expect(messages('Three weeks since the mill fire.', c)).toEqual([
      'This says three weeks since the mill fire (2 June 1820), but by the story calendar it is 4 days to this scene (6 June 1820).'
    ])
    // In dialogue too: a length is a sum, not a memory.
    expect(found('‘Three weeks since the mill fire,’ Tobin said.', c)).toEqual([{ kind: 'elapsed', words: 'Three weeks', fix: 'Four days' }])
    expect(found('The mill fire, a month ago, had changed everything.', c)).toEqual([{ kind: 'elapsed', words: 'a month', fix: 'four days' }])
  })

  it('says nothing of a length about right, hedged, a guess, or of something the codex doesn’t date', () => {
    const fine = [
      'Four days since the mill fire.',
      'Five days since the mill fire.', // a day either way
      'Nearly a week since the mill fire.',
      'It felt like three weeks since the mill fire.',
      'Three weeks since the wedding.',
      'Three weeks or so since the mill fire.'
    ]
    for (const t of fine) expect(found(t, c), t).toEqual([])
  })

  it('flags a month or year said beside the event that the codex dates otherwise, even in dialogue', () => {
    expect(found('‘The mill fire last March took everything,’ she said.', c)).toEqual([{ kind: 'event-date', words: 'March', fix: 'June' }])
    expect(found('The mill fire of 1819 was still talked of.', c)).toEqual([{ kind: 'event-date', words: '1819', fix: '1820' }])
    // A month that is another time: "in March, a year after the fire".
    expect(found('In March, a year after the mill fire, they rebuilt.', c)).toEqual([])
    expect(found('The mill fire in June was still talked of.', c)).toEqual([])
  })

  it('counts from the last scene at a place left, and from a year', () => {
    const at = ctx(['2 June 1820', '6 June 1820, evening'], {
      places: [{ id: 'lin', name: 'Linmouth' }],
      lastAt: (id) => (id === 'lin' ? { sceneId: 's1', label: 'Ch 1, Sc 1', date: cal.dates.get('s1')! } : null)
    })
    expect(found('It was two weeks since they had left Linmouth.', at)).toEqual([{ kind: 'elapsed', words: 'two weeks', fix: 'four days' }])
    expect(found('It was four days since they had left Linmouth.', at)).toEqual([])
    expect(found('In 1812, eight years ago, the river had flooded.', at)).toEqual([])
    expect(found('In 1815, eight years ago, the river had flooded.', at)).toEqual([{ kind: 'elapsed', words: 'eight years', fix: null }])
  })
})

describe('how a scene opens', () => {
  it('flags an opening the cards put another distance from the scene before, with the words that fit', () => {
    const same = ctx(['Day 3, morning', 'Day 3, evening'])
    expect(found('The next morning, Mara went down to the quay.', same, 400)).toEqual([{ kind: 'opening', words: 'The next morning', fix: 'Later that morning' }])
    expect(messages('The next morning, Mara went down to the quay.', same, 400)).toEqual([
      'This scene opens “The next morning”, but by the scene cards it is the same day as the scene before (Ch 1, Sc 1: Day 3, morning).'
    ])
    const three = ctx(['Day 3, morning', 'Day 6, evening'])
    expect(found('That night the wind rose.', three, 400)).toEqual([{ kind: 'opening', words: 'That night', fix: 'Three days later' }])
    expect(found('Two weeks later, the letter came.', three, 400)).toEqual([{ kind: 'opening', words: 'Two weeks later', fix: 'Three days later' }])
  })

  it('says nothing where they agree, past the opening, after a scene in the small hours, or in a flashback', () => {
    expect(found('The next morning, Mara went down to the quay.', ctx(['Day 3, evening', 'Day 4, morning']), 400)).toEqual([])
    expect(found('Three days later, the letter came.', ctx(['Day 3', 'Day 6']), 400)).toEqual([])
    expect(found('Mara waited. '.repeat(40) + 'The next morning she left.', ctx(['Day 3, morning', 'Day 3, evening']), 400)).toEqual([])
    expect(found('The next morning was grey.', ctx(['Day 3, 2am', 'Day 3, morning']), 400)).toEqual([])
    expect(found('That night she could not sleep.', ctx(['Day 3, evening', 'Day 4, 1am']), 400)).toEqual([])
    expect(found('The next morning she left.', ctx(['Day 3, morning', 'Flashback: Day 1, evening']), 400)).toEqual([])
  })
})

describe('a journey’s length', () => {
  const places = [
    { id: 'lin', name: 'Linmouth' },
    { id: 'car', name: 'Carrow' },
    { id: 'whe', name: 'The Wheatsheaf' }
  ]
  const routes: TimeContext['routes'] = [
    { a: 'lin', b: 'car', hours: 72, unit: 'day', hedged: false, mode: 'wheels', how: 'by cart', words: 'three days by cart', entryId: 'car', entryName: 'Carrow' }
  ]
  const c = ctx(['Day 3'], { places, parents: new Map([['whe', 'car']]), here: 'whe', routes })

  it('flags a length twice or half what the codex says, by the same means or one not said', () => {
    expect(found('Carrow was only a day by cart from Linmouth.', c)).toEqual([{ kind: 'journey', words: 'a day by cart', fix: null }])
    expect(messages('Linmouth was a day’s journey.', c)).toEqual(['This says a day’s journey between Linmouth and The Wheatsheaf, but the codex entry for Carrow says about 3 days by cart.'])
  })

  it('says nothing of another means, a length near enough, or a place the codex says nothing of', () => {
    const fine = ['Linmouth was a day’s ride.', 'Linmouth was two days by cart.', 'Ashby was a day by cart.', '‘Linmouth’s a day’s ride,’ he said.']
    for (const t of fine) expect(found(t, c), t).toEqual([])
  })
})

describe('the trap book’s planted passages (tests/traps/book.ts)', () => {
  it('catch X13’s made-up month, and nothing in the others (X7’s “That afternoon” is the scene’s own day going on)', () => {
    const flagged: string[] = []
    for (const x of PLANTED) {
      const c = ctx(['Midwinter Night (day 1), late evening', 'Day 48', x.card.when])
      expect(c.counted, x.id).toBe(true)
      const text = x.paragraphs.join('\n\n')
      const f = timeClaims(text, c, openingOf(text))
      if (f.length) flagged.push(x.id)
      if (x.id === 'X13') {
        expect(f.map((y) => y.kind)).toEqual(['invented'])
        expect(f[0].message).toMatch(x.reason!)
        expect(x.flaw!.includes(f[0].words)).toBe(true)
      }
    }
    expect(flagged).toEqual(['X13'])
  })
})
