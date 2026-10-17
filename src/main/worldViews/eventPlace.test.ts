// Where events go on the timeline (Adam, 2026-10-17: "ensure events are placed at the correct place ALWAYS"): one rule
// for every event, whatever made it. Invented stories only.
import { describe, expect, it } from 'vitest'
import { emptySceneCard } from '@shared/defaults'
import type { EntryMaking } from '../db/repo'
import type { ID } from '@shared/types'
import type { TimelinePoint } from '@shared/contracts/worldViews'
import * as repo from '../db/repo'
import { memoryWorld } from '../../../tests/unit/helpers'
import { timelineOf } from './index'
import { eventVsScene, placeEvent, type PlaceScene } from './eventPlace'
import { placeWhens } from './when'

/** One story of chapters of scenes, each scene's When as given; scenes are named S1, S2 ... in reading order. */
function story(chapters: string[][]) {
  const db = memoryWorld()
  const [book] = repo.listStories(db)
  const outline = repo.getOutline(db, book.id)
  const scenes: ID[] = []
  chapters.forEach((whens, c) => {
    const chapter = c === 0 ? outline.chapters[0].id : repo.createChapter(db, book.id).id
    whens.forEach((when, s) => {
      const id = c === 0 && s === 0 ? outline.scenes[0].id : repo.createScene(db, chapter).id
      repo.updateSceneCard(db, id, { ...emptySceneCard(), when })
      scenes.push(id)
    })
  })
  const label = new Map(scenes.map((id, i) => [id, `S${i + 1}`]))
  const event = (name: string, when: string, making: EntryMaking = { origin: 'adam' }): ID =>
    repo.createEntry(db, 'event', { name, fields: { when } }, making).id
  const names = (): string[] => timelineOf(db, book.id).points.map((p) => (p.kind === 'event' ? p.title : label.get(p.id)!))
  return { db, book, scenes, event, names, points: (): TimelinePoint[] => timelineOf(db, book.id).points }
}

// Adam's story: three scenes on Day 1 (no time, then morning, then midday), then later days.
const ADAM = [['Day 1', 'Day 1, morning', 'Day 1, midday'], ['Day 2', 'Day 3, dusk'], ['Day 5', 'Day 8'], ['Day 14']]
// Events made in no particular order, as a build made them: by date, and a few with no date.
const EVENTS: [string, string][] = [
  ['D14', 'Day 14'],
  ['D2a', 'Day 2'],
  ['U1', ''],
  ['D1a', 'Day 1'],
  ['D3a', 'Day 3'],
  ['D20', 'Day 20'],
  ['D1b', 'Day 1'],
  ['D2b', 'Day 2'],
  ['D6', 'Day 6'],
  ['D3b', 'Day 3'],
  ['U2', ''],
  ['D4', 'Day 4']
]

/** Every event dated "Day N" sits among the scenes of its day: none before it is later, none after it earlier. */
function amongItsDay(points: TimelinePoint[]): void {
  const dayOf = (when: string): number | null => {
    const m = /^Day (\d+)/.exec(when)
    return m ? Number(m[1]) : null
  }
  points.forEach((p, i) => {
    const n = p.kind === 'event' ? dayOf(p.when) : null
    if (n === null) return
    for (const q of points.slice(0, i)) if (q.kind === 'scene') expect(dayOf(q.when)!, `${p.title} after ${q.when}`).toBeLessThanOrEqual(n)
    for (const q of points.slice(i + 1)) if (q.kind === 'scene') expect(dayOf(q.when)!, `${p.title} before ${q.when}`).toBeGreaterThanOrEqual(n)
  })
}

describe("Adam's timeline: events from an earlier build, all after the first scene", () => {
  const AFTER_S1 = ['S2', 'S3', 'D1a', 'D1b', 'S4', 'D2a', 'D2b', 'S5', 'D3a', 'D3b', 'D4', 'S6', 'D6', 'S7', 'S8', 'D14', 'D20']

  it("puts events that exist from the story's start among the scenes of their day", () => {
    const s = story(ADAM)
    for (const [name, when] of EVENTS) s.event(name, when, { origin: 'ai', originStoryId: s.book.id, originStart: true })
    expect(s.names()).toEqual(['S1', 'U1', 'U2', ...AFTER_S1])
    amongItsDay(s.points())
  })

  it("does the same for events from the world's start", () => {
    const s = story(ADAM)
    for (const [name, when] of EVENTS) s.event(name, when)
    expect(s.names()).toEqual(['S1', 'U1', 'U2', ...AFTER_S1])
  })

  it('ignores a tie to scene 1 that its date contradicts, and keeps the ones on its day there', () => {
    const s = story(ADAM)
    for (const [name, when] of EVENTS) s.event(name, when, { origin: 'ai', originStoryId: s.book.id, originSceneId: s.scenes[0] })
    expect(s.names()).toEqual(['S1', 'U1', 'U2', 'D1a', 'D1b', 'S2', 'S3', 'S4', 'D2a', 'D2b', 'S5', 'D3a', 'D3b', 'D4', 'S6', 'D6', 'S7', 'S8', 'D14', 'D20'])
    amongItsDay(s.points())
  })
})

