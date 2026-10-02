import { describe, expect, it } from 'vitest'
import type { Chapter, Outline, SceneMeta, Story } from '@shared/types'
import {
  applyTreeOrder,
  arrayMove,
  findChapterOf,
  formatWords,
  groupOutline,
  moveSceneTo,
  neighbourAfterRemoval,
  readingOrder,
  scenePlace,
  siblings,
  treeOrder
} from './outlineModel'

const story = { id: 'st', title: 'Book 1' } as Story
const chapter = (id: string, position: number): Chapter => ({ id, storyId: 'st', title: id.toUpperCase(), goal: '', position, actId: null })
const scene = (id: string, chapterId: string, position: number, wordCount = 0): SceneMeta => ({
  id,
  chapterId,
  title: id,
  position,
  status: 'planned',
  acceptedAt: null,
  wordCount,
  updatedAt: ''
})

// Chapter "a" holds s1, s2; chapter "b" holds s3; chapter "c" is empty. Scenes are deliberately out of order.
const outline: Outline = {
  story,
  chapters: [chapter('a', 0), chapter('b', 1), chapter('c', 2)],
  scenes: [scene('s2', 'a', 1, 200), scene('s3', 'b', 0, 50), scene('s1', 'a', 0, 100)]
}

describe('grouping and order', () => {
  it('groups scenes under chapters in position order with word totals', () => {
    const g = groupOutline(outline)
    expect(g.map((x) => [x.chapter.id, x.scenes.map((s) => s.id), x.words])).toEqual([
      ['a', ['s1', 's2'], 300],
      ['b', ['s3'], 50],
      ['c', [], 0]
    ])
  })

  it('lists scenes in reading order', () => {
    expect(readingOrder(outline)).toEqual(['s1', 's2', 's3'])
    expect(siblings(['s1', 's2', 's3'], 's2')).toEqual({ prev: 's1', next: 's3' })
    expect(siblings(['s1'], 's1')).toEqual({ prev: null, next: null })
  })

  it('formats word counts, blank for none', () => {
    expect(formatWords(0)).toBe('')
    expect(formatWords(12345)).toBe('12,345')
  })
})

describe('neighbourAfterRemoval', () => {
  const order = ['s1', 's2', 's3', 's4']
  it('keeps the open scene when another is removed', () => {
    expect(neighbourAfterRemoval(order, ['s3'], 's1')).toBe('s1')
  })
  it('opens the next scene, else the previous one', () => {
    expect(neighbourAfterRemoval(order, ['s2'], 's2')).toBe('s3')
    expect(neighbourAfterRemoval(order, ['s4'], 's4')).toBe('s3')
  })
  it('skips every scene removed with a chapter', () => {
    expect(neighbourAfterRemoval(order, ['s2', 's3'], 's2')).toBe('s4')
    expect(neighbourAfterRemoval(order, ['s3', 's4'], 's3')).toBe('s2')
  })
  it('returns null when nothing is left', () => {
    expect(neighbourAfterRemoval(['s1'], ['s1'], 's1')).toBeNull()
  })
})

describe('drag and drop bookkeeping', () => {
  const order = treeOrder(outline)

  it('builds containers per chapter', () => {
    expect(order).toEqual({ chapters: ['a', 'b', 'c'], scenes: { a: ['s1', 's2'], b: ['s3'], c: [] } })
    expect(findChapterOf(order.scenes, 's3')).toBe('b')
  })

  it('moves a scene within its chapter', () => {
    const next = moveSceneTo(order.scenes, 's1', 'a', 1)
    expect(next.a).toEqual(['s2', 's1'])
    expect(scenePlace(next, 's1')).toEqual({ chapterId: 'a', index: 1 })
  })

  it('moves a scene to another chapter, including an empty one', () => {
    const toB = moveSceneTo(order.scenes, 's2', 'b', 0)
    expect(toB).toMatchObject({ a: ['s1'], b: ['s2', 's3'] })
    const toC = moveSceneTo(order.scenes, 's1', 'c', 5)
    expect(toC).toMatchObject({ a: ['s2'], c: ['s1'] })
    expect(scenePlace(toC, 's1')).toEqual({ chapterId: 'c', index: 0 })
  })

  it('leaves the input untouched when nothing moves', () => {
    expect(moveSceneTo(order.scenes, 's1', 'a', 0)).toBe(order.scenes)
    expect(moveSceneTo(order.scenes, 'missing', 'a', 0)).toBe(order.scenes)
  })

  it('applies a new order to the outline with fresh positions', () => {
    const next = applyTreeOrder(outline, { chapters: arrayMove(order.chapters, 2, 0), scenes: moveSceneTo(order.scenes, 's3', 'a', 1) })
    expect(next.chapters.map((c) => [c.id, c.position])).toEqual([
      ['c', 0],
      ['a', 1],
      ['b', 2]
    ])
    expect(groupOutline(next).map((g) => g.scenes.map((s) => `${s.id}@${s.chapterId}:${s.position}`))).toEqual([
      [],
      ['s1@a:0', 's3@a:1', 's2@a:2'],
      []
    ])
  })
})
