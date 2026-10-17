import { describe, expect, it } from 'vitest'
import * as repo from '../db/repo'
import { memoryWorld } from '../../../tests/unit/helpers'
import { noteStoryRecipe, storyRecipe } from './storyRecipe'

describe('which recipe a story was planned from', () => {
  it('remembers each story’s recipe, so any keep can start its build with the recipe’s roles', () => {
    const db = memoryWorld()
    expect(storyRecipe(db, 's1')).toBeNull()
    noteStoryRecipe(db, 's1', 'r1')
    noteStoryRecipe(db, 's2', 'r2')
    noteStoryRecipe(db, 's1', 'r3')
    expect(storyRecipe(db, 's1')).toBe('r3')
    expect(storyRecipe(db, 's2')).toBe('r2')
  })

  it('reads nothing from a broken note', () => {
    const db = memoryWorld()
    repo.setMeta(db, 'story_recipes', 'not json')
    expect(storyRecipe(db, 's1')).toBeNull()
    noteStoryRecipe(db, 's1', 'r1')
    expect(storyRecipe(db, 's1')).toBe('r1')
  })
})
