import { describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import type { KeepItem } from '@shared/contracts/outline'
import type { ID } from '@shared/types'
import * as repo from '../db/repo'
import * as acts from '../db/acts'
import { memoryWorld } from '../../../tests/unit/helpers'
import { pureWorld } from '../../../tests/unit/testWorld'
import { actDeleteNotes, cleanBeats, createChapterAt, keepOutline } from './structure'

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
