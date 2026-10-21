// The memory keeper keeps each chapter's end-of-chapter snapshot in step with the record, with no AI (long story memory
// fix 15): worked out once, again only when what it rests on changes (its chapter or any scene before it), a few at a
// time, never for a rename; and gone with its chapter. Invented story (tests/unit/chapterWorld.ts).

import { describe, expect, it } from 'vitest'
import { chapterWorld, change, setCard } from '../../../tests/unit/chapterWorld'
import { saveParas } from '../../../tests/unit/keeperRead'
import * as repo from '../db/repo'
import { storedSnapshots } from '../db/snapshots'
import { purgeTrash } from '../db/trash'
import { refreshSnapshots, storiesReading } from './snapshots'
import { loadShape } from '../memory/scene'
import * as mem from '../db/memory'

describe('end-of-chapter snapshots, kept in step with the record', () => {
  it('works each chapter out once and keeps it in meta; again, nothing is worked out', () => {
    const w = chapterWorld()
    expect(refreshSnapshots(w.db, w.storyId, 10)).toMatchObject({ worked: w.chapters, more: false })
    const kept = storedSnapshots(w.db)
    expect([...kept.keys()].sort()).toEqual([...w.chapters].sort())
    expect(kept.get(w.chapters[1])!.snapshot!.sceneId).toBe(w.scenes[1][2])
    expect(refreshSnapshots(w.db, w.storyId, 10)).toMatchObject({ worked: [], more: false })
  })

  it('works out a few at a time, and says when more are left', () => {
    const w = chapterWorld()
    expect(refreshSnapshots(w.db, w.storyId, 2)).toMatchObject({ worked: w.chapters.slice(0, 2), more: true })
    expect(refreshSnapshots(w.db, w.storyId, 2)).toMatchObject({ worked: [w.chapters[2]], more: false })
  })

  it('works the next few out from the memory it was handed, not read again (review #26)', () => {
    const w = chapterWorld()
    const first = refreshSnapshots(w.db, w.storyId, 1)
    expect(first.read).not.toBeNull()
    const next = refreshSnapshots(w.db, w.storyId, 1, first.read)
    expect(next.worked).toEqual([w.chapters[1]])
    expect(next.read).toBe(first.read)
  })

  it('a change in one chapter works out that chapter again and every one after it, never one before it', () => {
    const w = chapterWorld()
    refreshSnapshots(w.db, w.storyId, 10)
    // In the last chapter: only it.
    change(w.db, w.ids.tobin, w.scenes[2][0], { kind: 'update', payload: { note: 'sang at the inn' } })
    expect(refreshSnapshots(w.db, w.storyId, 10).worked).toEqual([w.chapters[2]])
    // In chapter 2: it and chapter 3.
    change(w.db, w.ids.ash, w.scenes[1][0], { kind: 'update', payload: { note: 'hummed a tune' } })
    expect(refreshSnapshots(w.db, w.storyId, 10).worked).toEqual(w.chapters.slice(1))
    // In chapter 1, something that still holds later (a scar): every chapter from there on.
    change(w.db, w.ids.tobin, w.scenes[0][1], { kind: 'update', payload: { note: 'cut his cheek', fields: { marks: 'scar on his cheek' } } })
    expect(refreshSnapshots(w.db, w.storyId, 10).worked).toEqual(w.chapters)
    expect(storedSnapshots(w.db).get(w.chapters[2])!.snapshot!.people.find((p) => p.who === w.ids.tobin)!.looks).toEqual([
      'Distinguishing marks: scar on his cheek'
    ])
  })

  it('someone off every card in a chapter, given a thing there and relieved of it again, no longer has it in the next (review)', () => {
    const w = chapterWorld()
    const ivo = repo.createEntry(w.db, 'character', { name: 'Ivo' }).id
    const lamp = repo.createEntry(w.db, 'item', { name: 'The storm lamp' }).id
    // Ivo is in chapter 2's scenes only; in chapter 1 (off its cards) he is given the lamp.
    for (const id of w.scenes[1]) setCard(w.db, id, { presentIds: [w.ids.tobin, ivo] })
    change(w.db, ivo, w.scenes[0][0], { kind: 'relationship', payload: { otherId: lamp, type: 'holds', feels: '', otherFeels: '' } })
    refreshSnapshots(w.db, w.storyId, 10)
    const ivoIn = (chapter: number) => storedSnapshots(w.db).get(w.chapters[chapter])!.snapshot!.people.find((p) => p.who === ivo)
    expect(ivoIn(0)).toBeUndefined()
    expect(ivoIn(1)!.holds).toEqual([lamp])
    // Still in chapter 1, the lamp is taken from him: chapter 1 says nothing of him either way, but chapter 2 is worked
    // out again and he no longer has it there.
    change(w.db, ivo, w.scenes[0][1], { kind: 'relationship', payload: { otherId: lamp, type: 'formerly held', feels: '', otherFeels: '' } })
    expect(refreshSnapshots(w.db, w.storyId, 10).worked).toEqual(w.chapters)
    expect(ivoIn(0)).toBeUndefined()
    expect(ivoIn(1)?.holds).toBeUndefined()
  })

  it('a character made an item, or deleted, works the snapshots out again', () => {
    const w = chapterWorld()
    refreshSnapshots(w.db, w.storyId, 10)
    repo.deleteEntry(w.db, w.ids.edric)
    expect(refreshSnapshots(w.db, w.storyId, 10).worked).toEqual(w.chapters)
    expect(storedSnapshots(w.db).get(w.chapters[1])!.snapshot!.people.some((p) => p.who === w.ids.edric)).toBe(false)
  })

  it('a book’s record is read by the books that follow on from it, never by one before it', () => {
    const w = chapterWorld()
    const book2 = repo.createStory(w.db, { title: 'Book 2', startStoryId: w.storyId }).id
    const prequel = repo.createStory(w.db, { title: 'Before' }).id
    mem.setStoryPlacement(w.db, prequel, { kind: 'prequel', startStoryId: w.storyId, startAt: 'pre', startRefId: null, endAt: null, endRefId: null, leadsIntoId: null })
    const shape = loadShape(w.db)
    expect(storiesReading(shape, w.storyId)).toEqual([w.storyId, book2])
    expect(storiesReading(shape, book2)).toEqual([book2])
  })

  it('a card’s When, place or people, or new words read, work its chapter out again; a rename never does', () => {
    const w = chapterWorld()
    refreshSnapshots(w.db, w.storyId, 10)
    repo.updateEntry(w.db, w.ids.mara, { name: 'Mara Venn' })
    expect(refreshSnapshots(w.db, w.storyId, 10).worked).toEqual([])
    setCard(w.db, w.scenes[1][0], { when: 'Day 4, dusk' })
    expect(refreshSnapshots(w.db, w.storyId, 10).worked).toEqual(w.chapters.slice(1))
    expect(storedSnapshots(w.db).get(w.chapters[1])!.snapshot!.days).toBe('Day 4 to Day 5')
    setCard(w.db, w.scenes[2][1], { locationId: w.ids.quay })
    expect(refreshSnapshots(w.db, w.storyId, 10).worked).toEqual([w.chapters[2]])
    w.db.prepare('UPDATE scenes SET memory_version = memory_version + 1 WHERE id = ?').run(w.scenes[0][0])
    expect(refreshSnapshots(w.db, w.storyId, 10).worked[0]).toBe(w.chapters[0])
  })

  it('keeps a chapter with no words yet as none, and what comes before it reaches the chapters after it', () => {
    const w = chapterWorld()
    const empty = repo.createChapter(w.db, w.storyId, { afterId: w.chapters[1] }).id
    repo.createScene(w.db, empty)
    refreshSnapshots(w.db, w.storyId, 10)
    expect(storedSnapshots(w.db).get(empty)).toMatchObject({ snapshot: null })
    // Something new at the end of chapter 2 reaches chapter 3 through the empty chapter.
    change(w.db, w.ids.tobin, w.scenes[1][2], { kind: 'update', payload: { note: 'broke his arm', fields: { marks: 'arm in a sling' } } })
    expect(refreshSnapshots(w.db, w.storyId, 10).worked).toEqual([w.chapters[1], empty, w.chapters[2]])
    saveParas(w.db, repo.getOutline(w.db, w.storyId).scenes.find((s) => s.chapterId === empty)!.id, [['e1', 'The ferry waited at the steps.']], false)
    expect(refreshSnapshots(w.db, w.storyId, 10).worked[0]).toBe(empty)
  })

  it('goes with its chapter once that is gone for good, and stays while it is only in Recently deleted', () => {
    const w = chapterWorld()
    refreshSnapshots(w.db, w.storyId, 10)
    repo.deleteChapter(w.db, w.chapters[2])
    purgeTrash(w.db, 30)
    expect(storedSnapshots(w.db).has(w.chapters[2])).toBe(true)
    purgeTrash(w.db, 0, Date.now() + 1000)
    expect(storedSnapshots(w.db).has(w.chapters[2])).toBe(false)
    expect(storedSnapshots(w.db).has(w.chapters[1])).toBe(true)
  })
})
