import { describe, expect, it } from 'vitest'
import type { Timeline, TimelinePoint } from '@shared/contracts/worldViews'
import {
  byFirstAppearance,
  cardWidth,
  gapRoom,
  gapWords,
  lanePath,
  laneHeight,
  layoutRiver,
  matchesFilter,
  minutesBetween,
  shownOrder,
  skyOf,
  stepTo,
  timeOf,
  toldOrder,
  visibleRange,
  wordsLabel,
  type RiverSize
} from './riverLogic'

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
  order: Number(id),
  key: null,
  dayLabel: '',
  chapterId: 'c1',
  status: 'planned',
  words: 0,
  goal: '',
  beats: [],
  ...p
})

const timeline = (points: TimelinePoint[]): Timeline => ({
  storyId: 'b1',
  points,
  entries: [],
  clashes: [],
  chapters: [
    { id: 'c1', storyId: 'b1', story: 'Book 1', no: 1, title: 'The Night Ferry' },
    { id: 'c2', storyId: 'b1', story: 'Book 1', no: 2, title: 'The Drowned Steps' }
  ]
})

/** "Day n" at a time of day, as when.ts keys it with no year: [anchor, calendar, month, day, minute]. */
const dayKey = (day: number, minute = -1): TimelinePoint['key'] => [null, 0, null, day, minute]

const SIZE: RiverSize = { cardW: 200, cardMax: 260, eventW: 120, gap: 20, unit: 20, pad: 30, minWidth: 0 }

describe('time on the river', () => {
  it('reads a sort key as minutes in its calendar, and nothing from a key that names no day, month or year', () => {
    expect(timeOf(dayKey(1, 1110))).toEqual({ cal: 'c0', t: 1440 + 1110 })
    expect(timeOf([3, null, 3, 12, -1])).toEqual({ cal: 'y', t: 3 * 365.25 * 1440 + 2 * 30.44 * 1440 + 12 * 1440 })
    expect(timeOf([null, 0, null, null, 600])).toBeNull()
    expect(timeOf(null)).toBeNull()
  })

  it('measures gaps only within one calendar, never backwards', () => {
    expect(minutesBetween(timeOf(dayKey(1, 1110)), timeOf(dayKey(1, 1320)))).toBe(210)
    expect(minutesBetween(timeOf(dayKey(2)), timeOf(dayKey(1)))).toBe(0)
    expect(minutesBetween(timeOf(dayKey(1)), { cal: 'c1', t: 5 })).toBeNull()
    expect(minutesBetween(null, timeOf(dayKey(1)))).toBeNull()
  })

  it('gives longer gaps more room, growing slowly and capped, and says gaps of a day or more in words', () => {
    expect(gapRoom(null, 20)).toBe(0)
    expect(gapRoom(0, 20)).toBe(0)
    const hours = gapRoom(180, 20)
    const day = gapRoom(1440, 20)
    const year = gapRoom(525960, 20)
    expect(hours).toBe(20)
    expect(day).toBeGreaterThan(hours)
    expect(year).toBe(100)
    expect(gapRoom(5259600, 20)).toBe(100)
    expect(gapWords(600)).toBe('')
    expect(gapWords(1440)).toBe('1 day later')
    expect(gapWords(3 * 1440)).toBe('3 days later')
    // Counted in calendar days: Day 1 at night to Day 3 in the morning.
    expect(gapWords(2100, 2)).toBe('2 days later')
    expect(gapWords(21 * 1440)).toBe('3 weeks later')
    expect(gapWords(150 * 1440)).toBe('5 months later')
    expect(gapWords(3 * 365.25 * 1440)).toBe('3 years later')
  })

  it('names the sky for a time of day', () => {
    expect(skyOf(dayKey(1, 330))).toBe('dawn')
    expect(skyOf(dayKey(1, 720))).toBe('day')
    expect(skyOf(dayKey(1, 1110))).toBe('dusk')
    expect(skyOf(dayKey(1, 1320))).toBe('night')
    expect(skyOf(dayKey(1))).toBeNull()
    expect(skyOf(null)).toBeNull()
  })
})

describe('story order and world order', () => {
  const told = (orders: number[], kinds: TimelinePoint['kind'][] = []) =>
    toldOrder(orders.map((order, i) => ({ order, kind: kinds[i] ?? 'scene' })))

  it('marks nothing when the story is told in the order things happen', () => {
    expect(told([0, 1, 2, 3])).toEqual([null, null, null, null])
  })

  it('marks a flashback: read late, set early, without marking the scenes around it', () => {
    // The scene read fifth (order 4) happens second.
    expect(told([0, 4, 1, 2, 3])).toEqual([null, 'flashback', null, null, null])
  })

  it('marks a scene told early: read first, set last', () => {
    expect(told([1, 2, 3, 0])).toEqual([null, null, null, 'early'])
  })

  it('never marks an event', () => {
    expect(told([0, 9, 1, 2], ['scene', 'event', 'scene', 'scene'])).toEqual([null, null, null, null])
  })

  it('shows cards in world order by day, and in reading order by chapter', () => {
    const pts = [{ order: 2 }, { order: 0 }, { order: 1 }]
    expect(shownOrder(pts, 'day')).toEqual([0, 1, 2])
    expect(shownOrder(pts, 'chapter')).toEqual([1, 2, 0])
  })
})

