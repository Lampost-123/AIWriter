import { describe, expect, it } from 'vitest'
import type { AsOfStop } from '@shared/types'
import { hasOtherKinds, inSentence, longestLabel, nextChange, sameAsOf, stopForScene, stopIndex } from './asOfLogic'

const stop = (sceneId: string | null, changes = 0): AsOfStop => ({
  at: sceneId ? { kind: 'scene', storyId: 'b1', sceneId, seenIn: 'b1' } : { kind: 'start', storyId: 'b1', seenIn: 'b1' },
  label: sceneId ?? 'Start of Book 1',
  storyId: 'b1',
  sceneId,
  changes
})
const stops = [stop(null), stop('s1'), stop('s2', 2), stop('s3'), stop('s4', 1)]

describe('as-of sliders', () => {
  it('match points whatever story they are seen in', () => {
    expect(sameAsOf({ kind: 'scene', storyId: 'b1', sceneId: 's2' }, { kind: 'scene', storyId: 'b1', sceneId: 's2', seenIn: 'b3' })).toBe(true)
    expect(sameAsOf({ kind: 'start', storyId: 'b1' }, { kind: 'end', storyId: 'b1' })).toBe(false)
    expect(stopIndex(stops, { kind: 'scene', storyId: 'b1', sceneId: 's3' })).toBe(3)
    expect(stopIndex(stops, null)).toBe(-1)
  })

  it('jump between the places an entry changes', () => {
    expect(nextChange(stops, 0, 1)).toBe(2)
    expect(nextChange(stops, 2, 1)).toBe(4)
    expect(nextChange(stops, 4, 1)).toBeNull()
    expect(nextChange(stops, 4, -1)).toBe(2)
  })

  it('start at the scene Adam is in, or the end when it has no stop', () => {
    expect(stopForScene(stops, 's1')?.sceneId).toBe('s1')
    expect(stopForScene(stops, 'elsewhere')?.sceneId).toBe('s4')
    expect(stopForScene([], 's1')).toBeNull()
  })

  it('offer "As seen in" only once there is more than one kind of story', () => {
    expect(hasOtherKinds([{ kind: 'continues' }, { kind: 'continues' }])).toBe(false)
    expect(hasOtherKinds([{ kind: 'continues' }, { kind: 'side' }])).toBe(true)
  })

  it('put a point on the slider into a sentence', () => {
    // Each number keeps to its word: the spaces before them don't break.
    const plain = (s: string) => s.replaceAll('\u00a0', ' ')
    expect(plain(inSentence('Start of Book 1'))).toBe('the start of Book 1')
    expect(plain(inSentence('End of The Long Road'))).toBe('the end of The Long Road')
    expect(inSentence('Book 1, Ch 3, Sc 2')).toBe('Book\u00a01, Ch\u00a03, Sc\u00a02')
  })

  it('know the longest place on the slider', () => {
    expect(longestLabel(stops)).toBe('Start of Book 1')
    expect(longestLabel([])).toBe('')
  })
})
