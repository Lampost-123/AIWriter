// Chapter cards in the outline helper's replies (2026-10-08): "Point of view:", "Characters:", "Location:", "When:" and
// "Mood:" under a chapter fill its card; under a scene, they are where the scene differs from its chapter.
import { describe, expect, it } from 'vitest'
import { parseOutline } from './parse'
import { cardNames, keepPlan, outlineTree } from './tree'
import { outlineReply } from '../../../../../tests/fake-provider/m4/outline.mjs'

const REPLY = `## Chapter: The Lamp
Goal: Wren keeps the light burning through the storm.
Point of view: Wren
Characters: Wren, Odo and Old Bren
Location: The Lamp Tower
When: Day 4, dawn
Mood: Hushed.

### Scene: Wick
When: Day 4, dawn
Summary: Wren trims the wick.
- She climbs the stair
- The flame gutters

### Scene: Quay
When: Day 4, dusk
**Location:** Gull Quay
- Point of view: Odo
Summary: Odo waits for the boat.
- The boat is late
`

describe('reading a chapter card in a reply', () => {
  it('fills the chapter’s card, and a scene’s own parts, leaving the summary and beats as they were', () => {
    const [ch] = parseOutline(REPLY, true).chapters
    expect(ch.goal).toBe('Wren keeps the light burning through the storm.')
    expect(ch.card).toEqual({ pov: 'Wren', characters: ['Wren', 'Odo', 'Old Bren'], location: 'The Lamp Tower', when: 'Day 4, dawn', mood: 'Hushed' })
    const [wick, quay] = ch.scenes
    expect(wick.card).toEqual({ pov: '', characters: [], location: '', when: '', mood: '' })
    expect([wick.when, wick.summary, wick.beats]).toEqual(['Day 4, dawn', 'Wren trims the wick.', ['She climbs the stair', 'The flame gutters']])
    expect(quay.card).toMatchObject({ location: 'Gull Quay', pov: 'Odo' })
    expect([quay.when, quay.summary, quay.beats]).toEqual(['Day 4, dusk', 'Odo waits for the boat.', ['The boat is late']])
  })

  it('gives Keep the chapter’s card with its When, and a scene’s own parts without one', () => {
    const tree = outlineTree(parseOutline(REPLY, true))
    const items = keepPlan(tree, {}, {}, 'all')
    expect(items[0].card).toEqual({ pov: 'Wren', characters: ['Wren', 'Odo', 'Old Bren'], location: 'The Lamp Tower', when: 'Day 4, dawn', mood: 'Hushed' })
    expect(items[1].card).toBeUndefined()
    expect(items[2].card).toEqual({ pov: 'Odo', location: 'Gull Quay' })
    expect(cardNames(undefined, true)).toBeUndefined()
  })

  it('takes "Characters" with nothing after it, or a line saying none, as no card part', () => {
    const [ch] = parseOutline('## Chapter: Fog\nGoal: It rolls in.\nCharacters:\nLocation: none\nMood: n/a\n', true).chapters
    expect(ch.card).toEqual({ pov: '', characters: [], location: '', when: '', mood: '' })
  })

  it('reads the fake provider’s cards the same way (the app tests’ outline with "[[fake: chapter card]]")', () => {
    const briefing = `## Characters and places
- Wren Calloway (character): keeps the light.
- Odo Calloway (character): her brother.
- The Lamp Tower (place): on the point.
- Gull Quay (place): where the boats come in.

## What to suggest
Suggest 1 chapter with 3 scenes in each: about 3 scenes. No acts. [[fake: chapter card]]`
    const reply = outlineReply('[AIWRITE-OUTLINE v1] outline', [{ role: 'user', content: briefing }], 'fake')
    const [ch] = parseOutline(String(reply), true).chapters
    expect(ch.card).toEqual({ pov: 'Wren Calloway', characters: ['Wren Calloway', 'Odo Calloway'], location: 'The Lamp Tower', when: 'Day 1, morning', mood: 'Wet and watchful' })
    expect(ch.scenes.map((s) => s.when)).toEqual(['Day 1, morning', 'Day 1, midday', 'Day 1, afternoon'])
    expect(ch.scenes.map((s) => s.card.location)).toEqual(['', '', 'Gull Quay'])
  })
})
