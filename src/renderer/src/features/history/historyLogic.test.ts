import { describe, expect, it } from 'vitest'
import type { SnapshotInfo } from '@shared/contracts/history'
import { dayTitle, foldSame, groupByDay, lengthAgainstNow, paragraphsChanged, wordsLabel } from './historyLogic'
import type { Row } from './wordDiff'

/** Noon local time on a day in October 2026. */
const day = (d: number, hours = 12): number => new Date(2026, 9, d, hours, 0, 0).getTime()
const NOW = day(15, 18)

const snap = (id: string, ms: number): SnapshotInfo => ({
  id,
  sceneId: 's1',
  kind: 'editing',
  label: 'While writing',
  generationId: null,
  words: 10,
  createdAt: new Date(ms).toISOString()
})

describe('dayTitle', () => {
  it('says today, yesterday, the weekday this past week, then the date', () => {
    expect(dayTitle(day(15, 0), NOW)).toBe('Today')
    expect(dayTitle(day(14, 23), NOW)).toBe('Yesterday')
    expect(dayTitle(day(12), NOW)).toBe(new Date(day(12)).toLocaleDateString(undefined, { weekday: 'long' }))
    expect(dayTitle(day(1), NOW)).toBe(new Date(day(1)).toLocaleDateString(undefined, { day: 'numeric', month: 'long' }))
    const lastYear = new Date(2025, 11, 30, 12).getTime()
    expect(dayTitle(lastYear, NOW)).toContain('2025')
  })
})

describe('groupByDay', () => {
  it('puts snapshots under their day, keeping their order', () => {
    const groups = groupByDay([snap('a', day(15, 17)), snap('b', day(15, 9)), snap('c', day(14)), snap('d', day(2))], NOW)
    expect(groups.map((g) => [g.title, g.snapshots.map((s) => s.id)])).toEqual([
      ['Today', ['a', 'b']],
      ['Yesterday', ['c']],
      [dayTitle(day(2), NOW), ['d']]
    ])
  })
})

describe('words', () => {
  it('counts words plainly', () => {
    expect(wordsLabel(1)).toBe('1 word')
    expect(wordsLabel(1200)).toBe(`${(1200).toLocaleString()} words`)
  })

  it('compares a version’s length with the scene now', () => {
    expect(lengthAgainstNow(400, 520)).toBe('120 words fewer than now')
    expect(lengthAgainstNow(521, 520)).toBe('1 word more than now')
    expect(lengthAgainstNow(5, 5)).toBe('Same length as now')
  })
})

describe('foldSame', () => {
  const same = (n: number): Row[] => Array.from({ length: n }, (_, i) => ({ kind: 'same', text: `Same ${i}.` }))
  const change: Row = { kind: 'now', text: 'New.' }
  const shape = (rows: Row[]) => foldSame(rows).map((s) => (s.kind === 'fold' ? `fold${s.rows.length}` : s.row.kind))

  it('folds long unchanged stretches, keeping a paragraph beside each change', () => {
    expect(shape([...same(5), change, ...same(6), change, ...same(4)])).toEqual([
      'fold4',
      'same',
      'now',
      'same',
      'fold4',
      'same',
      'now',
      'same',
      'fold3'
    ])
  })

  it('leaves short stretches as they are', () => {
    expect(shape([...same(1), change, ...same(3), change])).toEqual(['same', 'now', 'same', 'same', 'same', 'now'])
    expect(shape([change, ...same(1)])).toEqual(['now', 'same'])
  })

  it('counts the paragraphs that differ', () => {
    expect(paragraphsChanged([...same(3), change, change])).toBe(2)
  })
})
