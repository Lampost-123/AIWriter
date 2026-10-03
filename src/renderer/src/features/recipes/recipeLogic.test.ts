import { describe, expect, it } from 'vitest'
import type { RecipeMaking } from '@shared/contracts/recipes'
import { parseOutline } from '@/features/outline/parse'
import { estimateWords, lengthWords, makingWords, premiseOf, recipeName, sizeForRecipe } from './recipeLogic'

const PLAN = `Premise: A newcomer finds a place to belong
on a space station that is falling apart.

# Act: The Arrival
Purpose: She comes aboard.

## Chapter: Grey Water
Goal: She is tested.

### Scene: First light
When: Day 1, morning
Summary: She docks.
- A choice is offered
- It is refused`

describe('a story planned from a recipe', () => {
  it('reads the premise at the top, once what follows it has started', () => {
    expect(premiseOf(PLAN, false)).toEqual({ text: 'A newcomer finds a place to belong on a space station that is falling apart.', complete: true })
    expect(premiseOf('Premise: A newcomer', false)).toEqual({ text: 'A newcomer', complete: false })
    expect(premiseOf('Premise: A newcomer', true).complete).toBe(true)
    expect(premiseOf('# Act: The Arrival', true).text).toBe('')
  })

  it('leaves the premise out of the outline helper’s suggestions', () => {
    const o = parseOutline(PLAN, true)
    expect(o.acts.map((a) => a.title)).toEqual(['The Arrival'])
    expect(o.acts[0].chapters[0].scenes[0]).toMatchObject({ title: 'First light', when: 'Day 1, morning', beats: ['A choice is offered', 'It is refused'] })
  })

  it('plans as many chapters as the story it came from, within what one answer holds', () => {
    expect(sizeForRecipe(24)).toEqual({ acts: 3, chapters: 24, scenes: 3 })
    expect(sizeForRecipe(40)).toEqual({ acts: 3, chapters: 30, scenes: 3 })
    expect(sizeForRecipe(0)).toEqual({ acts: 3, chapters: 9, scenes: 3 })
    expect(sizeForRecipe(2)).toEqual({ acts: 2, chapters: 2, scenes: 3 })
  })
})

describe('words on the recipe screens', () => {
  it('never shows a blank name', () => {
    expect(recipeName({ name: '  ', status: 'making' })).toBe('New recipe')
    expect(recipeName({ name: '', status: 'ready' })).toBe('Untitled recipe')
    expect(recipeName({ name: 'A slow burn', status: 'ready' })).toBe('A slow burn')
  })

  it('says how long the story was', () => {
    expect(lengthWords({ words: 96000, chapters: 24, byHand: false })).toBe('From a story of 24 chapters, 96,000 words')
    expect(lengthWords({ words: 0, chapters: 0, byHand: true })).toBe('Written by hand')
  })

  it('says what making the recipe is doing', () => {
    const m: RecipeMaking = { recipeId: 'r', name: '', step: 'reading', chapter: 3, chapters: 24, status: 'going', error: null, waiting: 0 }
    expect(makingWords(m)).toBe('Reading chapter 3 of 24')
    expect(makingWords({ ...m, step: 'writing' })).toBe('Writing the recipe')
    expect(makingWords({ ...m, status: 'paused' })).toBe('Making the recipe has paused')
  })

  it('says what it costs before anything is sent', () => {
    expect(estimateWords({ words: 96000, chapters: 24, cost: 0.4, model: 'Fake', problem: null })).toBe('About $0.40 with Fake, to read 24 chapters (96,000 words).')
    expect(estimateWords({ words: 900, chapters: 1, cost: null, model: 'Fake', problem: null })).toBe('The cost isn’t known for Fake. It reads 1 chapter (900 words).')
  })
})
