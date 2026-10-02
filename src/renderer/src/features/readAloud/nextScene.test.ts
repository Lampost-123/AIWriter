import { describe, expect, it } from 'vitest'
import type { SceneMeta } from '@shared/types'
import { sceneAfter } from './nextScene'

const scene = (id: string, chapterId: string, position: number, wordCount = 100): SceneMeta => ({
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

const outline = {
  chapters: [
    { id: 'c2', position: 2 },
    { id: 'c1', position: 1 }
  ],
  scenes: [scene('b1', 'c2', 1), scene('a2', 'c1', 2), scene('a1', 'c1', 1), scene('a3', 'c1', 3, 0)]
}

describe('keep reading', () => {
  it('carries on into the next scene, across chapters, passing over scenes with no words', () => {
    expect(sceneAfter(outline, 'a1')?.id).toBe('a2')
    expect(sceneAfter(outline, 'a2')?.id).toBe('b1')
  })

  it('stops at the end of the story', () => {
    expect(sceneAfter(outline, 'b1')).toBeNull()
    expect(sceneAfter(outline, 'gone')).toBeNull()
  })
})