describe('laying out the river', () => {
  const t = timeline([
    point('0', { day: 'd1', dayLabel: 'Day 1', key: dayKey(1, 1110), when: 'Day 1, dusk' }),
    point('1', { day: 'd1', dayLabel: 'Day 1', key: dayKey(1, 1320), when: 'Day 1, night' }),
    point('2', { day: 'd2', dayLabel: 'Day 2', key: dayKey(2, 540), chapterId: 'c2' }),
    point('3', { day: 'd5', dayLabel: 'Day 5', key: dayKey(5, 720), chapterId: 'c2' })
  ])

  it('spaces cards by the time between them, with a band for each day and the long gaps in words', () => {
    const r = layoutRiver(t, 'day', SIZE)
    const gaps = r.items.slice(1).map((it, n) => it.x - (r.items[n].x + r.items[n].w))
    expect(r.items[0].x).toBe(30)
    // Night after dusk the same day: a small gap; then the next morning; then three days on: the most.
    expect(gaps[0]).toBeLessThan(gaps[1])
    expect(gaps[1]).toBeLessThan(gaps[2])
    expect(r.bands.map((b) => b.label)).toEqual(['Day 1', 'Day 2', 'Day 5'])
    expect(r.bands.map((b) => b.alt)).toEqual([false, true, false])
    expect(r.bands[0].x0).toBeLessThan(r.items[0].x)
    expect(r.bands[0].x1).toBeGreaterThan(r.items[1].x + r.items[1].w)
    expect(r.gaps.map((g) => g.label)).toEqual(['3 days later'])
    expect(r.width).toBe(r.items[3].x + r.items[3].w + 30)
  })

  it('spaces cards evenly when their time can’t be read', () => {
    const plain = timeline([point('0'), point('1'), point('2')])
    const r = layoutRiver(plain, 'day', SIZE)
    expect(r.items.map((i) => i.x)).toEqual([30, 250, 470])
    expect(r.bands).toEqual([])
  })

  it('by chapter: reading order, a band for each chapter, and a wider gap between chapters', () => {
    const flash = timeline([point('0'), point('3', { chapterId: 'c2' }), point('1'), point('2', { chapterId: 'c2' })])
    const r = layoutRiver(flash, 'chapter', SIZE)
    expect(r.items.map((i) => flash.points[i.i].id)).toEqual(['0', '1', '2', '3'])
    expect(r.bands.map((b) => [b.eyebrow, b.label])).toEqual([
      ['Ch 1', 'The Night Ferry'],
      ['Ch 2', 'The Drowned Steps']
    ])
    expect(r.items[2].x - (r.items[1].x + r.items[1].w)).toBe(20 + 40)
  })

  it('fills a wide window: cards grow up to their most, then spread out', () => {
    const r = layoutRiver(t, 'chapter', { ...SIZE, minWidth: 3000 })
    expect(r.cardW).toBe(260)
    expect(r.width).toBe(3000)
    expect(r.items[3].x + r.items[3].w).toBeGreaterThan(1300)
    const small = layoutRiver(t, 'chapter', { ...SIZE, minWidth: 1100 })
    expect(small.cardW).toBeGreaterThan(200)
    expect(small.cardW).toBeLessThan(260)
  })

  it('squeezes the time gaps a little rather than run just past the window, keeping their order of size', () => {
    const loose = layoutRiver(t, 'day', SIZE)
    const tight = layoutRiver(t, 'day', { ...SIZE, minWidth: loose.width - 40 })
    expect(tight.width).toBe(loose.width - 40)
    const gaps = tight.items.slice(1).map((it, n) => it.x - (tight.items[n].x + tight.items[n].w))
    expect(gaps[0]).toBeLessThan(gaps[1])
    expect(gaps[1]).toBeLessThan(gaps[2])
    // Far too long: it scrolls, gaps as they are.
    expect(layoutRiver(t, 'day', { ...SIZE, minWidth: 300 }).width).toBe(loose.width)
  })

  it('makes an event a narrower card', () => {
    const r = layoutRiver(timeline([point('0'), point('1', { kind: 'event' })]), 'day', SIZE)
    expect(r.items[1].w).toBe(120)
  })

  it('finds the cards on screen quickly, for a river of many', () => {
    const many = Array.from({ length: 2000 }, (_, n) => ({ i: n, x: n * 100, w: 80 }))
    expect(visibleRange(many, 1000, 1500)).toEqual([10, 16])
    expect(visibleRange(many, 1000, 1500, 200)).toEqual([8, 18])
    expect(visibleRange([], 0, 100)).toEqual([0, 0])
  })
})

