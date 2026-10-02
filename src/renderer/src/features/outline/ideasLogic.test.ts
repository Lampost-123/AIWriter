import { describe, expect, it } from 'vitest'
import { emptySceneCard } from '@shared/defaults'
import { cardIsEmpty, isPlainTitle } from './ideasLogic'

describe('next scene ideas', () => {
  it('are offered on a card with nothing yet on what happens, whoever is in the scene', () => {
    expect(cardIsEmpty(emptySceneCard())).toBe(true)
    expect(
      cardIsEmpty({ ...emptySceneCard(), povId: 'mara', presentIds: ['mara', 'tobin'], when: 'Dusk', mood: 'Tense', beats: ['  '] })
    ).toBe(true)
    expect(cardIsEmpty({ ...emptySceneCard(), beats: ['Mara lands'] })).toBe(false)
    expect(cardIsEmpty({ ...emptySceneCard(), goal: 'Escape' })).toBe(false)
    expect(cardIsEmpty({ ...emptySceneCard(), outcome: 'She is caught' })).toBe(false)
    expect(cardIsEmpty({ ...emptySceneCard(), notes: 'Callback to the ferry' })).toBe(false)
  })

  it('name a scene only while it has the title it was made with', () => {
    expect(isPlainTitle('Scene 3')).toBe(true)
    expect(isPlainTitle('scene')).toBe(true)
    expect(isPlainTitle('Untitled scene')).toBe(true)
    expect(isPlainTitle('')).toBe(true)
    expect(isPlainTitle('The docks')).toBe(false)
    expect(isPlainTitle('Scene at the docks')).toBe(false)
  })
})
