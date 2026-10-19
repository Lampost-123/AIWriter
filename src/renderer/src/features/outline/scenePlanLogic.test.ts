// "Plan this scene": what a planned card puts on the scene card, only where it is empty, names matched to the codex.
import { describe, expect, it } from 'vitest'
import { emptySceneCard } from '@shared/defaults'
import { outlineScenes, parseOutline } from './parse'
import { partsWords, planOnCard } from './scenePlanLogic'

const REPLY = `### Scene: The visitor at the gate
When: Day 2, evening
Summary: A stranger asks Mara for the key.
Point of view: Mara Venn
Characters: Mara Venn, Tobin Hale, Nobody Known
Location: Gull Quay
Mood: Hushed
- A knock after curfew
- The stranger names her father`

const find = {
  character: (n: string) => ({ 'Mara Venn': 'mara', 'Tobin Hale': 'tobin' })[n] ?? null,
  place: (n: string) => (n === 'Gull Quay' ? 'quay' : null)
}

describe('Plan this scene', () => {
  const scene = outlineScenes(parseOutline(REPLY, true))[0]

  it('fills an empty card with the planned scene, names matched to the codex (others left out)', () => {
    const { patch, names } = planOnCard(emptySceneCard(), scene, find)
    expect(patch).toEqual({
      goal: 'A stranger asks Mara for the key.',
      beats: ['A knock after curfew', 'The stranger names her father'],
      when: 'Day 2, evening',
      povId: 'mara',
      presentIds: ['mara', 'tobin'],
      locationId: 'quay',
      mood: 'Hushed'
    })
    expect(partsWords(names)).toBe('goal, beats, When, point of view, characters present, location and mood')
  })

  it('never changes what the card has', () => {
    const card = { ...emptySceneCard(), goal: 'Mine.', when: 'Day 9', povId: 'tobin' }
    const { patch, names } = planOnCard(card, scene, find)
    expect(patch.goal).toBeUndefined()
    expect(patch.when).toBeUndefined()
    expect(patch.povId).toBeUndefined()
    expect(names).toEqual(['beats', 'characters present', 'location', 'mood'])
  })
})
