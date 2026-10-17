import { describe, expect, it } from 'vitest'
import { outlineSystem, SCENE_FORM, THREAD_RULES } from '../outline/prompts'
import { storyAsk, storySystem } from './prompts'

/** The renderer's reader of a plan (features/outline/parse.ts). It is in the renderer's own project, so it is loaded by path. */
type Parsed = { acts: { chapters: Chapter[] }[]; chapters: Chapter[] }
type Chapter = { scenes: { title: string; setsUp?: string[]; paysOff?: string[] }[] }
const PARSE = '../../renderer/src/features/outline/parse'
const parseOutline = async (text: string): Promise<Parsed> =>
  ((await import(/* @vite-ignore */ PARSE)) as { parseOutline: (t: string, done: boolean) => Parsed }).parseOutline(text, true)

describe('a story planned from a recipe is asked for in the outline helper’s form (2026-10-17)', () => {
  it('has the outline’s scene form and plot thread rules', () => {
    for (const acts of [true, false]) {
      expect(storySystem(acts)).toContain(SCENE_FORM)
      expect(storySystem(acts)).toContain(THREAD_RULES)
      expect(outlineSystem(acts)).toContain(THREAD_RULES)
    }
    expect(SCENE_FORM).toContain('Sets up: <the plot threads this scene opens')
    expect(SCENE_FORM).toContain('Pays off: <the plot threads this scene resolves')
  })

  it('gives a reply whose Sets up and Pays off lines are read as plot threads', async () => {
    const reply = `Premise: A ferry keeper on a cold coast learns who rings the drowned bell.

## Chapter: Grey Water
Goal: She takes the ferry.
Point of view: Ila Marsh

### Scene: The first crossing
When: Day 1, morning
Summary: Ila takes the ferry over alone.
Sets up: The drowned bell; Who pays the toll
- She casts off
- The bell rings under the water

### Scene: The toll house
When: Day 2, dusk
Summary: Ila finds out who rings it.
Pays off: The drowned bell
- She climbs the stair
- The ringer turns`
    const o = await parseOutline(reply)
    const scenes = [...o.chapters, ...o.acts.flatMap((a) => a.chapters)].flatMap((c) => c.scenes)
    expect(scenes.map((s) => s.title)).toEqual(['The first crossing', 'The toll house'])
    expect(scenes[0].setsUp).toEqual(['The drowned bell', 'Who pays the toll'])
    expect(scenes[1].paysOff).toEqual(['The drowned bell'])
  })

  it('opens a new story on Day 1, and carries a story with chapters on from its last When', () => {
    const size = { acts: 0, chapters: 2, scenes: 2 }
    expect(storyAsk(size)).toBe('Plan the new story: the premise, then 2 chapters with 2 scenes in each. No acts. It opens on Day 1.')
    const again = storyAsk(size, { chapters: 2, latestWhen: 'Day 4, dusk' })
    expect(again).toContain('Plan what comes next in the story')
    expect(again).toContain('keep to its premise, and plan what comes after them')
    expect(again).toContain("Its last scene with a When is set at “Day 4, dusk”: the new scenes' Whens carry on from there.")
    expect(again).not.toContain('Day 1')
  })
})
