import { describe, expect, it } from 'vitest'
import { createLeaveTracker, type WritingState } from './leaving'

const at = (sceneId: string | null, worldId = 'w1', drafting: string | null = null): WritingState => ({
  here: sceneId ? { sceneId, worldId } : null,
  worldId,
  drafting
})

describe('createLeaveTracker', () => {
  it('reads the scene Adam leaves for another scene, or for another page', () => {
    const track = createLeaveTracker()
    expect(track(at('a'))).toEqual([])
    expect(track(at('b'))).toEqual([{ sceneId: 'a', worldId: 'w1' }])
    expect(track(at(null))).toEqual([{ sceneId: 'b', worldId: 'w1' }])
    // Back to writing in the same scene: nothing was left.
    expect(track(at('b'))).toEqual([])
    expect(track(at('b'))).toEqual([])
  })

  it('does nothing when the world changes (that world reads its scenes when it next opens)', () => {
    const track = createLeaveTracker()
    track(at('a', 'w1'))
    expect(track(at('x', 'w2'))).toEqual([])
  })

  it('reads a scene left while a draft was being written into it once that draft ends', () => {
    const track = createLeaveTracker()
    track(at('a', 'w1', 'a'))
    // Opening another scene stops the draft: nothing yet while it is still winding down.
    expect(track(at('b', 'w1', 'a'))).toEqual([])
    expect(track(at('b', 'w1', null))).toEqual([{ sceneId: 'a', worldId: 'w1' }])
    expect(track(at('b', 'w1', null))).toEqual([])
  })

  it('a draft finishing while another page is open reads its scene then', () => {
    const track = createLeaveTracker()
    track(at('a', 'w1', 'a'))
    expect(track(at(null, 'w1', 'a'))).toEqual([])
    expect(track(at(null, 'w1', null))).toEqual([{ sceneId: 'a', worldId: 'w1' }])
  })

  it('no read when Adam is back in the scene before its draft ends', () => {
    const track = createLeaveTracker()
    track(at('a', 'w1', 'a'))
    track(at(null, 'w1', 'a'))
    expect(track(at('a', 'w1', 'a'))).toEqual([])
    expect(track(at('a', 'w1', null))).toEqual([])
  })
})
