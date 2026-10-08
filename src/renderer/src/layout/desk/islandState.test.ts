import { describe, expect, it } from 'vitest'
import { changesText, islandState, wordsText, type IslandInput } from './islandState'

const base: IslandInput = { saveState: 'saved', onPage: true, sceneWords: 1167, draft: null, memory: null, daily: null, typedToday: 0 }

describe('the desk’s status island', () => {
  it('says Saved with the scene’s words while all is well', () => {
    expect(islandState(base)).toMatchObject({ shows: 'saved', words: 1167, goalShare: null, goalPercent: null })
    // Before anything has been saved since the scene opened, the scene is saved all the same.
    expect(islandState({ ...base, saveState: 'idle' }).shows).toBe('saved')
    // Off the writing page, no scene words.
    expect(islandState({ ...base, onPage: false }).words).toBeNull()
  })

  it('morphs Saved → Writing → Saved as a draft writes into the scene', () => {
    const writing = islandState({ ...base, draft: { here: true, written: 212 } })
    expect(writing).toMatchObject({ shows: 'writing', written: 212 })
    // A draft writing into another scene: Writing…, with no count from this page.
    expect(islandState({ ...base, draft: { here: false, written: 50 } })).toMatchObject({ shows: 'writing', written: null })
    expect(islandState({ ...base, draft: { here: true, written: -3 } }).written).toBe(0)
    expect(islandState(base).shows).toBe('saved')
  })

  it('shows the memory’s news for a moment, after a draft and before saving', () => {
    expect(islandState({ ...base, memory: { changes: 2 } })).toMatchObject({ shows: 'memory', changes: 2 })
    expect(islandState({ ...base, memory: { changes: 2 }, draft: { here: true, written: 4 } }).shows).toBe('writing')
    expect(islandState({ ...base, memory: { changes: 2 }, saveState: 'saving' }).shows).toBe('memory')
  })

  it('puts save trouble first, and says Saving… only on the writing page', () => {
    expect(islandState({ ...base, saveState: 'error', draft: { here: true, written: 1 } }).shows).toBe('unsaved')
    expect(islandState({ ...base, saveState: 'saving' }).shows).toBe('saving')
    expect(islandState({ ...base, saveState: 'saving', onPage: false }).shows).toBe('saved')
  })

  it('fills today’s ring toward the daily target, capped at full', () => {
    expect(islandState({ ...base, daily: 1000, typedToday: 120 })).toMatchObject({ goalShare: 0.12, goalPercent: 12 })
    expect(islandState({ ...base, daily: 500, typedToday: 750 })).toMatchObject({ goalShare: 1, goalPercent: 150 })
    expect(islandState({ ...base, daily: 500, typedToday: -20 }).goalShare).toBe(0)
    expect(islandState({ ...base, daily: 0, typedToday: 20 }).goalShare).toBeNull()
  })

  it('words its counts', () => {
    expect(wordsText(1)).toBe('1 word')
    expect(wordsText(1167)).toBe('1,167 words')
    expect(changesText(1)).toBe('1 change')
    expect(changesText(18)).toBe('18 changes')
  })
})
