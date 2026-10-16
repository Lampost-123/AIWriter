// The memory keeper keeps each chapter's end-of-chapter snapshot in step with the record, with no AI (long story memory
// fix 15): worked out once, again only when what it rests on changes (and only as far forward as how things stand
// changes), a few at a time, never for a rename; and gone with its chapter. Invented story (tests/unit/chapterWorld.ts).

import { describe, expect, it } from 'vitest'
import { chapterWorld, change, setCard } from '../../../tests/unit/chapterWorld'
import { saveParas } from '../../../tests/unit/keeperRead'
import * as repo from '../db/repo'
import { storedSnapshots } from '../db/snapshots'
import { purgeTrash } from '../db/trash'
import { refreshSnapshots } from './snapshots'

describe('end-of-chapter snapshots, kept in step with the record', () => {
  it('works each chapter out once and keeps it in meta; again, nothing is worked out', () => {
    const w = chapterWorld()
    expect(refreshSnapshots(w.db, w.storyId, 10)).toEqual({ worked: w.chapters, more: false })
    const kept = storedSnapshots(w.db)
    expect([...kept.keys()].sort()).toEqual([...w.chapters].sort())
    expect(kept.get(w.chapters[1])!.snapshot!.sceneId).toBe(w.scenes[1][2])
    expect(refreshSnapshots(w.db, w.storyId, 10)).toEqual({ worked: [], more: false })
  })

  it('works out a few at a time, and says when more are left', () => {
    const w = chapterWorld()
    expect(refreshSnapshots(w.db, w.storyId, 2)).toEqual({ worked: w.chapters.slice(0, 2), more: true })
    expect(refreshSnapshots(w.db, w.storyId, 2)).toEqual({ worked: [w.chapters[2]], more: false })
  })

  it('a change in one chapter works out that chapter again, and later ones only where how things stand changed', () => {
    const w = chapterWorld()
    refreshSnapshots(w.db, w.storyId, 10)
    // In the last chapter: only it.
    change(w.db, w.ids.tobin, w.scenes[2][0], { kind: 'update', payload: { note: 'sang at the inn' } })
    expect(refreshSnapshots(w.db, w.storyId, 10).worked).toEqual([w.chapters[2]])
    // In chapter 2, a note on someone with nothing to say at its end: chapter 2 only.
    change(w.db, w.ids.ash, w.scenes[1][0], { kind: 'update', payload: { note: 'hummed a tune' } })
    expect(refreshSnapshots(w.db, w.storyId, 10).worked).toEqual([w.chapters[1]])
    // In chapter 1, something that still holds later (a scar): every chapter from there on.
    change(w.db, w.ids.tobin, w.scenes[0][1], { kind: 'update', payload: { note: 'cut his cheek', fields: { marks: 'scar on his cheek' } } })
    expect(refreshSnapshots(w.db, w.storyId, 10).worked).toEqual(w.chapters)
    expect(storedSnapshots(w.db).get(w.chapters[2])!.snapshot!.people.find((p) => p.who === w.ids.tobin)!.looks).toEqual([
      'Distinguishing marks: scar on his cheek'
    ])
  })

  it('a card’s When, place or people, or new words read, work its chapter out again; a rename never does', () => {
    const w = chapterWorld()
    refreshSnapshots(w.db, w.storyId, 10)
    repo.updateEntry(w.db, w.ids.mara, { name: 'Mara Venn' })
    expect(refreshSnapshots(w.db, w.storyId, 10).worked).toEqual([])
    setCard(w.db, w.scenes[1][0], { when: 'Day 4, dusk' })
    expect(refreshSnapshots(w.db, w.storyId, 10).worked).toEqual([w.chapters[1]])
    expect(storedSnapshots(w.db).get(w.chapters[1])!.snapshot!.days).toBe('Day 4 to Day 5')
    setCard(w.db, w.scenes[2][1], { locationId: w.ids.quay })
    expect(refreshSnapshots(w.db, w.storyId, 10).worked).toEqual([w.chapters[2]])
    w.db.prepare('UPDATE scenes SET memory_version = memory_version + 1 WHERE id = ?').run(w.scenes[0][0])
    expect(refreshSnapshots(w.db, w.storyId, 10).worked[0]).toBe(w.chapters[0])
  })

  it('keeps a chapter with no words yet as none, and passes the chapter before’s end on past it', () => {
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
