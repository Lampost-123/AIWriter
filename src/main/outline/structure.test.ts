import { describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import type { KeepItem } from '@shared/contracts/outline'
import type { ID } from '@shared/types'
import * as repo from '../db/repo'
import * as acts from '../db/acts'
import { memoryWorld } from '../../../tests/unit/helpers'
import { pureWorld } from '../../../tests/unit/testWorld'
import { parseWhen, placeWhens } from '../worldViews/when'
import { actDeleteNotes, cleanBeats, createChapterAt, fallbackWhen, keepOutline, takeBackThreads } from './structure'

const book = (db: Database.Database): ID => repo.listStories(db)[0].id

/** A world whose story has words in its first scene already, so the outline is added after what is there. */
function writtenWorld(): Database.Database {
  const db = memoryWorld()
  repo.saveSceneText(db, repo.getOutline(db, book(db)).scenes[0].id, null, 'The rain had not stopped for days.')
  return db
}

/** "Act: chapter [scene, scene]" lines, the chapters with no act under "-". */
function tree(db: Database.Database): string[] {
  const o = repo.getOutline(db, book(db))
  const chapter = (c: (typeof o.chapters)[number]): string =>
    `${c.title} [${o.scenes
      .filter((s) => s.chapterId === c.id)
      .map((s) => s.title)
      .join(', ')}]`
  const lines: string[] = []
  const loose = o.chapters.filter((c) => !c.actId)
  if (loose.length) lines.push(`-: ${loose.map(chapter).join(' ')}`)
  for (const a of o.acts ?? [])
    lines.push(
      `${a.title}: ${o.chapters
        .filter((c) => c.actId === a.id)
        .map(chapter)
        .join(' ')}`
    )
  return lines
}

const act = (key: string, title: string, more: Partial<KeepItem> = {}): KeepItem => ({
  key,
  kind: 'act',
  title,
  text: `${title} purpose.`,
  ...more
})
const chapter = (key: string, title: string, more: Partial<KeepItem> = {}): KeepItem => ({
  key,
  kind: 'chapter',
  title,
  text: `${title} goal.`,
  ...more
})
const scene = (key: string, title: string, parent: string, more: Partial<KeepItem> = {}): KeepItem => ({
  key,
  kind: 'scene',
  title,
  text: `${title} happens.`,
  beats: ['First', 'Second'],
  parent: { key: parent },
  ...more
})

describe('keeping what the outline helper suggested', () => {
  it('adds acts, chapters and scenes after what the story has, with each card filled', () => {
    const db = writtenWorld()
    const kept = keepOutline(db, book(db), [
      act('a0', 'The Arrival'),
      chapter('a0c0', 'Rain', { parent: { key: 'a0' } }),
      scene('a0c0s0', 'Docks', 'a0c0'),
      scene('a0c0s1', 'Ferry', 'a0c0', { after: { key: 'a0c0s0' } })
    ])
    expect(kept.map((k) => [k.key, k.kind])).toEqual([
      ['a0', 'act'],
      ['a0c0', 'chapter'],
      ['a0c0s0', 'scene'],
      ['a0c0s1', 'scene']
    ])
    expect(tree(db)).toEqual(['-: Chapter 1 [Scene 1]', 'The Arrival: Rain [Docks, Ferry]'])
    expect(acts.getAct(db, kept[0].id).purpose).toBe('The Arrival purpose.')
    expect(repo.getChapter(db, kept[1].id).goal).toBe('Rain goal.')
    expect(repo.getScene(db, kept[2].id).card).toMatchObject({ goal: 'Docks happens.', beats: ['First', 'Second'], notes: '', povId: null })
  })

  it('puts each one by the suggestions kept before it, or before the one kept after it', () => {
    const db = writtenWorld()
    const id = book(db)
    const first = keepOutline(db, id, [
      act('a1', 'Two'),
      chapter('a1c0', 'Two-one', { parent: { key: 'a1' } }),
      scene('s1', 'Late', 'a1c0')
    ])
    const [two, twoOne, late] = first.map((k) => k.id)
    keepOutline(db, id, [
      act('a0', 'One', { before: { id: two } }),
      chapter('a0c0', 'One-one', { parent: { key: 'a0' } }),
      chapter('a1c1', 'Two-two', { parent: { id: two }, after: { id: twoOne } }),
      chapter('a1cx', 'Two-zero', { parent: { id: two }, before: { id: twoOne } }),
      scene('s0', 'Early', 'x', { parent: { id: twoOne }, before: { id: late } })
    ])
    expect(tree(db)).toEqual(['-: Chapter 1 [Scene 1]', 'One: One-one []', 'Two: Two-zero [] Two-one [Early, Late] Two-two []'])
  })

  it('puts a chapter with no act into the story’s last act, or among the chapters with no act when it has none', () => {
    const db = writtenWorld()
    const id = book(db)
    keepOutline(db, id, [chapter('c0', 'Loose')])
    expect(tree(db)).toEqual(['-: Chapter 1 [Scene 1] Loose []'])
    keepOutline(db, id, [act('a0', 'One'), act('a1', 'Two')])
    keepOutline(db, id, [chapter('c1', 'Carries on')])
    expect(tree(db)).toEqual(['-: Chapter 1 [Scene 1] Loose []', 'One: ', 'Two: Carries on []'])
  })

  it('tidies titles and beats, and gives "Act N", "Chapter N" and "Scene N" to blank titles', () => {
    const db = writtenWorld()
    const kept = keepOutline(db, book(db), [
      act('a0', '  '),
      chapter('c0', ' The \n long   night ', { parent: { key: 'a0' } }),
      scene('s0', '', 'c0', { beats: ['  one  ', '', 'two\nlines', ...Array.from({ length: 20 }, (_, i) => `b${i}`)] })
    ])
    expect(tree(db)).toEqual(['-: Chapter 1 [Scene 1]', 'Act 1: The long night [Scene 1]'])
    const beats = repo.getScene(db, kept[2].id).card.beats
    expect(beats.slice(0, 3)).toEqual(['one', 'two lines', 'b0'])
    expect(beats).toHaveLength(12)
    expect(cleanBeats('nonsense')).toEqual([])
  })

  it('adds nothing when one of them can’t be added', () => {
    const db = memoryWorld()
    const before = tree(db)
    expect(() => keepOutline(db, book(db), [act('a0', 'One'), scene('s0', 'Nowhere', 'missing')])).toThrow('That chapter no longer exists.')
    expect(() => keepOutline(db, book(db), [act('a0', 'One'), act('a0', 'Twice')])).toThrow('Please suggest again.')
    expect(() => keepOutline(db, book(db), [chapter('c0', 'Lost', { parent: { id: 'gone' } })])).toThrow('That act no longer exists.')
    expect(tree(db)).toEqual(before)
    expect(keepOutline(db, book(db), [])).toEqual([])
  })

  it('leaves what it made marked as unchanged, so its Undo removes it for good', () => {
    const db = writtenWorld()
    const kept = keepOutline(db, book(db), [act('a0', 'One'), chapter('c0', 'Rain', { parent: { key: 'a0' } }), scene('s0', 'Docks', 'c0')])
    acts.takeBackKept(db, kept)
    expect(tree(db)).toEqual(['-: Chapter 1 [Scene 1]'])
    expect(repo.listDeleted(db)).toEqual([])
  })

  it('in a new story, takes the place of the empty "Chapter 1" and "Scene 1", and its Undo puts them back', () => {
    const db = memoryWorld()
    const id = book(db)
    const [first] = repo.getOutline(db, id).scenes
    const kept = keepOutline(db, id, [
      act('a0', 'The Arrival'),
      chapter('a0c0', 'Rain', { parent: { key: 'a0' } }),
      scene('a0c0s0', 'Docks', 'a0c0'),
      scene('a0c0s1', 'Ferry', 'a0c0', { after: { key: 'a0c0s0' } }),
      chapter('a0c1', 'Wind', { parent: { key: 'a0' } })
    ])
    expect(tree(db)).toEqual(['The Arrival: Rain [Docks, Ferry] Wind []'])
    // The scene open on the page is still there: it is now the outline's first scene, with its card filled.
    expect(kept[2]).toMatchObject({ id: first.id, reused: true })
    expect(kept[1]).toMatchObject({ id: first.chapterId, reused: true })
    expect(repo.getScene(db, first.id).card).toMatchObject({ goal: 'Docks happens.', beats: ['First', 'Second'] })
    expect(repo.getChapter(db, first.chapterId).goal).toBe('Rain goal.')

    expect(acts.takeBackKept(db, kept).sceneIds).not.toContain(first.id)
    expect(tree(db)).toEqual(['-: Chapter 1 [Scene 1]'])
    expect(repo.getScene(db, first.id).card.goal).toBe('')
    expect(repo.getChapter(db, first.chapterId).goal).toBe('')
    expect(repo.listDeleted(db)).toEqual([])
  })

  it('never takes the place of a first scene with words or a card, and its Undo keeps words written since', () => {
    const db = writtenWorld()
    keepOutline(db, book(db), [act('a0', 'One'), chapter('c0', 'Rain', { parent: { key: 'a0' } })])
    expect(tree(db)).toEqual(['-: Chapter 1 [Scene 1]', 'One: Rain []'])

    const carded = memoryWorld()
    const [s] = repo.getOutline(carded, book(carded)).scenes
    repo.updateSceneCard(carded, s.id, { ...repo.getScene(carded, s.id).card, goal: 'Mara finds the boat.' })
    keepOutline(carded, book(carded), [chapter('c0', 'Rain')])
    expect(tree(carded)).toEqual(['-: Chapter 1 [Scene 1] Rain []'])

    // Kept into the new story, then written in: Undo leaves the scene, words and all, where it is.
    const fresh = memoryWorld()
    const kept = keepOutline(fresh, book(fresh), [
      act('a0', 'One'),
      chapter('c0', 'Rain', { parent: { key: 'a0' } }),
      scene('s0', 'Docks', 'c0')
    ])
    repo.saveSceneText(fresh, kept[2].id, null, 'She came down to the docks.')
    acts.takeBackKept(fresh, kept)
    expect(tree(fresh)).toEqual(['-: Chapter 1 [Docks]'])
    expect(repo.getScene(fresh, kept[2].id).text).toBe('She came down to the docks.')
  })
})

describe('when each kept scene happens', () => {
  const whenOf = (db: Database.Database, id: ID): string => repo.getScene(db, id).card.when

  it('puts the When the AI gave on the card, and fills one it left out from the scene before', () => {
    const db = memoryWorld()
    const kept = keepOutline(db, book(db), [
      chapter('c0', 'Rain'),
      scene('s0', 'Docks', 'c0', { when: '  Day 1,\n morning ' }),
      scene('s1', 'Ferry', 'c0', { after: { key: 's0' }, when: 'Day 1, dusk' }),
      scene('s2', 'Market', 'c0', { after: { key: 's1' } }),
      chapter('c1', 'Wind', { after: { key: 'c0' } }),
      scene('s3', 'Tower', 'c1', { when: 'Day 2, morning' }),
      scene('s4', 'Bridge', 'c1', { after: { key: 's3' }, when: '' })
    ])
    const scenes = kept.filter((k) => k.kind === 'scene').map((k) => whenOf(db, k.id))
    expect(scenes).toEqual(['Day 1, morning', 'Day 1, dusk', 'Day 1', 'Day 2, morning', 'Day 2'])
    // Every one reads as a day on the timeline, in the order the story tells them.
    const placed = placeWhens(scenes)
    expect(placed.every((p) => p?.key)).toBe(true)
    expect(placed.map((p) => p?.day)).toEqual(['~0|n|1', '~0|n|1', '~0|n|1', '~0|n|2', '~0|n|2'])
  })

  it('starts a story with no dated scenes on Day 1, and carries on after the ones it has', () => {
    const db = writtenWorld()
    const id = book(db)
    const [first] = keepOutline(db, id, [chapter('c0', 'Rain'), scene('s0', 'Docks', 'c0')]).slice(1)
    expect(whenOf(db, first.id)).toBe('Day 1')
    const opening = repo.getOutline(db, id).scenes[0]
    repo.updateSceneCard(db, opening.id, { ...repo.getScene(db, opening.id).card, when: 'Day 9, Year 3, dusk' })
    const [, later] = keepOutline(db, id, [chapter('c1', 'Wind'), scene('s1', 'Bridge', 'c1')])
    expect(whenOf(db, later.id)).toBe('Day 1')
    // Before a scene with a When: the day of the nearest scene before it that has one.
    const [, between] = keepOutline(db, id, [chapter('c2', 'Fog', { after: { id: opening.chapterId } }), scene('s2', 'Gate', 'c2')])
    expect(whenOf(db, between.id)).toBe('Day 9, Year 3')
  })

  it('never replaces a When already on the reused first scene, and its Undo leaves it there', () => {
    const db = memoryWorld()
    const id = book(db)
    const [first] = repo.getOutline(db, id).scenes
    repo.updateSceneCard(db, first.id, { ...repo.getScene(db, first.id).card, when: 'Day 1', mood: 'Grey' })
    const kept = keepOutline(db, id, [chapter('c0', 'Rain'), scene('s0', 'Docks', 'c0', { when: 'Day 1, morning' })])
    expect(kept[1]).toMatchObject({ id: first.id, reused: true, whenKept: true })
    expect(repo.getScene(db, first.id).card).toMatchObject({ when: 'Day 1', mood: 'Grey', goal: 'Docks happens.' })
    acts.takeBackKept(db, kept)
    expect(repo.getScene(db, first.id).card).toMatchObject({ when: 'Day 1', mood: 'Grey', goal: '', beats: [] })

    // A When the keep put there goes with its Undo.
    const fresh = memoryWorld()
    const again = keepOutline(fresh, book(fresh), [chapter('c0', 'Rain'), scene('s0', 'Docks', 'c0', { when: 'Day 1, morning' })])
    expect(again[1].whenKept).toBeUndefined()
    expect(whenOf(fresh, again[1].id)).toBe('Day 1, morning')
    acts.takeBackKept(fresh, again)
    expect(whenOf(fresh, again[1].id)).toBe('')
  })

  it('fills a missing When with the day of the scene before, or "Later that day" after one that names none', () => {
    expect(fallbackWhen([])).toBe('Day 1')
    expect(fallbackWhen(['', ' '])).toBe('Day 1')
    expect(fallbackWhen(['Day 3, dusk', ''])).toBe('Day 3')
    expect(fallbackWhen(['Day 2', 'the 3rd of March 1204, at noon'])).toBe('3 March 1204')
    expect(fallbackWhen(['Day 2', 'The next morning'])).toBe('Later that day')
    for (const text of ['Day 1', 'Day 3', 'Later that day', 'Day 1, morning', 'Day 2, midday', 'Day 4, dusk', 'Day 5, night'])
      expect(parseWhen(text)).not.toBeNull()
    expect(placeWhens(['Day 2, evening', 'The next morning', 'Later that day']).map((p) => p?.day)).toEqual(['~0|n|2', '~0|n|3', '~0|n|3'])
  })
})

describe('a new chapter in an act', () => {
  it('goes where it is asked, titled as given or "Chapter N"', () => {
    const db = memoryWorld()
    const id = book(db)
    const one = acts.createAct(db, id, { title: 'One' })
    const a = createChapterAt(db, id, { actId: one.id, title: '  Opening ' })
    expect(a).toMatchObject({ title: 'Opening', actId: one.id })
    createChapterAt(db, id, { actId: one.id, beforeId: a.id })
    createChapterAt(db, id, { actId: null, index: 0 })
    // Numbered as chapters always are: by how many the story has.
    expect(tree(db)).toEqual(['-: Chapter 4 [] Chapter 1 [Scene 1]', 'One: Chapter 3 [] Opening []'])
  })
})

describe('what deleting an act does to other stories', () => {
  it('says where each story that starts or ends in its chapters will start or end instead', () => {
    // Kell's Road runs from after Book 1, Ch 1 to the end of Ch 2; Mara Keeps Her Hand starts after Ch 2, Sc 1.
    const { shape } = pureWorld()
    expect(actDeleteNotes(shape, ['b1.c1', 'b1.c2'])).toEqual([
      "Kell's Road now starts at the beginning of Book 1 instead.",
      "Kell's Road now ends at the beginning of Book 1 instead.",
      'Mara Keeps Her Hand now starts at the beginning of Book 1 instead.'
    ])
    expect(actDeleteNotes(shape, ['b1.c2'])).toEqual([
      "Kell's Road now ends after Book 1, Ch 1 instead.",
      'Mara Keeps Her Hand now starts after Book 1, Ch 1 instead.'
    ])
    expect(actDeleteNotes(shape, ['b1.c3'])).toEqual([])
    expect(actDeleteNotes(shape, [])).toEqual([])
  })
})

describe('plot threads planned in an outline (2026-10-08)', () => {
  it('puts each scene’s threads on its card as the AI’s, finding Adam’s threads by name and making new ones once', () => {
    const db = writtenWorld()
    const mine = repo.createEntry(db, 'thread', { name: 'The drowned bell', aliases: ['The bell'] })
    const kept = keepOutline(db, book(db), [
      chapter('c0', 'Rain'),
      scene('c0s0', 'Docks', 'c0', { setsUp: ['Who keeps the ferry key', 'the bell'] }),
      scene('c0s1', 'Ferry', 'c0', { after: { key: 'c0s0' }, paysOff: ['Who keeps the ferry key', 'The drowned bell'] })
    ])
    const threads = repo.listEntries(db).filter((e) => e.kind === 'thread')
    expect(threads.map((t) => t.name).sort()).toEqual(['The drowned bell', 'Who keeps the ferry key'])
    const key = threads.find((t) => t.name === 'Who keeps the ferry key')!
    expect(key.origin).toBe('ai')
    const [docks, ferry] = [kept[1].id, kept[2].id].map((id) => repo.getScene(db, id).card)
    expect(docks.setsUpIds).toEqual([key.id, mine.id])
    expect(ferry.paysOffIds).toEqual([key.id, mine.id])
    expect(docks.threadLinks).toEqual({ [`setsUp:${key.id}`]: 'ai', [`setsUp:${mine.id}`]: 'ai' })
    expect(kept[1].threadIds).toEqual([key.id])
    expect(kept[2].threadIds).toBeUndefined()

    // Undo of the keep: the scenes go, and so does the thread it made; Adam's stays.
    acts.takeBackKept(db, kept)
    takeBackThreads(db, kept)
    expect(
      repo
        .listEntries(db)
        .filter((e) => e.kind === 'thread')
        .map((t) => t.name)
    ).toEqual(['The drowned bell'])
  })

  it('an undone keep leaves a thread it made that another scene still uses', () => {
    const db = writtenWorld()
    const first = keepOutline(db, book(db), [chapter('c0', 'Rain'), scene('c0s0', 'Docks', 'c0', { setsUp: ['Who keeps the ferry key'] })])
    const id = first[1].threadIds![0]
    const other = repo.getOutline(db, book(db)).scenes[0].id
    repo.updateSceneCard(db, other, { ...repo.getScene(db, other).card, paysOffIds: [id] })
    acts.takeBackKept(db, first)
    takeBackThreads(db, first)
    expect(repo.getEntries(db, [id])).toHaveLength(1)
  })
})
