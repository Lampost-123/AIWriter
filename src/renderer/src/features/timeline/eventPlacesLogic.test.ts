// Put events in their place, on the timeline (2026-10-19): the offer's words, the ticks, and "Not now" remembered only
// for the events it was said to.
import { describe, expect, it } from 'vitest'
import type { EventHome } from '@shared/contracts/worldViews'
import { movedWords, offerWords, picked, readSkips, skipped, skipValue, WHY_WORDS } from './eventPlacesLogic'

const home = (entryId: string, why: EventHome['why'] = 'card'): EventHome => ({
  entryId,
  name: `Event ${entryId}`,
  storyId: 's',
  sceneId: 'sc',
  place: 'Ch 2, Sc 3 “The Wreck”',
  why
})

describe('the offer', () => {
  it('says how many can go, and how many went, in plain words', () => {
    expect(offerWords(12)).toBe('12 events from the World builder can go to the scenes they belong to.')
    expect(offerWords(1)).toBe('1 event from the World builder can go to the scene it belongs to.')
    expect(movedWords(12)).toBe('Moved 12 events to the scenes they happen in.')
    expect(movedWords(1)).toBe('Moved 1 event to the scene it happens in.')
    for (const words of Object.values(WHY_WORDS)) expect(words).not.toMatch(/entity|line|generation|LLM/i)
  })

  it('moves every event offered but those unticked', () => {
    expect(picked([home('a'), home('b'), home('c')], new Set(['b']))).toEqual(['a', 'c'])
  })

  it('stays hidden after Not now until another event can move', () => {
    const offer = [home('b'), home('a')]
    const saved = skipValue(offer)
    expect(saved).toBe('a,b')
    expect(skipped(saved, offer)).toBe(true)
    expect(skipped(saved, [home('a')])).toBe(true)
    expect(skipped(saved, [home('a'), home('c')])).toBe(false)
    expect(skipped(undefined, offer)).toBe(false)
  })

  it('reads what this computer kept, and nothing from what it can’t read', () => {
    expect(readSkips('{"w:s":"a,b","x":3}')).toEqual({ 'w:s': 'a,b' })
    expect(readSkips('not json')).toEqual({})
    expect(readSkips(null)).toEqual({})
    expect(readSkips('[1]')).toEqual({})
  })
})