describe('lanes', () => {
  const pts = [
    point('0', { povId: 'mara', presentIds: ['mara'], setsUpIds: ['fire'] }),
    point('1', { presentIds: ['mara', 'tobin'] }),
    point('2', { kind: 'event', presentIds: ['tobin'] }),
    point('3', { presentIds: ['mara'], setsUpIds: ['fire'] }),
    point('4', { presentIds: ['tobin'], paysOffIds: ['fire'], setsUpIds: ['map'] }),
    point('5', { povId: 'mara', presentIds: ['mara'] })
  ]
  const items = pts.map((_, i) => ({ i, x: i * 100, w: 80 }))

  it('a character: marks where present (strongest as the point of view), thick runs where in scenes one after another', () => {
    const mara = lanePath(pts, items, 'mara', 'characters')!
    expect(mara.marks).toEqual([
      { item: 0, kind: 'pov' },
      { item: 1, kind: 'present' },
      { item: 3, kind: 'present' },
      { item: 5, kind: 'pov' }
    ])
    // The event Mara isn't in doesn't break her run; the scene she's missing does.
    expect(mara.runs).toEqual([
      [0, 3],
      [5, 5]
    ])
    expect([mara.first, mara.last, mara.openEnd]).toEqual([0, 5, false])
    const tobin = lanePath(pts, items, 'tobin', 'characters')!
    expect(tobin.marks.map((m) => m.kind)).toEqual(['present', 'event', 'present'])
    expect(lanePath(pts, items, 'kell', 'characters')).toBeNull()
  })

  it('a plot thread: opened, developed, resolved with a knot; one still open trails off to the end', () => {
    const fire = lanePath(pts, items, 'fire', 'threads')!
    expect(fire.marks.map((m) => [m.item, m.kind])).toEqual([
      [0, 'opened'],
      [3, 'developed'],
      [4, 'resolved']
    ])
    expect(fire.runs).toEqual([[0, 4]])
    expect(fire.openEnd).toBe(false)
    const map = lanePath(pts, items, 'map', 'threads')!
    expect(map.runs).toEqual([[4, 5]])
    expect([map.last, map.openEnd]).toEqual([5, true])
    const once = lanePath([point('0', { setsUpIds: ['x'], paysOffIds: ['x'] })], [{ i: 0, x: 0, w: 10 }], 'x', 'threads')!
    expect(once.marks).toEqual([{ item: 0, kind: 'both' }])
  })

  it('orders lanes by where each first comes along the river', () => {
    const t = timeline(pts)
    const lanes = [{ id: 'kell' }, { id: 'tobin' }, { id: 'mara' }]
    expect(byFirstAppearance(t, lanes, 'characters', 'day').map((l) => l.id)).toEqual(['mara', 'tobin', 'kell'])
    expect(byFirstAppearance(t, [{ id: 'map' }, { id: 'fire' }], 'threads', 'day').map((l) => l.id)).toEqual(['fire', 'map'])
  })

  it('shares the room under the cards between the lanes, within limits', () => {
    expect(laneHeight(800, 4)).toBe(148)
    expect(laneHeight(800, 10)).toBe(80)
    expect(laneHeight(800, 60)).toBe(56)
    expect(laneHeight(800, 0)).toBe(148)
  })
})

describe('the rest', () => {
  it('sizes cards to the window', () => {
    expect(cardWidth(1000)).toBe(196)
    expect(cardWidth(1500)).toBe(231)
    expect(cardWidth(2400)).toBe(268)
  })

  it('filters by any picked character, thread or place', () => {
    const p = point('0', { presentIds: ['mara'], locationId: 'mill', setsUpIds: ['fire'] })
    expect(matchesFilter(p, new Set())).toBe(true)
    expect(matchesFilter(p, new Set(['mara']))).toBe(true)
    expect(matchesFilter(p, new Set(['mill']))).toBe(true)
    expect(matchesFilter(p, new Set(['fire']))).toBe(true)
    expect(matchesFilter(p, new Set(['tobin']))).toBe(false)
  })

  it('moves between cards with the arrow keys, Page Up and Down, Home and End', () => {
    expect(stepTo(2, 'ArrowRight', 10)).toBe(3)
    expect(stepTo(2, 'ArrowLeft', 10)).toBe(1)
    expect(stepTo(0, 'ArrowLeft', 10)).toBe(0)
    expect(stepTo(8, 'PageDown', 10)).toBe(9)
    expect(stepTo(5, 'Home', 10)).toBe(0)
    expect(stepTo(5, 'End', 10)).toBe(9)
    expect(stepTo(5, 'Enter', 10)).toBeNull()
  })

  it('says words plainly', () => {
    expect(wordsLabel(0)).toBe('No words yet')
    expect(wordsLabel(1)).toBe('1 word')
    expect(wordsLabel(1204)).toBe('1,204 words')
  })
})
