import { describe, expect, it } from 'vitest'
import type { FirstExists } from '@shared/contracts/entryViews'
import { asTheyWere, changedText, firstAppearsText, placeChoices, withPoint, withoutPoint } from './firstExistsLogic'

const point = (p: Partial<FirstExists> & Pick<FirstExists, 'kind' | 'label'>): FirstExists => ({
  id: p.label,
  entryId: 'mara',
  storyId: null,
  sceneId: null,
  byHand: false,
  homeStoryId: 'b1',
  ...p
})

const world = point({ kind: 'world', label: 'the beginning of the world' })
const b2 = point({ kind: 'story-pre', storyId: 'b2', label: 'the start of Book 2', byHand: true })
const sc = point({ kind: 'scene', storyId: 'b3', sceneId: 's9', label: 'Book 3, Ch 1, Sc 2' })

describe('where an entry first appears', () => {
  it('is one line in plain words', () => {
    expect(firstAppearsText([b2])).toBe('First appears: the start of Book 2')
    expect(firstAppearsText([world, b2, sc])).toBe('First appears: the beginning of the world, the start of Book 2 and Book 3, Ch 1, Sc 2')
    expect(firstAppearsText([])).toBeNull()
  })

  it('adds or removes a place, making every point Adam’s, and never leaves none', () => {
    expect(withPoint([world], { kind: 'scene', storyId: 'b3', sceneId: 's9' })).toEqual([
      { kind: 'world', storyId: null, sceneId: null, byHand: true },
      { kind: 'scene', storyId: 'b3', sceneId: 's9', byHand: true }
    ])
    // A story's start is one place, before or after its start-of-story changes.
    expect(withPoint([b2], { kind: 'story-post', storyId: 'b2', sceneId: null })).toBeNull()
    expect(withoutPoint([world, b2], world.id)).toEqual([{ kind: 'story-pre', storyId: 'b2', sceneId: null, byHand: true }])
    expect(withoutPoint([world], world.id)).toBeNull()
    expect(withoutPoint([world, b2], 'gone')).toBeNull()
    // Undo puts them back exactly, defaults included.
    expect(asTheyWere([world, b2]).map((p) => p.byHand)).toEqual([false, true])
  })

  it('offers the beginning of the world, each story’s start and scenes, leaving out what is chosen, matching what Adam types', () => {
    const stories = [
      { id: 'b1', title: 'Book 1' },
      { id: 'b2', title: '' }
    ]
    const scenes = [
      { id: 's1', storyId: 'b1', label: 'Book 1, Ch 1, Sc 1', title: 'The ferry' },
      { id: 's2', storyId: 'b1', label: 'Book 1, Ch 1, Sc 2' },
      { id: 's3', storyId: 'b1', label: 'Book 1, Ch 2, Sc 1' }
    ]
    expect(placeChoices(stories, scenes, [world], '').list.map((c) => c.label)).toEqual([
      'The start of Book 1',
      'The start of Untitled story',
      'Book 1, Ch 1, Sc 1',
      'Book 1, Ch 1, Sc 2',
      'Book 1, Ch 2, Sc 1'
    ])
    expect(placeChoices(stories, scenes, [], 'ferry').list.map((c) => [c.label, c.sub])).toEqual([['Book 1, Ch 1, Sc 1', 'The ferry']])
    expect(placeChoices(stories, scenes, [], 'ch 1 sc 2').list.map((c) => c.point)).toEqual([
      { kind: 'scene', storyId: 'b1', sceneId: 's2' }
    ])
    expect(placeChoices(stories, scenes, [], 'book 1', 2)).toMatchObject({ more: 2 })
    expect(placeChoices(stories, scenes, [], 'start of book 1').list[0].point).toEqual({ kind: 'story-pre', storyId: 'b1', sceneId: null })
  })

  it('says what changed in its toast', () => {
    expect(changedText('Mara', [b2])).toBe('Mara now first appears at the start of Book 2.')
    expect(changedText('Mara', [b2, sc])).toBe('Mara now first appears at the start of Book 2 and in Book 3, Ch 1, Sc 2.')
  })
})
