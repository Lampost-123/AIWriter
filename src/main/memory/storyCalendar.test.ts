// The story calendar read from a world (long story memory fix 11), on the fixed test world (tests/unit/testWorld.ts):
// Book 1 has three chapters of two scenes, and Kell's Road, a side story that starts after Ch 1 and is added whole after
// Ch 2, has two.
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { emptySceneCard } from '@shared/defaults'
import type { SceneCard } from '@shared/types'
import * as repo from '../db/repo'
import * as kdb from '../db/keeper'
import * as mem from '../db/memory'
import { dbWorld } from '../../../tests/unit/testWorld'
import { memoryWorld } from '../../../tests/unit/helpers'
import { timeCues } from '../continuity/tracker'
import { sceneMemory } from './scene'
import {
  ageAt,
  calendarOfScene,
  elapsedBetweenScenes,
  sceneCalendar,
  sceneDateView,
  scenesGoingBack,
  storyCalendar,
  storyDateAt,
  storyDateViews
} from './storyCalendar'
import { elapsedWords } from './calendar'
import { budget } from '../../shared/testPerf'

function world(whens: Record<string, string>) {
  const w = dbWorld()
  const card = (key: string, c: Partial<SceneCard>): void => {
    const id = w.id(key)
    repo.updateSceneCard(w.db, id, { ...emptySceneCard(), ...repo.getScene(w.db, id).card, ...c })
  }
  for (const [key, when] of Object.entries(whens)) card(key, { when })
  return { ...w, card }
}

