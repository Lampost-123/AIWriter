import { describe, expect, it } from 'vitest'
import type { Timeline, TimelinePoint } from '@shared/contracts/worldViews'
import { DEFAULT_LANES, laneChoices, rowLabel, shownLanes } from './timelineLogic'

const point = (id: string, p: Partial<TimelinePoint> = {}): TimelinePoint => ({
  kind: 'scene',
  id,
  storyId: 'b1',
  place: `Book 1, Ch 1, Sc ${id}`,
  title: `Scene ${id}`,
  when: '',
  dated: false,
  day: null,
  povId: null,
  presentIds: [],
  locationId: null,
  setsUpIds: [],
  paysOffIds: [],
  clashes: [],
  order: Number(id) || 0,
  key: null,
  dayLabel: '',
  chapterId: 'c1',
  status: 'planned',
  words: 0,
  goal: '',
  beats: [],
  ...p
})

const timeline = (points: TimelinePoint[], extra: Partial<Timeline> = {}): Timeline => ({
  storyId: 'b1',
  points,
  entries: [
    { id: 'mara', kind: 'character', name: 'Mara', image: null },
    { id: 'tobin', kind: 'character', name: 'Tobin', image: null },
    { id: 'kell', kind: 'character', name: 'Kell', image: null },
    { id: 'burned', kind: 'thread', name: 'Who burned the mill?', image: null },
    { id: 'mill', kind: 'place', name: 'Harrow Mill', image: null }
  ],
  clashes: [],
  chapters: [],
  ...extra
})

describe('timeline lanes', () => {
  const t = timeline([
    point('1', { povId: 'mara', presentIds: ['mara', 'tobin'], setsUpIds: ['burned'] }),
    point('2', { presentIds: ['tobin'] }),
    point('3', { povId: 'tobin', presentIds: ['tobin', 'kell'], paysOffIds: ['burned'] }),
    point('4', { presentIds: ['kell'], setsUpIds: ['burned'], paysOffIds: ['burned'] })
  ])

  it('offers the busiest first, then by name, and leaves out what never appears', () => {
    expect(laneChoices(t, 'characters').map((c) => [c.entry.name, c.count])).toEqual([
      ['Tobin', 3],
      ['Kell', 2],
      ['Mara', 1]
    ])
    expect(laneChoices(t, 'threads').map((c) => [c.entry.id, c.count])).toEqual([['burned', 3]])
  })

  it(`shows the busiest ${DEFAULT_LANES} until Adam chooses, then his choice in the same order`, () => {
    expect(shownLanes(t, 'characters', undefined).map((e) => e.id)).toEqual(['tobin', 'kell', 'mara'])
    expect(shownLanes(t, 'characters', ['mara', 'tobin', 'gone']).map((e) => e.id)).toEqual(['tobin', 'mara'])
    expect(shownLanes(t, 'characters', [])).toEqual([])
    const many = timeline(
      Array.from({ length: 9 }, (_, i) => point(String(i), { presentIds: Array.from({ length: i + 1 }, (_, j) => `c${j}`) })),
      { entries: Array.from({ length: 9 }, (_, j) => ({ id: `c${j}`, kind: 'character' as const, name: `C${j}`, image: null })) }
    )
    expect(shownLanes(many, 'characters', undefined)).toHaveLength(DEFAULT_LANES)
    // Fewer when asked.
    expect(shownLanes(many, 'characters', undefined, 3)).toHaveLength(3)
    // Adam's own choice is his, however many.
    expect(shownLanes(many, 'characters', ['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7'], 3)).toHaveLength(8)
  })
})

describe('timeline cards', () => {
  it('names each card in plain words, with its clash', () => {
    const clashes = [{ characterId: 'mara', sceneIds: ['1', '2'], text: 'Mara is in Ashford and Harrow Mill on Day 12.' }]
    expect(rowLabel(point('1', { when: 'Day 12', dated: true, clashes: [0] }), clashes)).toBe(
      'Book 1, Ch 1, Sc 1, Scene 1. Day 12. Mara is in Ashford and Harrow Mill on Day 12.'
    )
    expect(rowLabel(point('2', { when: 'some time later' }), clashes)).toBe('Book 1, Ch 1, Sc 2, Scene 2. some time later (no date).')
    expect(rowLabel(point('3'), clashes)).toBe('Book 1, Ch 1, Sc 3, Scene 3. No date.')
    expect(
      rowLabel(point('fair', { kind: 'event', storyId: null, place: '', title: 'The harvest fair', when: 'Day 3', dated: true }), [])
    ).toBe('Event: The harvest fair. Day 3.')
  })
})
