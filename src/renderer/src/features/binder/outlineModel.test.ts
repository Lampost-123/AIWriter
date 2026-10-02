import { describe, expect, it } from 'vitest'
import type { Act, Chapter, Outline, SceneMeta, Story } from '@shared/types'
import {
  actOf,
  applyTreeOrder,
  arrayMove,
  chapterRuns,
  findChapterOf,
  formatWords,
  groupOutline,
  moveSceneTo,
  moveToActPlace,
  neighbourAfterRemoval,
  placeChapterIn,
  readingOrder,
  scenePlace,
  shownOrder,
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
  memoryState: 'current',
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

describe('acts', () => {
  const act = (id: string, position: number): Act => ({ id, storyId: 'st', title: id.toUpperCase(), purpose: '', position })
  const inAct = (c: Chapter, actId: string | null): Chapter => ({ ...c, actId })
  // Chapter "a" has no act; "b" and "c" are in act one, "d" in act two. Act three has none yet.
  const withActs: Outline = {
    story,
    chapters: [chapter('a', 0), inAct(chapter('b', 1), 'one'), inAct(chapter('c', 2), 'one'), inAct(chapter('d', 3), 'two')],
    scenes: [],
    acts: [act('one', 0), act('two', 1), act('three', 2)]
  }
  const runs = (o: Outline): string[] =>
    chapterRuns(
      o,
      o.chapters.map((c) => c.id)
    ).map((r) => `${r.act?.id ?? '-'}: ${r.chapters.join(' ')}`)

  it('shows a story without acts as it always was: one run of chapters', () => {
    expect(runs(outline)).toEqual(['-: a b c'])
    expect(runs({ ...outline, acts: [] })).toEqual(['-: a b c'])
  })

  it('groups chapters under their acts, the chapters with no act first', () => {
    expect(runs(withActs)).toEqual(['-: a', 'one: b c', 'two: d', 'three: '])
    expect(shownOrder(withActs, ['d', 'c', 'a', 'b'])).toEqual(['a', 'c', 'b', 'd'])
    // A chapter whose act is gone counts as having none.
    expect(runs({ ...withActs, acts: [act('one', 0), act('three', 2)] })).toEqual(['-: a d', 'one: b c', 'three: '])
    expect(actOf(withActs, 'c')).toBe('one')
    expect(actOf(withActs, 'a')).toBeNull()
  })

  it('moves a chapter to a later act’s start or an earlier act’s end', () => {
    expect(moveToActPlace(withActs, 'b', 'two')).toEqual({ actId: 'two', index: 0 })
    expect(moveToActPlace(withActs, 'a', 'one')).toEqual({ actId: 'one', index: 0 })
    expect(moveToActPlace(withActs, 'd', 'one')).toEqual({ actId: 'one' })
    expect(moveToActPlace(withActs, 'b', 'one')).toBeNull()
    expect(moveToActPlace(withActs, 'b', 'gone')).toBeNull()
  })

  it('places a chapter as the server will, with fresh positions', () => {
    const show = (o: Outline): string => o.chapters.map((c) => `${c.id}${c.position}@${c.actId ?? '-'}`).join(' ')
    expect(show(placeChapterIn(withActs, 'd', { actId: 'one' }))).toBe('a0@- b1@one c2@one d3@one')
    expect(show(placeChapterIn(withActs, 'a', { actId: 'three' }))).toBe('b0@one c1@one d2@two a3@three')
    expect(show(placeChapterIn(withActs, 'c', { actId: 'one', beforeId: 'b' }))).toBe('a0@- c1@one b2@one d3@two')
    expect(show(placeChapterIn(withActs, 'b', { actId: 'two', afterId: 'd' }))).toBe('a0@- c1@one d2@two b3@two')
    expect(show(placeChapterIn(withActs, 'd', { actId: 'one', index: 1 }))).toBe('a0@- b1@one d2@one c3@one')
    expect(show(placeChapterIn(withActs, 'c', { actId: null }))).toBe('a0@- c1@- b2@one d3@two')
    expect(show(placeChapterIn({ ...withActs, chapters: withActs.chapters.slice(1) }, 'd', { actId: null }))).toBe('d0@- b1@one c2@one')
    expect(placeChapterIn(withActs, 'd', { actId: 'gone' })).toBe(withActs)
    expect(placeChapterIn(withActs, 'missing', { actId: 'one' })).toBe(withActs)
  })
})
