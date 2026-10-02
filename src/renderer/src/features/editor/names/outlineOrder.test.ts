import { describe, expect, it } from 'vitest'
import type { Chapter, Outline, SceneMeta, Story } from '@shared/types'
import { outlineOrder } from './outlineOrder'

const story = { id: 'b1', title: 'Book 1' } as Story
const chapter = (id: string, position: number): Chapter => ({ id, storyId: 'b1', title: id, goal: '', position, actId: null })
const scene = (id: string, chapterId: string, position: number, wordCount = 0): SceneMeta => ({
  id,
  chapterId,
  title: id,
  position,
  status: 'drafted',
  wordCount,
  updatedAt: '',
  acceptedAt: null,
  memoryState: 'current'
})

const outline = (scenes: SceneMeta[], chapters = [chapter('c1', 0), chapter('c2', 1)]): Outline => ({ story, chapters, scenes })

describe('the outline order a scene’s names depend on', () => {
  const base = outline([scene('s1', 'c1', 0), scene('s2', 'c1', 1), scene('s3', 'c2', 0)])

  it('stays the same while Adam writes: word counts, statuses and titles don’t change it', () => {
    const typed = outline([scene('s1', 'c1', 0, 1200), { ...scene('s2', 'c1', 1), status: 'done', title: 'Renamed' }, scene('s3', 'c2', 0)])
    expect(outlineOrder(typed)).toBe(outlineOrder(base))
  })

  it('changes when a scene or chapter moves, or one is added or deleted', () => {
    const moved = outline([scene('s2', 'c1', 0), scene('s1', 'c1', 1), scene('s3', 'c2', 0)])
    const across = outline([scene('s1', 'c1', 0), scene('s3', 'c1', 1), scene('s2', 'c2', 0)])
    const chapters = outline([scene('s3', 'c2', 0), scene('s1', 'c1', 0), scene('s2', 'c1', 1)], [chapter('c2', 0), chapter('c1', 1)])
    const added = outline([...base.scenes, scene('s4', 'c2', 1)])
    const deleted = outline(base.scenes.slice(1))
    const orders = [base, moved, across, chapters, added, deleted].map(outlineOrder)
    expect(new Set(orders).size).toBe(orders.length)
  })

  it('is empty without an outline', () => {
    expect(outlineOrder(null)).toBe('')
  })
})
