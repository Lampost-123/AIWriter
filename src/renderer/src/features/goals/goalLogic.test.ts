import { describe, expect, it } from 'vitest'
import { addWords, dayOf, type DayTally, daysBefore, localDate, parseTarget, sizeNote, streakNote, streakOf, weekOf, wordsLabel } from './goalLogic'

describe('word counts in words', () => {
  it('gives pages and reading time at 250 words each', () => {
    expect(sizeNote(0)).toBe('no words yet')
    expect(sizeNote(80)).toBe('under a page, under a minute')
    expect(sizeNote(250)).toBe('about 1 page, 1 min read')
    expect(sizeNote(1000)).toBe('about 4 pages, 4 min read')
    expect(sizeNote(1060)).toBe('about 4 pages, 4 min read')
    expect(sizeNote(312_500)).toBe('about 1,250 pages, 1,250 min read')
    expect(wordsLabel(1)).toBe('1 word')
    expect(wordsLabel(1234)).toBe('1,234 words')
  })
})

describe('days', () => {
  it('keeps local dates', () => {
    expect(localDate(new Date(2026, 9, 3, 23, 59))).toBe('2026-10-03')
    expect(daysBefore('2026-03-01', 1)).toBe('2026-02-28')
    expect(daysBefore('2026-01-01', 1)).toBe('2025-12-31')
  })

  it('adds words to a day, and drops empty days and those over a year old', () => {
    const add = (t: DayTally, date: string, typed: number, ai: number): DayTally => addWords(t, date, typed, ai, '2026-10-03')
    let t: DayTally = { days: [], running: {} }
    t = add(t, '2026-10-03', 12, 0)
    t = add(t, '2026-10-03', 5, 300)
    expect(t.days).toEqual([{ date: '2026-10-03', typed: 17, ai: 300 }])
    // AI words undone never go below none.
    t = add(t, '2026-10-03', 0, -400)
    expect(dayOf(t.days, '2026-10-03')).toEqual({ date: '2026-10-03', typed: 17, ai: 0 })
    const old = { days: [{ date: '2025-09-01', typed: 900, ai: 0 }, { date: '2026-10-02', typed: 3, ai: 0 }], running: {} }
    expect(add(old, '2026-10-03', 1, 0).days.map((d) => d.date)).toEqual(['2026-10-02', '2026-10-03'])
    expect(add({ days: [{ date: '2026-10-03', typed: 4, ai: 0 }], running: {} }, '2026-10-03', -4, 0).days).toEqual([])
  })

  it('never keeps or shows a day below none, and a big delete undone comes back exactly', () => {
    const add = (t: DayTally, typed: number): DayTally => addWords(t, '2026-10-03', typed, 0, '2026-10-03')
    let t: DayTally = { days: [{ date: '2026-10-03', typed: 600, ai: 0 }], running: {} }
    // Ctrl+A, Backspace on a long scene: the day shows none, never less.
    t = add(t, -5000)
    expect(t.days).toEqual([])
    expect(dayOf(t.days, '2026-10-03').typed).toBe(0)
    // Ctrl+Z: the 600 are back, and so is the target met.
    t = add(t, 5000)
    expect(t.days).toEqual([{ date: '2026-10-03', typed: 600, ai: 0 }])
    expect(streakOf(t.days, 500, '2026-10-03')).toEqual({ days: 1, todayMet: true })
  })
})

describe('the streak', () => {
  const days = [
    { date: '2026-09-29', typed: 600, ai: 0 },
    { date: '2026-09-30', typed: 100, ai: 2000 },
    { date: '2026-10-01', typed: 550, ai: 0 },
    { date: '2026-10-02', typed: 500, ai: 0 }
  ]
  it('counts days in a row the target was met, and today once it is met', () => {
    expect(streakOf(days, 500, '2026-10-03')).toEqual({ days: 2, todayMet: false })
    const today = [...days, { date: '2026-10-03', typed: 520, ai: 0 }]
    expect(streakOf(today, 500, '2026-10-03')).toEqual({ days: 3, todayMet: true })
    // AI words don't count towards the target.
    expect(streakOf(days, 500, '2026-09-30')).toEqual({ days: 1, todayMet: false })
  })
  it('has no streak without a target', () => {
    expect(streakOf(days, null, '2026-10-03')).toBeNull()
    expect(streakNote(null)).toBeNull()
  })
  it('says it in plain words', () => {
    expect(streakNote({ days: 0, todayMet: false })).toBe('Meet today’s target to start a streak.')
    expect(streakNote({ days: 1, todayMet: true })).toBe('1 day in a row')
    expect(streakNote({ days: 2, todayMet: false })).toBe('2 days in a row. Meet today’s target to keep it going.')
  })
  it('reads a target as typed', () => {
    expect(parseTarget('')).toBeNull()
    expect(parseTarget('0')).toBeNull()
    expect(parseTarget('1,500')).toBe(1500)
    expect(parseTarget(' 750 ')).toBe(750)
  })
})

describe('the week (the desk’s story home)', () => {
  it('gives the last seven days up to today, oldest first, typed and AI words together', () => {
    // 2026-10-08 is a Thursday.
    const week = weekOf(
      [
        { date: '2026-10-01', typed: 900, ai: 0 },
        { date: '2026-10-02', typed: 120, ai: 30 },
        { date: '2026-10-04', typed: 0, ai: 64 },
        { date: '2026-10-08', typed: 112, ai: 0 }
      ],
      '2026-10-08'
    )
    expect(week.map((d) => d.label)).toEqual(['Fri', 'Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Today'])
    expect(week.map((d) => d.words)).toEqual([150, 0, 64, 0, 0, 0, 112])
    expect(week[0].date).toBe('2026-10-02')
    expect(week.filter((d) => d.today).map((d) => d.date)).toEqual(['2026-10-08'])
  })

  it('crosses a month and a year end', () => {
    const week = weekOf([{ date: '2025-12-31', typed: 5, ai: 0 }], '2026-01-02')
    expect(week[0].date).toBe('2025-12-27')
    expect(week[4]).toMatchObject({ date: '2025-12-31', words: 5, label: 'Wed' })
  })
})
