import { describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import type { ID } from '@shared/types'
import * as repo from './repo'
import * as acts from './acts'
import { purgeTrash } from './trash'
import { memoryWorld } from '../../../tests/unit/helpers'

// A story's order is its chapters' order: the chapters with no act first, then each act's chapters
// together, acts in their own order. These check every write keeps it so.

function book(db: Database.Database): ID {
  return repo.listStories(db)[0].id
}

/** The story as the binder shows it: "Act title: chapter, chapter" groups, the chapters with no act as "-". */
function shape(db: Database.Database, storyId = book(db)): string[] {
  const o = repo.getOutline(db, storyId)
  const groups: string[] = []
  const loose = o.chapters.filter((c) => !c.actId)
  if (loose.length) groups.push(`-: ${loose.map((c) => c.title).join(', ')}`)
  for (const a of o.acts ?? [])
    groups.push(
      `${a.title}: ${o.chapters
        .filter((c) => c.actId === a.id)
        .map((c) => c.title)
        .join(', ')}`
    )
  return groups
}

/** The chapters in the story's own order (what the memory goes by). */
const order = (db: Database.Database, storyId = book(db)): string[] => repo.getOutline(db, storyId).chapters.map((c) => c.title)

/** Checks the binder's grouping and the story's order agree. */
function expectInOrder(db: Database.Database, storyId = book(db)): void {
  const o = repo.getOutline(db, storyId)
  const grouped = [...o.chapters.filter((c) => !c.actId), ...(o.acts ?? []).flatMap((a) => o.chapters.filter((c) => c.actId === a.id))]
  expect(o.chapters.map((c) => c.id)).toEqual(grouped.map((c) => c.id))
  expect(o.chapters.map((c) => c.position)).toEqual(o.chapters.map((_, i) => i))
}

const chapterId = (db: Database.Database, title: string, storyId = book(db)): ID =>
  repo.getOutline(db, storyId).chapters.find((c) => c.title === title)!.id

describe('a story without acts', () => {
  it('looks exactly as before: no acts, and chapters made and moved as they always were', () => {
    const db = memoryWorld()
    const id = book(db)
    const c2 = repo.createChapter(db, id, { title: 'Chapter 2' })
    repo.createChapter(db, id, { title: 'Chapter 1b', afterId: chapterId(db, 'Chapter 1') })
    repo.moveChapter(db, c2.id, 0)
    const o = repo.getOutline(db, id)
    expect(o.acts).toEqual([])
    expect(o.chapters.every((c) => c.actId === null)).toBe(true)
    expect(order(db)).toEqual(['Chapter 2', 'Chapter 1', 'Chapter 1b'])
  })
})

describe('acts', () => {
  it('are made in order, after the others or just after or before one, titled "Act N" when no title is given', () => {
    const db = memoryWorld()
    const id = book(db)
    const one = acts.createAct(db, id)
    const three = acts.createAct(db, id, { title: '  The   fall ', purpose: ' It all goes wrong. ' })
    acts.createAct(db, id, { title: 'Between', afterId: one.id })
    acts.createAct(db, id, { title: 'First', beforeId: one.id })
    expect(one.title).toBe('Act 1')
    expect(three).toMatchObject({ title: 'The fall', purpose: 'It all goes wrong.' })
    expect(acts.listActs(db, id).map((a) => [a.title, a.position])).toEqual([
      ['First', 0],
      ['Act 1', 1],
      ['Between', 2],
      ['The fall', 3]
    ])
    expect(() => acts.createAct(db, 'gone')).toThrow('That story no longer exists.')
  })

  it('are renamed, keeping the old title when the new one is blank', () => {
    const db = memoryWorld()
    const a = acts.createAct(db, book(db), { title: 'Arrival' })
    expect(acts.updateAct(db, a.id, { title: ' The  arrival ' }).title).toBe('The arrival')
    expect(acts.updateAct(db, a.id, { title: '  ' }).title).toBe('The arrival')
    expect(acts.updateAct(db, a.id, { purpose: ' Mara reaches the city. ' })).toMatchObject({
      title: 'The arrival',
      purpose: 'Mara reaches the city.'
    })
    expect(() => acts.updateAct(db, 'gone', { title: 'X' })).toThrow('That act no longer exists.')
  })

  it('keep the chapters written before the story had acts first, then each act’s chapters together', () => {
    const db = memoryWorld()
    const id = book(db)
    repo.createChapter(db, id, { title: 'Chapter 2' })
    const one = acts.createAct(db, id, { title: 'One' })
    const two = acts.createAct(db, id, { title: 'Two' })
    const a = repo.createChapter(db, id, { title: 'A' })
    acts.placeChapter(db, a.id, { actId: two.id })
    const b = repo.createChapter(db, id, { title: 'B' })
    acts.placeChapter(db, b.id, { actId: one.id })
    expect(shape(db)).toEqual(['-: Chapter 1, Chapter 2', 'One: B', 'Two: A'])
    expect(order(db)).toEqual(['Chapter 1', 'Chapter 2', 'B', 'A'])
    // Into an act, just before or after another chapter of it, or at an index among its chapters.
    acts.placeChapter(db, chapterId(db, 'Chapter 1'), { actId: one.id, beforeId: b.id })
    acts.placeChapter(db, chapterId(db, 'Chapter 2'), { actId: two.id, index: 0 })
    acts.placeChapter(db, b.id, { actId: two.id, afterId: a.id })
    expect(shape(db)).toEqual(['One: Chapter 1', 'Two: Chapter 2, A, B'])
    // Back among the chapters with no act.
    acts.placeChapter(db, a.id, { actId: null })
    expect(shape(db)).toEqual(['-: A', 'One: Chapter 1', 'Two: Chapter 2, B'])
    expectInOrder(db)
    // The scenes follow their chapters.
    const scenes = repo.getOutline(db, id).scenes
    expect(scenes.map((s) => s.title)).toEqual(['Scene 1'])
    expect(() => acts.placeChapter(db, a.id, { actId: 'gone' })).toThrow('That act no longer exists.')
  })

  it('reorder with the acts: their chapters move with them', () => {
    const db = memoryWorld()
    const id = book(db)
    const one = acts.createAct(db, id, { title: 'One' })
    acts.placeChapter(db, chapterId(db, 'Chapter 1'), { actId: one.id })
    const two = acts.createAct(db, id, { title: 'Two', beforeId: one.id })
    acts.placeChapter(db, repo.createChapter(db, id, { title: 'Chapter 2' }).id, { actId: two.id })
    expect(shape(db)).toEqual(['Two: Chapter 2', 'One: Chapter 1'])
    expect(order(db)).toEqual(['Chapter 2', 'Chapter 1'])
  })

  it('take a chapter added anywhere: after a chapter, into its act; with no place given, at the end of the last act', () => {
    const db = memoryWorld()
    const id = book(db)
    const one = acts.createAct(db, id, { title: 'One' })
    acts.createAct(db, id, { title: 'Two' })
    const x = repo.createChapter(db, id, { title: 'X' })
    expect(x.actId).toBe(acts.listActs(db, id)[1].id)
    const y = repo.createChapter(db, id, { title: 'Y' })
    acts.placeChapter(db, y.id, { actId: one.id })
    repo.createChapter(db, id, { title: 'After Y', afterId: y.id })
    repo.createChapter(db, id, { title: 'After 1', afterId: chapterId(db, 'Chapter 1') })
    expect(shape(db)).toEqual(['-: Chapter 1, After 1', 'One: Y, After Y', 'Two: X'])
    expectInOrder(db)
  })

  it('keep a chapter moved by its place in the whole story in its own act', () => {
    const db = memoryWorld()
    const id = book(db)
    const one = acts.createAct(db, id, { title: 'One' })
    const two = acts.createAct(db, id, { title: 'Two' })
    for (const [t, act] of [
      ['A', one],
      ['B', one],
      ['C', two],
      ['D', two]
    ] as const)
      acts.placeChapter(db, repo.createChapter(db, id, { title: t }).id, { actId: act.id })
    repo.moveChapter(db, chapterId(db, 'D'), 2)
    expect(shape(db)).toEqual(['-: Chapter 1', 'One: A, B', 'Two: D, C'])
    // Moving it among another act's chapters doesn't take it out of its own.
    repo.moveChapter(db, chapterId(db, 'D'), 0)
    expect(shape(db)).toEqual(['-: Chapter 1', 'One: A, B', 'Two: D, C'])
    expectInOrder(db)
  })

  it('say which act a chapter is in, and read every card’s goal and beats in one go', () => {
    const db = memoryWorld()
    const id = book(db)
    const one = acts.createAct(db, id)
    const c1 = chapterId(db, 'Chapter 1')
    expect(acts.actOfChapter(db, c1)).toBeNull()
    acts.placeChapter(db, c1, { actId: one.id })
    expect(acts.actOfChapter(db, c1)).toBe(one.id)
    const scene = repo.getOutline(db, id).scenes[0]
    repo.updateSceneCard(db, scene.id, { ...repo.getScene(db, scene.id).card, goal: 'Mara arrives.', beats: ['Rain', 'The door'] })
    const extra = repo.createScene(db, c1, { title: 'Broken' })
    db.prepare('UPDATE scenes SET card_json = ? WHERE id = ?').run('{not json', extra.id)
    const cards = acts.storyCards(db, id)
    expect(cards.get(scene.id)).toEqual({ goal: 'Mara arrives.', beats: ['Rain', 'The door'] })
    expect(cards.get(extra.id)).toEqual({ goal: '', beats: [] })
  })
})

describe('deleting an act', () => {
  function threeActs(db: Database.Database) {
    const id = book(db)
    const made = ['One', 'Two', 'Three'].map((title) => acts.createAct(db, id, { title }))
    const chapters: Record<string, ID> = {}
    for (const [title, i] of [
      ['A', 0],
      ['B', 1],
      ['C', 1],
      ['D', 2]
    ] as const) {
      const c = repo.createChapter(db, id, { title })
      acts.placeChapter(db, c.id, { actId: made[i].id })
      repo.createScene(db, c.id, { title: `${title} scene` })
      chapters[title] = c.id
    }
    return { id, made, chapters }
  }

  it('deletes it with its chapters and their scenes, and Undo brings exactly those back, where they were', () => {
    const db = memoryWorld()
    const { id, made, chapters } = threeActs(db)
    expect(shape(db)).toEqual(['-: Chapter 1', 'One: A', 'Two: B, C', 'Three: D'])
    const gone = acts.deleteAct(db, made[1].id)
    expect(gone.chapterIds).toEqual([chapters.B, chapters.C])
    expect(gone.sceneIds).toHaveLength(2)
    expect(shape(db)).toEqual(['-: Chapter 1', 'One: A', 'Three: D'])
    expect(repo.getOutline(db, id).scenes.map((s) => s.title)).toEqual(['Scene 1', 'A scene', 'D scene'])
    expect(() => acts.getAct(db, made[1].id)).toThrow('That act no longer exists.')
    // Something added in the meantime stays where it was put.
    acts.createAct(db, id, { title: 'Four' })
    acts.restoreAct(db, made[1].id)
    expect(shape(db)).toEqual(['-: Chapter 1', 'One: A', 'Two: B, C', 'Three: D', 'Four: '])
    expect(repo.getOutline(db, id).scenes.map((s) => s.title)).toEqual(['Scene 1', 'A scene', 'B scene', 'C scene', 'D scene'])
    expect(acts.listActs(db, id).map((a) => a.position)).toEqual([0, 1, 2, 3])
    expectInOrder(db)
  })

  it('leaves a chapter deleted before the act in Recently deleted when the act comes back', () => {
    const db = memoryWorld()
    const { made, chapters } = threeActs(db)
    repo.deleteChapter(db, chapters.B)
    db.prepare("UPDATE chapters SET deleted_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(chapters.B)
    db.prepare("UPDATE scenes SET deleted_at = '2020-01-01T00:00:00.000Z' WHERE chapter_id = ?").run(chapters.B)
    acts.deleteAct(db, made[1].id)
    acts.restoreAct(db, made[1].id)
    expect(shape(db)).toEqual(['-: Chapter 1', 'One: A', 'Two: C', 'Three: D'])
  })

  it('brings the act back when one of its chapters is restored from Recently deleted, with just that chapter', () => {
    const db = memoryWorld()
    const { made, chapters } = threeActs(db)
    acts.deleteAct(db, made[1].id)
    repo.restoreDeleted(db, 'chapter', chapters.C)
    expect(shape(db)).toEqual(['-: Chapter 1', 'One: A', 'Two: C', 'Three: D'])
    expectInOrder(db)
  })

  it('puts a restored chapter back in its act, even when chapters have moved since', () => {
    const db = memoryWorld()
    const { made, chapters } = threeActs(db)
    repo.deleteChapter(db, chapters.A)
    acts.placeChapter(db, chapters.D, { actId: made[0].id })
    acts.placeChapter(db, chapterId(db, 'Chapter 1'), { actId: made[2].id })
    repo.restoreDeleted(db, 'chapter', chapters.A)
    expect(shape(db)).toEqual(['One: D, A', 'Two: B, C', 'Three: Chapter 1'])
    expectInOrder(db)
  })

  it('waits in Recently deleted with the chapters and scenes deleted with it, and comes back from there', () => {
    const db = memoryWorld()
    const { id, made, chapters } = threeActs(db)
    repo.deleteChapter(db, chapters.A)
    acts.deleteAct(db, made[1].id)
    const empty = acts.createAct(db, id, { title: 'Empty' })
    acts.deleteAct(db, empty.id)
    const trash = repo.listDeleted(db)
    // B and C went with their act, so they are listed in it, not on their own; A went by itself.
    expect(trash.map((t) => [t.kind, t.title, t.chapterCount ?? null, t.sceneCount]).sort()).toEqual([
      ['act', 'Empty', 0, 0],
      ['act', 'Two', 2, 2],
      ['chapter', 'A', null, 1]
    ])
    expect(trash.find((t) => t.title === 'Two')).toMatchObject({ storyId: id, storyTitle: repo.getStory(db, id).title })
    acts.restoreAct(db, made[1].id)
    expect(shape(db)).toEqual(['-: Chapter 1', 'One: ', 'Two: B, C', 'Three: D'])
    expect(
      repo
        .listDeleted(db)
        .map((t) => [t.kind, t.title])
        .sort()
    ).toEqual([
      ['act', 'Empty'],
      ['chapter', 'A']
    ])
  })

  it('goes for good after 30 days in Recently deleted, with the chapters and scenes deleted with it', () => {
    const db = memoryWorld()
    const { id, made, chapters } = threeActs(db)
    acts.deleteAct(db, made[1].id)
    const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString()
    db.prepare('UPDATE acts SET deleted_at = ? WHERE id = ?').run(old, made[1].id)
    db.prepare('UPDATE chapters SET deleted_at = ? WHERE act_id = ?').run(old, made[1].id)
    db.prepare('UPDATE scenes SET deleted_at = ? WHERE chapter_id IN (?, ?)').run(old, chapters.B, chapters.C)
    // Deleted later: it stays for now.
    acts.deleteAct(db, made[2].id)
    expect(purgeTrash(db, 30)).toMatchObject({ chapters: 2, scenes: 2 })
    expect(db.prepare('SELECT id FROM acts WHERE story_id = ?').all(id)).toHaveLength(2)
    expect(repo.listDeleted(db).map((t) => [t.kind, t.title])).toEqual([['act', 'Three']])
    expect(() => acts.restoreAct(db, made[1].id)).toThrow('That act could not be found to restore.')
  })

  it('treats a chapter whose act is gone as having none', () => {
    const db = memoryWorld()
    const { id, made, chapters } = threeActs(db)
    db.prepare("UPDATE acts SET deleted_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(made[2].id)
    expect(repo.getOutline(db, id).chapters.find((c) => c.id === chapters.D)?.actId).toBeNull()
    acts.keepActsTogether(db, id)
    expect(shape(db)).toEqual(['-: Chapter 1, D', 'One: A', 'Two: B, C'])
    expectInOrder(db)
  })
})

describe('taking back what the outline helper kept', () => {
  function kept(db: Database.Database) {
    const id = book(db)
    const act = acts.createAct(db, id, { title: 'Kept act' })
    const chapter = repo.createChapter(db, id, { title: 'Kept chapter' })
    acts.placeChapter(db, chapter.id, { actId: act.id })
    const s1 = repo.createScene(db, chapter.id, { title: 'Kept 1' })
    const s2 = repo.createScene(db, chapter.id, { title: 'Kept 2' })
    for (const [kind, rowId] of [
      ['act', act.id],
      ['chapter', chapter.id],
      ['scene', s1.id],
      ['scene', s2.id]
    ] as const)
      acts.markMade(db, kind, rowId)
    return {
      id,
      items: [
        { kind: 'act' as const, id: act.id },
        { kind: 'chapter' as const, id: chapter.id },
        { kind: 'scene' as const, id: s1.id },
        { kind: 'scene' as const, id: s2.id }
      ],
      s1,
      s2,
      chapter
    }
  }
  const count = (db: Database.Database, table: string): number =>
    (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n

  it('removes what is still as it was made for good', () => {
    const db = memoryWorld()
    const { id, items, s1, s2 } = kept(db)
    const before = { acts: count(db, 'acts'), chapters: count(db, 'chapters'), scenes: count(db, 'scenes') }
    const out = acts.takeBackKept(db, items)
    expect(out).toEqual({ storyIds: [id], sceneIds: [s1.id, s2.id] })
    expect({ acts: count(db, 'acts'), chapters: count(db, 'chapters'), scenes: count(db, 'scenes') }).toEqual({
      acts: before.acts - 1,
      chapters: before.chapters - 1,
      scenes: before.scenes - 2
    })
    expect(shape(db)).toEqual(['-: Chapter 1'])
    expect(repo.listDeleted(db)).toEqual([])
  })

  it('sends anything with words in it, or changed since, to Recently deleted instead', () => {
    const db = memoryWorld()
    const { items, s1, chapter } = kept(db)
    repo.saveSceneText(db, s1.id, null, 'The rain had not let up.')
    acts.takeBackKept(db, items)
    const trash = repo.listDeleted(db)
    // The chapter holds a scene with words, so it waits in Recently deleted with it, in its act.
    expect(trash.map((t) => [t.kind, t.title, t.chapterCount, t.sceneCount])).toEqual([['act', 'Kept act', 1, 1]])
    repo.restoreDeleted(db, 'chapter', chapter.id)
    expect(shape(db)).toEqual(['-: Chapter 1', 'Kept act: Kept chapter'])
    expect(repo.getOutline(db, book(db)).scenes.map((s) => s.title)).toEqual(['Scene 1', 'Kept 1'])
  })

  it('counts a renamed chapter as changed', () => {
    const db = memoryWorld()
    const { items, chapter } = kept(db)
    repo.updateChapter(db, chapter.id, { title: 'Renamed' })
    acts.takeBackKept(db, items)
    expect(repo.listDeleted(db).map((t) => [t.kind, t.title, t.chapterCount])).toEqual([['act', 'Kept act', 1]])
  })

  it('skips what is already gone', () => {
    const db = memoryWorld()
    const { items, s1 } = kept(db)
    repo.deleteScene(db, s1.id)
    const out = acts.takeBackKept(db, items)
    expect(out.sceneIds).toHaveLength(1)
  })
})