describe('a story’s calendar', () => {
  const w = world({
    'b1.c1.s1': 'Day 1, dusk',
    'b1.c1.s2': 'That night',
    'b1.c2.s1': 'Three days later',
    'b1.c2.s2': 'The next morning',
    'kr.c1.s1': 'The next day',
    'kr.c1.s2': 'Day 10',
    'b1.c3.s1': 'The next day',
    'b1.c3.s2': 'Day 4'
  })
  const day = (key: string) => storyDateAt(w.db, w.id(key))?.day ?? null

  it('counts the days along the story’s line, a side story leaning on its book where it starts', () => {
    expect(['b1.c1.s1', 'b1.c1.s2', 'b1.c2.s1', 'b1.c2.s2', 'b1.c3.s1'].map(day)).toEqual([1, 1, 4, 5, 6])
    // Kell's Road starts after Ch 1 (Day 1): its "next day" is Day 2, though it is read after Ch 2.
    expect(day('kr.c1.s1')).toBe(2)
    // And Book 1 counts on from its own scenes, not from Kell's Road read just before.
    expect(day('b1.c3.s1')).toBe(6)
    expect(elapsedWords(elapsedBetweenScenes(w.db, w.id('b1.c1.s1'), w.id('b1.c3.s1'))!)).toBe('5 days')
  })

  it('finds a scene that goes back without saying so, never a side story read alongside', () => {
    expect(scenesGoingBack(w.db, w.id('b1')).map((b) => [b.sceneId, b.beforeId])).toEqual([[w.id('b1.c3.s2'), w.id('b1.c3.s1')]])
    w.card('b1.c3.s2', { when: 'Flashback: Day 4' })
    expect(scenesGoingBack(w.db, w.id('b1'))).toEqual([])
    w.card('b1.c3.s2', { when: 'Day 4' })
  })

  it('says on the screen how a When was read, only when that adds to the words', () => {
    const views = storyDateViews(w.db, w.id('b1'))
    const note = (key: string) => views[w.id(key)].note
    // "Day 1, dusk" reads as itself: the usual hint stays.
    expect(views[w.id('b1.c1.s1')]).toEqual({ when: 'Day 1, dusk', label: 'Day 1 · dusk', day: '', note: '', detail: '' })
    expect(note('b1.c1.s2')).toBe('Reads as Day 1 · night.')
    expect(note('b1.c2.s2')).toBe('Reads as Day 5 · morning.')
    expect(views[w.id('b1.c2.s2')].day).toBe('Day 5')
    expect(note('b1.c3.s2')).toBe('Earlier than the scene before. A flashback?')
    // In full on hover: what to do about it.
    expect(views[w.id('b1.c3.s2')].detail).toBe(
      'This comes before the scene before it (Day 6). If it’s a flashback, start the When with “Flashback” and AI Write will know.'
    )
    // Only the story's own scenes.
    expect(views[w.id('kr.c1.s1')]).toBeUndefined()
    expect(storyDateViews(w.db, w.id('kr'))[w.id('kr.c1.s1')].note).toBe('Reads as Day 2.')
  })

  it('says which real day a counted day is, once a card names one (live test, 2026-10-16)', () => {
    const v = world({ 'b1.c1.s1': 'Day 1, dusk', 'b1.c1.s2': 'Day 3', 'b1.c2.s1': 'Day 25, Christmas Eve', 'b1.c2.s2': 'Day 26' })
    const views = storyDateViews(v.db, v.id('b1'))
    expect(views[v.id('b1.c1.s2')].note).toBe('Reads as Day 3 · 2 December.')
    expect(views[v.id('b1.c2.s1')].note).toBe('Reads as Day 25 · 24 December.')
  })

  it('notes gently what it couldn’t tell', () => {
    const v = world({ 'b1.c1.s1': 'The next day', 'b1.c1.s2': 'after the wedding', 'b1.c2.s1': 'Day 3', 'b1.c2.s2': 'Days later' })
    const views = storyDateViews(v.db, v.id('b1'))
    const note = (key: string) => views[v.id(key)].note
    expect(note('b1.c1.s1')).toBe('Nothing dated before this to count on from.')
    expect(views[v.id('b1.c1.s1')].detail).toBe('No scene before this one names its day, so AI Write can’t work out which day this is.')
    expect(note('b1.c1.s2')).toBe('AI Write can’t read a date in this.')
    expect(views[v.id('b1.c1.s2')].detail).toBe('AI Write can’t tell the date from this, so the AI gets your words as they are.')
    expect(note('b1.c2.s1')).toBe('')
    expect(note('b1.c2.s2')).toBe('Doesn’t say how many days, so the count stops.')
    expect(views[v.id('b1.c3.s1')]).toEqual({ when: '', label: '', day: '', note: '', detail: '' })
  })

  it('is read again when a card changes, and kept while nothing does', () => {
    const v = world({ 'b1.c1.s1': 'Day 1', 'b1.c1.s2': 'The next day' })
    const first = storyCalendar(v.db, v.id('b1'))
    expect(storyCalendar(v.db, v.id('b1'))).toBe(first)
    v.card('b1.c1.s1', { when: 'Day 7' })
    expect(storyDateAt(v.db, v.id('b1.c1.s2'))?.day).toBe(8)
  })

  it('is kept while only other things are written (where things stand, the memory, the words), read again for a chapter or a move', () => {
    const v = world({ 'b1.c1.s1': 'Day 1, dusk', 'b1.c1.s2': 'That night' })
    const first = storyCalendar(v.db, v.id('b1'))
    repo.setMeta(v.db, 'continuity', '{}')
    repo.createEntry(v.db, 'character', { name: 'Someone new' })
    const doc = { type: 'doc', content: [{ type: 'paragraph', attrs: { pid: 'p1' }, content: [{ type: 'text', text: 'Words.' }] }] }
    repo.saveSceneText(v.db, v.id('b1.c1.s1'), doc, 'Words.')
    expect(storyCalendar(v.db, v.id('b1'))).toBe(first)
    // A chapter renamed (the start of a chapter is said by its title) is read again.
    repo.updateChapter(v.db, v.id('b1.c1'), { title: 'The Siege' })
    expect(storyCalendar(v.db, v.id('b1'))).not.toBe(first)
  })

  it('says one scene’s date on its own, and keeps it with the calendar', () => {
    const v = world({ 'b1.c1.s1': 'Day 1', 'b1.c1.s2': 'The next morning' })
    let asked = 0
    const cues = (): Map<string, string> => {
      asked++
      return new Map()
    }
    const view = sceneDateView(v.db, v.id('b1.c1.s2'), cues)
    expect(view).toMatchObject({ label: 'Day 2 · morning', note: 'Reads as Day 2 · morning.' })
    expect(sceneDateView(v.db, v.id('b1.c1.s2'), cues)).toBe(view)
    // The memory is read only for a scene with no When.
    expect(asked).toBe(0)
    sceneDateView(v.db, v.id('b1.c2.s1'), cues)
    expect(asked).toBe(1)
  })
})

describe('a long story', () => {
  it('works out 500 scenes once, and the stage tracker asks about each without reading it all again', () => {
    const db = memoryWorld()
    const story = repo.listStories(db)[0]
    const first = repo.getOutline(db, story.id).chapters[0]
    const ids: string[] = [repo.getOutline(db, story.id).scenes[0].id]
    for (let c = 0; c < 25; c++) {
      const chapter = c === 0 ? first : repo.createChapter(db, story.id, { title: `Chapter ${c + 1}` })
      for (let i = c === 0 ? 1 : 0; i < 20; i++) ids.push(repo.createScene(db, chapter.id, { title: `Scene ${i + 1}` }).id)
    }
    expect(ids).toHaveLength(500)
    ids.forEach((id, i) =>
      repo.updateSceneCard(db, id, { ...emptySceneCard(), when: i === 0 ? 'Day 1, dawn' : i % 3 ? 'Later that day' : 'The next morning' })
    )
    const t0 = performance.now()
    const cal = calendarOfScene(db, ids[0])!
    const built = performance.now() - t0
    expect(cal.dates.get(ids[499])?.day).toBe(167)
    // As the tracker reads (startFrom for every scene, writing where things stand between): the same calendar each time.
    const t1 = performance.now()
    for (const id of ids) {
      repo.setMeta(db, 'continuity', JSON.stringify({ [id]: {} }))
      expect(calendarOfScene(db, id)).toBe(cal)
    }
    const asked = performance.now() - t1
    expect(built).toBeLessThan(budget(2_000))
    expect(asked).toBeLessThan(budget(1_000))
  })
})

