import { describe, expect, it } from 'vitest'
import type { Timeline, TimelinePoint } from '@shared/contracts/worldViews'
import {
  clashCount,
  dayBands,
  DEFAULT_LANES,
  INFO_KEEP,
  INFO_MAX,
  INFO_MIN,
  infoWidth,
  LANE_W,
  laneChoices,
  lanesThatFit,
  laneSpans,
  laneWidth,
  markOf,
  rowLabel,
  shownLanes,
  THREAD_LANE_MAX,
  WHEN_W
} from './timelineLogic'

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
  ...extra
})

describe('timeline lanes', () => {
  const t = timeline([
    point('1', { povId: 'mara', presentIds: ['mara', 'tobin'], setsUpIds: ['burned'] }),
    point('2', { presentIds: ['tobin'] }),
    point('3', { povId: 'tobin', presentIds: ['tobin', 'kell'], paysOffIds: ['burned'] }),
    point('4', { presentIds: ['kell'], setsUpIds: ['burned'], paysOffIds: ['burned'] })
  ])

  it('marks the point of view, those present, and where a thread is set up or paid off', () => {
    expect(markOf(t.points[0], 'mara', 'characters')).toBe('pov')
    expect(markOf(t.points[0], 'tobin', 'characters')).toBe('present')
    expect(markOf(t.points[1], 'mara', 'characters')).toBeNull()
    expect(markOf(t.points[0], 'burned', 'threads')).toBe('setUp')
    expect(markOf(t.points[2], 'burned', 'threads')).toBe('paidOff')
    expect(markOf(t.points[3], 'burned', 'threads')).toBe('both')
  })

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
    // In a narrow window, only as many as fit beside the scenes.
    expect(shownLanes(many, 'characters', undefined, 3)).toHaveLength(3)
    // Adam's own choice is his, however many.
    expect(shownLanes(many, 'characters', ['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7'], 3)).toHaveLength(8)
  })

  it('fits the lanes beside the scenes, so scene titles are never pushed off the side', () => {
    // 960 by 600 with the binder open leaves the timeline about 688 pixels.
    expect(lanesThatFit(688)).toBe(3)
    expect(WHEN_W + INFO_MIN + lanesThatFit(688) * LANE_W).toBeLessThanOrEqual(688)
    expect(lanesThatFit(1200)).toBe(DEFAULT_LANES)
    expect(lanesThatFit(300)).toBe(1)
    expect(lanesThatFit(0)).toBe(DEFAULT_LANES)
    expect(infoWidth(688, 3)).toBe(688 - WHEN_W - 3 * LANE_W)
    expect(infoWidth(2000, 6)).toBe(INFO_MAX)
    expect(infoWidth(600, 8)).toBe(INFO_MIN)
    expect(infoWidth(1000, 0)).toBe(1000 - WHEN_W)
  })

  it('widens plot thread lanes into room the scene column can spare, never past the window', () => {
    // 1280 by 800 with the binder open leaves the timeline about 1008 pixels.
    expect(laneWidth(1008, 4, 'characters')).toBe(LANE_W)
    expect(laneWidth(1008, 4, 'threads')).toBe(111)
    expect(laneWidth(2000, 4, 'threads')).toBe(THREAD_LANE_MAX)
    // With no room to spare, as narrow as a character's.
    expect(laneWidth(688, lanesThatFit(688), 'threads')).toBe(LANE_W)
    expect(laneWidth(0, 3, 'threads')).toBe(LANE_W)
    for (const width of [688, 800, 1008, 1400]) {
      const n = lanesThatFit(width)
      const laneW = laneWidth(width, n, 'threads')
      expect(WHEN_W + infoWidth(width, n, laneW) + n * laneW).toBeLessThanOrEqual(width)
      expect(infoWidth(width, n, laneW)).toBeGreaterThanOrEqual(Math.min(INFO_KEEP, infoWidth(width, n)))
    }
  })

  it('runs each lane from its first mark to its last', () => {
    const spans = laneSpans(t.points, ['mara', 'tobin', 'kell'], 'characters')
    expect(spans.get('mara')).toEqual({ first: 0, last: 0 })
    expect(spans.get('tobin')).toEqual({ first: 0, last: 2 })
    expect(spans.get('kell')).toEqual({ first: 2, last: 3 })
  })
})

describe('timeline rows', () => {
  it('bands runs of points on the same in-world day', () => {
    const days = [null, 'day 1', 'day 1', 'day 1', 'day 2', 'day 3', 'day 3', null]
    expect(dayBands(days.map((day, i) => point(String(i), { day })))).toEqual([
      'none',
      'first',
      'middle',
      'last',
      'none',
      'first',
      'last',
      'none'
    ])
  })

  it('names each row in plain words, with its clash', () => {
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

  it('counts clashes', () => {
    expect(clashCount(1)).toBe('1 clash')
    expect(clashCount(3)).toBe('3 clashes')
  })
})
