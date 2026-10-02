// The timeline on the fixed test world (tests/unit/testWorld.ts): Book 1 with Kell's Road running
// alongside it after Ch 1, events, a clash and a place inside another.
import { describe, expect, it } from 'vitest'
import { emptySceneCard } from '@shared/defaults'
import type { SceneCard } from '@shared/types'
import type { TimelinePoint } from '@shared/contracts/worldViews'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import { dbWorld } from '../../../tests/unit/testWorld'
import { memoryWorld } from '../../../tests/unit/helpers'
import { timelineOf } from './index'
import { timelineOrder } from './timeline'
import { placeWhens } from './when'

function world() {
  const w = dbWorld()
  const { db } = w
  const ashford = repo.createEntry(db, 'place', { name: 'Ashford' })
  const hall = repo.createEntry(db, 'place', { name: 'the Great Hall', parentId: ashford.id })
  const fire = repo.createEntry(db, 'event', { name: 'The fire', fields: { when: 'Day 1, Year 1, midday' } })
  const wedding = { name: 'The wedding', fields: { when: 'Day 9, Year 1' } }
  const later = repo.createEntry(db, 'event', wedding, { origin: 'adam', originStoryId: w.id('b2') })
  mem.insertChange(db, {
    kind: 'relationship',
    payload: { otherId: fire.id, type: 'involved in', feels: '', otherFeels: '' },
    entryId: w.id('mara'),
    anchor: 'baseline',
    origin: 'adam'
  })
  const card = (key: string, c: Partial<SceneCard>): void => void repo.updateSceneCard(db, w.id(key), { ...emptySceneCard(), ...c })
  const [mara, tobin, kell, mill] = ['mara', 'tobin', 'kell', 'mill'].map(w.id)
  card('b1.c1.s1', { when: 'Day 1, Year 1, dawn', povId: mara, locationId: ashford.id })
  card('b1.c1.s2', { when: 'Day 1, Year 1, at dusk', presentIds: [mara, tobin], locationId: mill })
  card('b1.c2.s1', { when: '' })
  card('b1.c2.s2', { when: 'Day 3' })
  card('kr.c1.s1', { when: 'Day 2, Year 1', povId: kell })
  card('kr.c1.s2', { when: 'The next day', presentIds: [kell], locationId: mill })
  card('b1.c3.s1', { when: 'Day 3, Year 1, night', povId: tobin, locationId: hall.id })
  card('b1.c3.s2', { when: 'Day 3', presentIds: [tobin], locationId: ashford.id, paysOffIds: [w.id('burned')] })
  return { ...w, ashford, hall, fire, later }
}

const names = (points: TimelinePoint[]): string[] => points.map((p) => (p.kind === 'event' ? p.title : p.place))

describe('the timeline', () => {
  const w = world()
  const t = timelineOf(w.db, w.id('b1'))

  it('puts scenes and events in in-world order, keeping undated scenes where they are read', () => {
    expect(names(t.points)).toEqual([
      'Book 1, Ch 1, Sc 1',
      'The fire',
      'Book 1, Ch 1, Sc 2',
      'Book 1, Ch 2, Sc 1',
      "Kell's Road, Ch 1, Sc 1",
      'Book 1, Ch 2, Sc 2',
      "Kell's Road, Ch 1, Sc 2",
      'Book 1, Ch 3, Sc 1',
      'Book 1, Ch 3, Sc 2'
    ])
    const undated = t.points.find((p) => p.place === 'Book 1, Ch 2, Sc 1')!
    expect(undated).toMatchObject({ dated: false, when: '', day: null })
    expect(t.points.filter((p) => !p.dated)).toHaveLength(1)
  })

  it('shows only what the story knows of: events from later stories stay off', () => {
    expect(t.points.some((p) => p.id === w.later.id)).toBe(false)
    expect(timelineOf(w.db, w.id('b2')).points.some((p) => p.id === w.later.id)).toBe(true)
    // Mara Keeps Her Hand leaves Book 1 after Ch 2, Sc 1: Kell's Road never happens in it.
    expect(timelineOf(w.db, w.id('keep')).points.some((p) => p.storyId === w.id('kr'))).toBe(false)
  })

  it('says who is in each point, with the point of view, and who an event involved', () => {
    const first = t.points[0]
    expect(first).toMatchObject({ kind: 'scene', storyId: w.id('b1'), povId: w.id('mara'), presentIds: [w.id('mara')] })
    expect(t.points[1]).toMatchObject({ kind: 'event', id: w.fire.id, presentIds: [w.id('mara')], when: 'Day 1, Year 1, midday' })
    expect(t.entries.find((e) => e.id === w.id('mara'))).toMatchObject({ kind: 'character', name: 'Mara' })
    expect(t.entries.find((e) => e.id === w.ashford.id)?.kind).toBe('place')
  })

  it('marks where plot threads are set up and paid off, from the memory and the scene cards', () => {
    const at = (place: string) => t.points.find((p) => p.place === place)!
    expect(at('Book 1, Ch 1, Sc 2').setsUpIds).toEqual([w.id('burned')])
    expect(at('Book 1, Ch 3, Sc 2').paysOffIds).toEqual([w.id('burned')])
  })

  it('finds a character in two places on the same day, in plain words', () => {
    expect(t.clashes).toEqual([
      {
        characterId: w.id('mara'),
        sceneIds: [w.id('b1.c1.s1'), w.id('b1.c1.s2')],
        text: 'Mara is in Ashford and Harrow Mill on Day 1, Year 1.'
      }
    ])
    expect(t.points[0].clashes).toEqual([0])
    expect(t.points[2].clashes).toEqual([0])
    // Tobin in the Great Hall and in Ashford, which holds it, on Day 3: the same place.
    expect(t.clashes.some((c) => c.characterId === w.id('tobin'))).toBe(false)
  })

  it('never writes the in-world order into the scene cards', () => {
    for (const key of ['b1.c1.s1', 'b1.c2.s2', 'kr.c1.s2']) expect(repo.getScene(w.db, w.id(key)).card.whenSort).toBeNull()
  })

  it('refuses a story that no longer exists, in plain words', () => {
    expect(() => timelineOf(w.db, 'gone')).toThrow('That story no longer exists.')
  })
})