describe('the time of day from the memory', () => {
  it('takes it for a scene with no When, from its own words while they still match', () => {
    const w = world({ 'b1.c1.s1': 'Day 1' })
    const one = w.id('b1.c1.s1')
    const two = w.id('b1.c1.s2')
    const doc = (text: string) => ({
      type: 'doc',
      content: [{ type: 'paragraph', attrs: { pid: 'p1' }, content: [{ type: 'text', text }] }]
    })
    repo.saveSceneText(w.db, two, doc('The lamps were lit.'), 'The lamps were lit.')
    const hash = (id: string) =>
      createHash('sha1')
        .update(kdb.keeperScene(w.db, id)?.text ?? '')
        .digest('hex')
        .slice(0, 16)
    const kept = (id: string, time: string, from: string) => ({
      hash: hash(id),
      base: '',
      state: { time, weather: '', light: '', characters: [], said: { '|time': { quote: 'x', sceneId: from } } }
    })
    repo.setMeta(w.db, 'continuity', JSON.stringify({ [two]: kept(two, 'late evening', two), [one]: kept(one, 'dawn', two) }))
    // The scene with a When keeps it; a time whose words come from another scene isn't its own.
    expect([...timeCues(w.db, [one, two])]).toEqual([[two, 'late evening']])
    const views = storyDateViews(w.db, w.id('b1'), timeCues(w.db, [two]))
    expect(views[two]).toEqual({
      when: '',
      label: 'late evening',
      day: '',
      note: 'No date yet. By the scene’s end it’s late evening.',
      detail: 'No date yet. By the scene’s end it’s late evening.'
    })
    expect(storyDateAt(w.db, two, timeCues(w.db, [two]))).toMatchObject({ day: null, time: 'late evening', timeFrom: 'memory' })
    // Words changed since: not used.
    repo.saveSceneText(w.db, two, doc('Morning came.'), 'Morning came.')
    expect(timeCues(w.db, [two]).size).toBe(0)
  })
})

describe('the calendar in a scene’s briefing', () => {
  const w = world({
    'b1.c1.s1': '1 March 1820',
    'b1.c1.s2': 'The next day',
    'b1.c2.s1': '20 June 1823, dusk',
    'b1.c2.s2': 'That evening'
  })
  const mara = w.id('mara')
  const tobin = w.id('tobin')
  repo.updateEntry(w.db, mara, { fields: { hair: 'long and dark', marks: 'none', age: '34' } })
  repo.updateEntry(w.db, tobin, { fields: { age: 'born 12 March 1790' } })
  repo.createEntry(w.db, 'event', { name: 'The Siege of Varn', fields: { when: '1 May 1822' } })
  w.card('b1.c2.s2', { povId: mara, presentIds: [mara, tobin] })
  const scene = w.id('b1.c2.s2')

  it('has the date, the scene before, earlier days to count from and the ages on the card', () => {
    const memory = sceneMemory(w.db, scene, { forWriter: true })
    const cal = sceneCalendar(w.db, scene, memory, repo.getScene(w.db, scene).card)!
    expect(cal.here).toMatchObject({ date: '20 June 1823', time: 'evening', day: 1207 })
    expect(cal.previous).toMatchObject({ date: '20 June 1823', time: 'dusk' })
    // The siege, then the start of Ch 1 (Ch 2 begins with the scene before, which is said anyway).
    expect(cal.landmarks.map((l) => l.name)).toEqual(['the Siege of Varn', 'the start of Ch 1'])
    expect(cal.ages.map((a) => [a.name, a.age.age, a.age.basis])).toEqual([
      ['Mara', { lo: 37, hi: 38, about: false }, "34 at the story's start"],
      ['Tobin', { lo: 33, hi: 33, about: false }, 'born 12 March 1790']
    ])
    expect(ageAt(w.db, tobin, scene)?.age).toEqual({ lo: 33, hi: 33, about: false })
    expect(ageAt(w.db, w.id('b1.c1.s1'), scene)).toBeNull()
  })

  it('takes an age as of the scene where the memory set it', () => {
    repo.updateEntry(w.db, mara, { fields: { hair: 'long and dark', marks: 'none', age: '' } })
    const second = w.id('b1.c1.s2')
    mem.insertChange(w.db, {
      kind: 'update',
      payload: { note: 'turned twenty', fields: { age: '20' } },
      entryId: mara,
      anchor: 'scene',
      sceneId: second,
      origin: 'adam'
    })
    const memory = sceneMemory(w.db, scene, { forWriter: true })
    const cal = sceneCalendar(w.db, scene, memory, repo.getScene(w.db, scene).card)!
    expect(cal.ages[0]).toMatchObject({ name: 'Mara', age: { age: { lo: 23, hi: 24 }, basis: '20 as of Book 1, Ch 1, Sc 2', given: 20 } })
  })
})