describe('an event tied to a scene', () => {
  it('stays at a scene on its day, whatever time it says, and goes by its date from a scene on another day', () => {
    const s = story(ADAM)
    const at = (i: number): EntryMaking => ({ origin: 'ai', originStoryId: s.book.id, originSceneId: s.scenes[i] })
    s.event('Morning call', 'Day 1, dusk', at(1))
    s.event('Wrong scene', 'Day 2', at(6))
    s.event('Day 3 at S5', 'Day 3, dawn', at(4))
    expect(s.names()).toEqual(['S1', 'S2', 'Morning call', 'S3', 'S4', 'Wrong scene', 'S5', 'Day 3 at S5', 'S6', 'S7', 'S8'])
  })

  it('stays at an undated scene that sits where its date belongs, and leaves one that doesn’t', () => {
    const s = story([['Day 1', '', 'Day 3', '', 'Day 9']])
    const at = (i: number): EntryMaking => ({ origin: 'ai', originStoryId: s.book.id, originSceneId: s.scenes[i] })
    s.event('Fits', 'Day 2', at(1))
    s.event('Too late', 'Day 6', at(1))
    expect(s.names()).toEqual(['S1', 'S2', 'Fits', 'S3', 'S4', 'Too late', 'S5'])
  })
})

describe('the time of day', () => {
  it("orders events among their day's scenes by time; without one, after the day's last scene", () => {
    const s = story(ADAM)
    for (const [name, when] of [
      ['Night', 'Day 1, night'],
      ['Dawn', 'Day 1, dawn'],
      ['Noon', 'Day 1, noon'],
      ['Forenoon', 'Day 1, forenoon'],
      ['All day', 'Day 1']
    ])
      s.event(name, when)
    expect(s.names().slice(0, 9)).toEqual(['S1', 'Dawn', 'S2', 'Forenoon', 'S3', 'All day', 'Noon', 'Night', 'S4'])
  })
})

describe('a story dated by the calendar', () => {
  it('places real dates and counted days by their date, ignoring a scene that contradicts them', () => {
    const s = story([['12 March 1842, morning', '13 March 1842', '20 March 1842']])
    s.event('Evening', '12 March 1842, evening')
    s.event('Day Two', 'Day 2', { origin: 'ai', originStoryId: s.book.id, originSceneId: s.scenes[0] })
    s.event('The 14th', '14 March 1842', { origin: 'ai', originStoryId: s.book.id, originSceneId: s.scenes[2] })
    s.event('Later', '25 March 1842')
    expect(s.names()).toEqual(['S1', 'Evening', 'S2', 'Day Two', 'The 14th', 'S3', 'Later'])
  })
})

describe('before the first day', () => {
  it("puts Day 0 just after the story's opening scene, however it was made", () => {
    const s = story(ADAM)
    s.event('Start', 'Day 0', { origin: 'ai', originStoryId: s.book.id, originStart: true })
    s.event('Pinned', 'Day 0', { origin: 'ai', originStoryId: s.book.id, originSceneId: s.scenes[2] })
    s.event('Found', 'Day 0', { origin: 'text', originStoryId: s.book.id, originSceneId: s.scenes[4] })
    expect(s.names().slice(0, 5)).toEqual(['S1', 'Start', 'Pinned', 'Found', 'S2'])
  })

  it('keeps backstory dated by a year before the story', () => {
    const s = story(ADAM)
    s.event('The Founding', 'in the year 312')
    s.event('The Treaty', 'Year 290', { origin: 'ai', originStoryId: s.book.id, originStart: true })
    s.event('Day One', 'Day 1', { origin: 'ai', originStoryId: s.book.id, originStart: true })
    expect(s.names().slice(0, 7)).toEqual(['The Treaty', 'The Founding', 'S1', 'S2', 'S3', 'Day One', 'S4'])
  })
})

describe('events with no date', () => {
  it('go after the scene they are tied to or found in, else after the opening scene', () => {
    const s = story(ADAM)
    s.event('Planned', '', { origin: 'ai', originStoryId: s.book.id, originSceneId: s.scenes[3] })
    s.event('Found', '', { origin: 'text', originStoryId: s.book.id, originSceneId: s.scenes[4] })
    s.event('From the start', '', { origin: 'ai', originStoryId: s.book.id, originStart: true })
    s.event('Unreadable', 'after the wedding', { origin: 'text', originStoryId: s.book.id, originSceneId: s.scenes[5] })
    expect(s.names()).toEqual(['S1', 'From the start', 'S2', 'S3', 'S4', 'Planned', 'S5', 'Found', 'S6', 'Unreadable', 'S7', 'S8'])
  })
})

