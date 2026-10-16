// How a draft is told where things stand at its start (review, 2026-10-16): the stage read goes alongside the memory's
// catch-up rather than after it; a draft that still goes without it says so to Adam; and carrying on from the scene so
// far without a stage for its end tells nothing of where the previous scene ended, nor puts it in the contract's start.
// Every name is invented.

import { describe, expect, it } from 'vitest'
import type { SceneState } from '../continuity/tracker'
import { memoryWorld } from '../../../tests/unit/helpers'
import * as repo from '../db/repo'
import { carryOnFrom, catchUpBeforeDraft, gatherContextInput, setBeforeDraft, stageNote, STAGE_LATE, STAGE_LATE_SO_FAR, withStageRead } from './gather'
import { prepareContext } from './context'

const PREFS = { spelling: 'UK' as const, pov: '', tense: '', voiceNotes: '', avoidWords: [] }

/** Two scenes on the same evening, Mara in both; the second has words already. */
function world() {
  const db = memoryWorld()
  const [story] = repo.listStories(db)
  const outline = repo.getOutline(db, story.id)
  const s1 = outline.scenes[0].id
  const s2 = repo.createScene(db, outline.chapters[0].id, { title: 'The lamp' }).id
  const mara = repo.createEntry(db, 'character', { name: 'Mara' })
  for (const id of [s1, s2]) repo.updateSceneCard(db, id, { ...repo.getScene(db, id).card, when: 'Day 3, dusk', povId: mara.id, presentIds: [mara.id] })
  repo.updateSceneCard(db, s2, { ...repo.getScene(db, s2).card, beats: ['Mara sits by the hearth.', 'A knock comes at the door.'] })
  repo.saveSceneText(db, s1, null, 'Mara came in from the rain with the lamp.')
  repo.saveSceneText(db, s2, null, 'Mara set the lamp down on the sill and sat by the hearth.')
  return { db, s1, s2 }
}

/** Where things stood as the first scene ended: Mara by the door, holding the lamp. */
const ENDED: SceneState = {
  time: '',
  weather: '',
  light: '',
  characters: [{ name: 'Mara', where: 'by the door', posture: '', holding: 'the lamp', condition: '', mood: '', lastAction: '' }]
}

describe('the stage read before a draft', () => {
  it('goes alongside the memory’s catch-up, so a slow summary never leaves the draft without it', async () => {
    const { db, s2 } = world()
    let staged = false
    // The keeper's catch-up takes longer than the draft waits (its summaries, fix 15); the stage read is quick.
    setBeforeDraft(
      withStageRead(
        () => new Promise((resolve) => setTimeout(resolve, 200)),
        async () => {
          staged = true
        }
      )
    )
    try {
      expect(await catchUpBeforeDraft(db, s2, 30)).toBe('timed-out')
      expect(staged).toBe(true)
    } finally {
      setBeforeDraft(null)
    }
  })
})

describe('telling Adam a draft went without where things stand', () => {
  const memory = (previous: { otherStory: object | null } | null) => ({ previous }) as unknown as Parameters<typeof stageNote>[0]['memory']
  it('only when there was a scene before to start from, or words to carry on from, and the memory could work', () => {
    expect(stageNote({ continuity: null, memory: memory({ otherStory: null }) }, { soFar: false, memoryReady: true })).toBe(STAGE_LATE)
    expect(stageNote({ continuity: null, memory: memory(null) }, { soFar: true, memoryReady: true })).toBe(STAGE_LATE_SO_FAR)
    // Told after all, nothing before it in this story, or no memory model (the top bar says so already): nothing to say.
    expect(stageNote({ continuity: ENDED, memory: memory({ otherStory: null }) }, { soFar: false, memoryReady: true })).toBeNull()
    expect(stageNote({ continuity: null, memory: memory(null) }, { soFar: false, memoryReady: true })).toBeNull()
    expect(stageNote({ continuity: null, memory: memory({ otherStory: {} }) }, { soFar: false, memoryReady: true })).toBeNull()
    expect(stageNote({ continuity: null, memory: memory({ otherStory: null }) }, { soFar: false, memoryReady: false })).toBeNull()
  })
  it('in plain words', () => {
    for (const note of [STAGE_LATE, STAGE_LATE_SO_FAR]) expect(note).not.toMatch(/\b(?:stage|continuity|briefing|LLM|model)\b/i)
  })
})

describe('Add below without where things stand at the end of the scene so far', () => {
  const addBelow = (db: ReturnType<typeof world>['db'], s2: string) => {
    const input = gatherContextInput(db, s2, { addBelow: true }, { prefs: PREFS, contextLength: null, creativity: 'steady' })
    // As kept, where things stood as the scene before ended.
    input.continuity = ENDED
    input.contract = { asks: 'stretch' }
    input.soFar = repo.getScene(db, s2).text
    return input
  }

  it('tells nothing of where the scene before ended, and the contract has no start', () => {
    const { db, s2 } = world()
    const input = addBelow(db, s2)
    // Before the fix: the scene before's end was told as where the scene so far carries on from.
    const was = prepareContext(input)
    expect(was.contract?.items.filter((i) => i.part === 'start').map((i) => i.text)).toEqual(expect.arrayContaining([expect.stringMatching(/Mara is holding: the lamp/)]))
    carryOnFrom(db, input, null)
    const now = prepareContext(input)
    expect(now.blocks.some((b) => b.id === 'continuity')).toBe(false)
    expect(now.contract?.items.some((i) => i.part === 'start')).toBe(false)
    // What must happen is still asked for: the next beat not on the page.
    expect(now.contract?.items.filter((i) => i.part === 'change').map((i) => i.text)).toEqual(['A knock comes at the door.'])
    expect(now.blocks.find((b) => b.id === 'must-stay-true')?.text ?? '').not.toMatch(/by the door|holding: the lamp/)
  })

  it('tells where things stand at the end of the scene so far when that was worked out', () => {
    const { db, s2 } = world()
    const input = addBelow(db, s2)
    const stand: SceneState = { ...ENDED, characters: [{ ...ENDED.characters[0], where: 'by the hearth', holding: '', posture: 'sitting' }] }
    carryOnFrom(db, input, stand)
    const now = prepareContext(input)
    const block = now.blocks.find((b) => b.id === 'continuity')
    expect(block?.title).toBe('Where things stand at the end of the scene so far')
    expect(block?.text).toMatch(/by the hearth/)
    expect(block?.text).not.toMatch(/by the door/)
  })
})