describe('clashes', () => {
  it('name the day from a scene that says it outright, and leave days that are only implied alone', () => {
    const db = memoryWorld()
    const story = repo.listStories(db)[0]
    const chapter = repo.getOutline(db, story.id).chapters[0]
    const mara = repo.createEntry(db, 'character', { name: 'Mara' })
    const [a, b, c] = ['Ashford', 'the Mill', 'the Ferry'].map((name) => repo.createEntry(db, 'place', { name }))
    const scenes = [repo.getOutline(db, story.id).scenes[0].id, ...[1, 2, 3].map(() => repo.createScene(db, chapter.id).id)]
    const card = (i: number, c: Partial<SceneCard>): void => void repo.updateSceneCard(db, scenes[i], { ...emptySceneCard(), ...c })
    card(0, { when: 'Day 11', presentIds: [mara.id], locationId: a.id })
    card(1, { when: 'The next day', presentIds: [mara.id], locationId: b.id })
    card(2, { when: 'Day 12, dusk', povId: mara.id, locationId: c.id })
    // Only a time of day: later the same day for ordering, but it never names the day.
    card(3, { when: 'Night', presentIds: [mara.id], locationId: a.id })
    const t = timelineOf(db, story.id)
    expect(t.clashes.map((x) => x.text)).toEqual(['Mara is in the Mill and the Ferry on Day 12.'])
    expect(t.clashes[0].sceneIds).toEqual([scenes[1], scenes[2]])
  })
})

describe('timeline order', () => {
  const order = (texts: string[]): string[] => timelineOrder(placeWhens(texts)).map((i) => texts[i] || `(${i})`)

  it('keeps undated points just after the point before them in reading order', () => {
    expect(order(['', 'Day 5', '', 'Day 2', ''])).toEqual(['(0)', 'Day 2', '(4)', 'Day 5', '(2)'])
  })

  it('is reading order when nothing is dated', () => {
    expect(order(['', 'soon', 'long ago'])).toEqual(['(0)', 'soon', 'long ago'])
  })

  it('gives every point exactly once', () => {
    const texts = ['Day 3', '', 'Day 1', 'x', 'Day 2', '', '']
    const ids = timelineOrder(placeWhens(texts))
    expect([...ids].sort()).toEqual(texts.map((_, i) => i))
  })
})

describe('an empty world', () => {
  it('has a timeline of its first scene, undated', () => {
    const db = memoryWorld()
    const story = repo.listStories(db)[0]
    const t = timelineOf(db, story.id)
    expect(t.points).toHaveLength(1)
    expect(t.points[0]).toMatchObject({ kind: 'scene', dated: false, place: 'Book 1, Ch 1, Sc 1', title: 'Scene 1' })
    expect(t.clashes).toEqual([])
  })
})
