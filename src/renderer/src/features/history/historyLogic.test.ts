import { describe, expect, it } from 'vitest'
import type { SnapshotInfo } from '@shared/contracts/history'
import { againstNow, dayTitle, firstToShow, foldSame, groupByDay, lengthAgainstNow, paragraphsChanged, wordsLabel } from './historyLogic'
import { compareTexts, type Row } from './wordDiff'

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

  it('keeps a stretch written afresh as one row', () => {
    const apart: Row = { kind: 'apart', then: ['Old one.', 'Old two.'], now: ['New one.', 'New two.', 'New three.'] }
    expect(shape([...same(5), apart, ...same(5)])).toEqual(['fold4', 'same', 'apart', 'same', 'fold4'])
  })
})

describe('paragraphsChanged', () => {
  it('counts a stretch written afresh by its longer side, and a paragraph whose words all stayed not at all', () => {
    const apart: Row = { kind: 'apart', then: ['Old one.', 'Old two.'], now: ['New one.', 'New two.', 'New three.'] }
    const rewrapped: Row = { kind: 'changed', then: [{ text: 'One,\ntwo.', changed: false }], now: [{ text: 'One, two.', changed: false }] }
    const edited: Row = {
      kind: 'changed',
      then: [
        { text: 'Wait', changed: false },
        { text: '.', changed: true }
      ],
      now: [{ text: 'Wait!', changed: false }]
    }
    expect(paragraphsChanged([apart, rewrapped, edited])).toBe(4)
  })
})

describe('againstNow', () => {
  /** A one-paragraph doc, its words in italics if asked. */
  const doc = (text: string, italic = false) => ({
    type: 'doc',
    content: [
      { type: 'paragraph', attrs: { pid: 'p1' }, content: [{ type: 'text', text, ...(italic ? { marks: [{ type: 'italic' }] } : {}) }] }
    ]
  })
  const versus = (then: { doc: unknown; text: string }, now: { doc: unknown; text: string }) =>
    againstNow(compareTexts(then.text, now.text), then, now)

  it('is the same with the same words and formatting, paragraph ids aside', () => {
    const now = doc('The rain fell.')
    const then = { ...doc('The rain fell.'), content: [{ ...now.content[0], attrs: { pid: 'other' } }] }
    expect(versus({ doc: then, text: 'The rain fell.' }, { doc: now, text: 'The rain fell.' })).toEqual({ kind: 'same' })
  })

  it('says when only the formatting or the line breaks differ, so the version can still be restored', () => {
    expect(
      versus({ doc: doc('The rain fell.', true), text: 'The rain fell.' }, { doc: doc('The rain fell.'), text: 'The rain fell.' })
    ).toEqual({
      kind: 'format'
    })
    expect(versus({ doc: null, text: 'The rain\nfell.' }, { doc: null, text: 'The rain fell.' })).toEqual({ kind: 'format' })
  })

  it("counts the same words as the same when a version's formatting isn't known", () => {
    expect(versus({ doc: null, text: 'The rain fell.' }, { doc: doc('The rain fell.', true), text: 'The rain fell.' })).toEqual({
      kind: 'same'
    })
  })

  it('counts the paragraphs that differ', () => {
    expect(versus({ doc: null, text: 'One.\n\nTwo.' }, { doc: null, text: 'One.\n\nTwo, changed.' })).toEqual({
      kind: 'differ',
      paragraphs: 1
    })
  })
})

describe('firstToShow', () => {
  it('shows the newest version that differs from the scene now', () => {
    const list = [snap('c', day(15, 17)), snap('b', day(15, 16)), snap('a', day(15, 9))]
    expect(firstToShow({ snapshots: list, sameAsNow: ['c'] })).toBe('b')
    expect(firstToShow({ snapshots: list, sameAsNow: [] })).toBe('c')
  })

  it('shows the newest when every version is the same as now, and nothing with none', () => {
    expect(firstToShow({ snapshots: [snap('b', day(15, 16)), snap('a', day(15, 9))], sameAsNow: ['a', 'b'] })).toBe('b')
    expect(firstToShow({ snapshots: [], sameAsNow: [] })).toBeNull()
  })
})
