import { describe, expect, it } from 'vitest'
import { addToDay, dayOf, daysBefore, localDate, parseTarget, sizeNote, streakNote, streakOf, wordsLabel } from './goalLogic'

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
    let days = addToDay([], '2026-10-03', 12, 0, '2026-10-03')
    days = addToDay(days, '2026-10-03', 5, 300, '2026-10-03')
    expect(days).toEqual([{ date: '2026-10-03', typed: 17, ai: 300 }])
    // AI words undone never go below none.
    days = addToDay(days, '2026-10-03', 0, -400, '2026-10-03')
    expect(dayOf(days, '2026-10-03')).toEqual({ date: '2026-10-03', typed: 17, ai: 0 })
    const old = [{ date: '2025-09-01', typed: 900, ai: 0 }, { date: '2026-10-02', typed: 3, ai: 0 }]
    expect(addToDay(old, '2026-10-03', 1, 0, '2026-10-03').map((d) => d.date)).toEqual(['2026-10-02', '2026-10-03'])
    expect(addToDay([{ date: '2026-10-03', typed: 4, ai: 0 }], '2026-10-03', -4, 0, '2026-10-03')).toEqual([])
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
