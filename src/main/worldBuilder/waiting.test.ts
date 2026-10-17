import { describe, expect, it } from 'vitest'
import * as repo from '../db/repo'
import { memoryWorld } from '../../../tests/unit/helpers'
import { keepWaiting, readWaiting, WAITING_KEY } from './waiting'

describe('stories waiting for their world to be built, kept in the world (2026-10-17)', () => {
  it('keeps the waiting stories, so they are there when the world next opens', () => {
    const db = memoryWorld()
    const book = repo.listStories(db)[0]
    const two = repo.createStory(db, { title: 'The Salt Road' })
    keepWaiting(db, [{ storyId: book.id, recipeId: null }, { storyId: two.id, recipeId: 'recipe-1' }])
    expect(readWaiting(db)).toEqual([
      { storyId: book.id, recipeId: null },
      { storyId: two.id, recipeId: 'recipe-1' }
    ])
    keepWaiting(db, [])
    expect(readWaiting(db)).toEqual([])
  })

  it('never keeps or gives back a story that isn’t in this world', () => {
    const db = memoryWorld()
    const book = repo.listStories(db)[0]
    keepWaiting(db, [{ storyId: 'another-worlds-story', recipeId: null }, { storyId: book.id }, { storyId: book.id }, 'junk'])
    expect(readWaiting(db)).toEqual([{ storyId: book.id, recipeId: null }])
    repo.setMeta(db, WAITING_KEY, '{not json')
    expect(readWaiting(db)).toEqual([])
    repo.setMeta(db, WAITING_KEY, JSON.stringify([{ storyId: 'gone', recipeId: null }]))
    expect(readWaiting(db)).toEqual([])
  })
})
