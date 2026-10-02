import { describe, expect, it } from 'vitest'
import { defaultSize, fitSize, MOST_SCENES, SIZE_CHOICES } from './size'

describe('how much the outline helper suggests', () => {
  it('starts with a whole story for an empty one, and a few chapters more for one under way', () => {
    expect(defaultSize(0, 0)).toEqual({ acts: 3, chapters: 9, scenes: 3 })
    expect(defaultSize(4, 2)).toEqual({ acts: 1, chapters: 3, scenes: 3 })
    expect(defaultSize(4, 0)).toEqual({ acts: 0, chapters: 3, scenes: 3 })
  })

  it('offers what the main process allows', () => {
    expect(SIZE_CHOICES.acts[0]).toBe(0)
    expect(SIZE_CHOICES.acts.at(-1)).toBe(6)
    expect(SIZE_CHOICES.chapters).toHaveLength(30)
    expect(SIZE_CHOICES.scenes).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('keeps a chapter for each act, moving the number that was not just chosen', () => {
    expect(fitSize({ acts: 2, chapters: 3, scenes: 2 }, { acts: 5 })).toEqual({ acts: 5, chapters: 5, scenes: 2 })
    expect(fitSize({ acts: 3, chapters: 9, scenes: 2 }, { chapters: 2 })).toEqual({ acts: 2, chapters: 2, scenes: 2 })
    expect(fitSize({ acts: 3, chapters: 9, scenes: 2 }, { scenes: 6 })).toEqual({ acts: 3, chapters: 9, scenes: 6 })
  })

  it('never asks for more scene cards than one answer can hold, moving the number that was not just chosen', () => {
    expect(fitSize({ acts: 3, chapters: 20, scenes: 3 }, { scenes: 6 })).toEqual({ acts: 3, chapters: 16, scenes: 6 })
    expect(fitSize({ acts: 6, chapters: 9, scenes: 6 }, { chapters: 30 })).toEqual({ acts: 6, chapters: 30, scenes: 3 })
    expect(fitSize({ acts: 3, chapters: 25, scenes: 4 }, { acts: 2 })).toEqual({ acts: 2, chapters: 25, scenes: 4 })
    for (const acts of SIZE_CHOICES.acts)
      for (const chapters of SIZE_CHOICES.chapters)
        for (const scenes of SIZE_CHOICES.scenes) {
          const size = fitSize({ acts: 3, chapters: 9, scenes: 3 }, { acts, chapters, scenes })
          expect(size.chapters * size.scenes).toBeLessThanOrEqual(MOST_SCENES)
          expect(size.acts).toBeLessThanOrEqual(size.chapters)
        }
  })

  it('keeps each number within its choices', () => {
    expect(fitSize({ acts: 3, chapters: 9, scenes: 3 }, { chapters: 99, scenes: 0, acts: -1 })).toEqual({
      acts: 0,
      chapters: 30,
      scenes: 1
    })
  })
})
