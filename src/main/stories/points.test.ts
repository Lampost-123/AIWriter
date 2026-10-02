import { describe, expect, it } from 'vitest'
import * as repo from '../db/repo'
import { loadShape } from '../db/memory'
import { dbWorld, pureWorld } from '../../../tests/unit/testWorld'
import { deleteNotes, previewMove } from './points'

// In the test world Kell's Road runs during Book 1 from after Ch 1 until the end of Ch 2, and Mara Keeps
// Her Hand starts after Book 1, Ch 2, Sc 1. Book 1 has three chapters of two scenes each.

describe('moving a scene or chapter across where another story starts or ends', () => {
  const { shape } = pureWorld()

  it('says a story now includes a scene moved before where it starts', () => {
    const r = previewMove(shape, { kind: 'scene', id: 'b1.c2.s2', chapterId: 'b1.c2', index: 0 })
    expect(r.notes).toEqual(['This moved “Scene 2” before where Mara Keeps Her Hand starts, so that story now includes it.'])
    expect(r.from).toEqual({ chapterId: 'b1.c2', index: 1 })
  })

  it('says a story no longer includes a scene moved after where it starts', () => {
    const r = previewMove(shape, { kind: 'scene', id: 'b1.c1.s1', chapterId: 'b1.c2', index: 2 })
    expect(r.notes).toEqual([
      'This moved “Scene 1” after where Kell\'s Road starts, so that story no longer includes it.',
      'This moved “Scene 1” after where Mara Keeps Her Hand starts, so that story no longer includes it.'
    ])
  })

  it('says when a scene of the book moves across where a side story ends', () => {
    const r = previewMove(shape, { kind: 'scene', id: 'b1.c3.s1', chapterId: 'b1.c2', index: 0 })
    expect(r.notes).toEqual([
      'This moved “Scene 1” before where Kell\'s Road ends, so it no longer knows what happened in Kell\'s Road.',
      'This moved “Scene 1” before where Mara Keeps Her Hand starts, so that story now includes it.'
    ])
  })

  it('names a chapter that moved', () => {
    const r = previewMove(shape, { kind: 'chapter', id: 'b1.c3', index: 0 })
    expect(r.notes).toEqual([
      'This moved “Chapter 3” before where Kell\'s Road starts, so that story now includes it.',
      'This moved “Chapter 3” before where Kell\'s Road ends, so it no longer knows what happened in Kell\'s Road.',
      'This moved “Chapter 3” before where Mara Keeps Her Hand starts, so that story now includes it.'
    ])
    expect(r.from).toEqual({ chapterId: null, index: 2 })
  })

  it('counts the scenes when the chapter a story starts after moves', () => {
    const r = previewMove(shape, { kind: 'chapter', id: 'b1.c1', index: 2 })
    expect(r.notes).toContain("Kell's Road now includes 4 more scenes of Book 1.")
  })

  it('says nothing for a move no other story notices', () => {
    expect(previewMove(shape, { kind: 'scene', id: 'b1.c3.s2', chapterId: 'b1.c3', index: 0 }).notes).toEqual([])
    expect(previewMove(shape, { kind: 'scene', id: 'b3.c1.s1', chapterId: 'b3.c2', index: 0 }).notes).toEqual([])
    expect(previewMove(shape, { kind: 'scene', id: 'nowhere', chapterId: 'b1.c1', index: 0 }).notes).toEqual([])
  })
})

describe('deleting the chapter or scene a story starts or ends after', () => {
  const { shape } = pureWorld()

  it('says where the story starts instead', () => {
    expect(deleteNotes(shape, 'scene', 'b1.c2.s1')).toEqual([
      'Mara Keeps Her Hand now starts after Book 1, Ch 1, because the scene it started after was deleted.'
    ])
    expect(deleteNotes(shape, 'chapter', 'b1.c1')).toEqual([
      "Kell's Road now starts at the beginning of Book 1, because the chapter it started after was deleted."
    ])
  })

  it('says where a side story ends instead', () => {
    expect(deleteNotes(shape, 'chapter', 'b1.c2')).toEqual([
      "Kell's Road now ends after Book 1, Ch 1, because the chapter it ended after was deleted.",
      'Mara Keeps Her Hand now starts after Book 1, Ch 1, because the scene it started after was deleted.'
    ])
  })

  it('says nothing when no story starts or ends there', () => {
    expect(deleteNotes(shape, 'scene', 'b1.c3.s1')).toEqual([])
    expect(deleteNotes(shape, 'chapter', 'b3.c1')).toEqual([])
  })

  it('agrees with where the memory then has the story start', () => {
    const w = dbWorld()
    const note = deleteNotes(loadShape(w.db), 'scene', w.id('b1.c2.s2'))
    expect(note).toEqual([])
    repo.deleteScene(w.db, w.id('b1.c2.s1'))
    const keep = loadShape(w.db).stories.find((s) => s.id === w.id('keep'))!
    expect([keep.startAt, keep.startRefId]).toEqual(['chapter', w.id('b1.c1')])
    repo.deleteChapter(w.db, w.id('b1.c2'))
    const kr = loadShape(w.db).stories.find((s) => s.id === w.id('kr'))!
    expect([kr.endAt, kr.endRefId]).toEqual(['chapter', w.id('b1.c1')])
  })
})