describe('events the memory keeper found in the text', () => {
  it('stay at their scene when its day is theirs, and go by their date when they tell of another day', () => {
    const s = story(ADAM)
    const found: EntryMaking = { origin: 'text', originStoryId: s.book.id, originSceneId: s.scenes[4] }
    s.event('The quarrel', 'Day 3, dusk', found)
    s.event('The old fire', 'Day 1', found)
    expect(s.names()).toEqual(['S1', 'S2', 'S3', 'The old fire', 'S4', 'S5', 'The quarrel', 'S6', 'S7', 'S8'])
  })
})

describe('flashbacks', () => {
  it("keep the present's events on the main line, unless an event is tied to the flashback on its day", () => {
    const s = story([['Day 1', 'Day 4', 'Flashback: Day 2', 'Day 5']])
    s.event('Then', 'Day 2', { origin: 'ai', originStoryId: s.book.id, originSceneId: s.scenes[2] })
    s.event('Day Two', 'Day 2', { origin: 'ai', originStoryId: s.book.id, originStart: true })
    s.event('Day Four', 'Day 4', { origin: 'ai', originStoryId: s.book.id, originSceneId: s.scenes[2] })
    expect(s.names()).toEqual(['S1', 'Day Two', 'S3', 'Then', 'S2', 'Day Four', 'S4'])
  })

  it('never put an event before a story that opens on a flashback', () => {
    const s = story([['Day 5', 'Flashback: Day 1', 'Day 6']])
    s.event('Long before', 'Day 1', { origin: 'ai', originStoryId: s.book.id, originStart: true })
    s.event('Day Six', 'Day 6, night', { origin: 'ai', originStoryId: s.book.id, originStart: true })
    expect(s.names()).toEqual(['S2', 'S1', 'Long before', 'S3', 'Day Six'])
  })
})

describe('books that follow on', () => {
  it("keep each event in its own book's days", () => {
    const db = memoryWorld()
    const [one] = repo.listStories(db)
    const two = repo.createStory(db, { title: 'Book 2', startStoryId: one.id })
    const scenes: ID[] = [repo.getOutline(db, one.id).scenes[0].id]
    const ch1 = repo.getOutline(db, one.id).chapters[0].id
    scenes.push(repo.createScene(db, ch1).id, repo.createScene(db, ch1).id)
    const ch2 = repo.createChapter(db, two.id).id
    scenes.push(repo.createScene(db, ch2).id, repo.createScene(db, ch2).id)
    ;['Day 1', 'Day 2', 'Day 3', 'Day 1', 'Day 2'].forEach((when, i) => repo.updateSceneCard(db, scenes[i], { ...emptySceneCard(), when }))
    const make = (name: string, when: string, storyId: ID): void =>
      void repo.createEntry(db, 'event', { name, fields: { when } }, { origin: 'ai', originStoryId: storyId, originStart: true })
    make('Two: Day 2', 'Day 2', two.id)
    make('One: Day 2', 'Day 2', one.id)
    make('Two: Day 1', 'Day 1', two.id)
    const label = new Map(scenes.map((id, i) => [id, i < 3 ? `B1 S${i + 1}` : `B2 S${i - 2}`]))
    const names = timelineOf(db, two.id).points.map((p) => (p.kind === 'event' ? p.title : label.get(p.id)))
    expect(names).toEqual(['B1 S1', 'B1 S2', 'One: Day 2', 'B1 S3', 'B2 S1', 'Two: Day 1', 'B2 S2', 'Two: Day 2'])
  })
})

describe('the rule itself', () => {
  const scenes = (whens: string[]): PlaceScene[] => placeWhens(whens).map((p, i) => ({ key: p?.key ?? null, back: whens[i].startsWith('Flashback') }))
  const keyOf = (when: string, before: string[]): number[] => placeWhens([...before, when])[before.length]!.key!

  it('says how an event stands to a scene', () => {
    expect(eventVsScene(1, null, null)).toBe(1)
    expect(eventVsScene(-2, 900, 100)).toBe(-1)
    expect(eventVsScene(0, null, 540)).toBe(0)
    expect(eventVsScene(0, 1320, 540)).toBe(1)
    expect(eventVsScene(0, 1320, 540, true)).toBe(0)
  })

  it('places by date, keeps an agreeing tie, and falls back for no date', () => {
    const list = ['Day 1', 'Day 2', 'Day 4']
    const s = scenes(list)
    const event = (when: string, tied: number | null = null) => ({
      key: when ? keyOf(when, list) : null,
      backstory: false,
      tied,
      read: 0,
      opening: 0
    })
    expect(placeEvent(event('Day 3'), s)).toEqual({ after: 1, rank: 2 })
    expect(placeEvent(event('Day 3', 0), s)).toEqual({ after: 1, rank: 2 })
    expect(placeEvent(event('Day 2', 1), s)).toEqual({ after: 1, rank: 2 })
    expect(placeEvent(event('Day 9'), s)).toEqual({ after: 2, rank: 2 })
    expect(placeEvent(event('Day 0', 2), s)).toEqual({ after: 0, rank: 0 })
    expect(placeEvent(event('', 2), s)).toEqual({ after: 2, rank: 1 })
  })
})
