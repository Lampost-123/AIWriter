// How a draft is told where things stand at its start (review, 2026-10-16): the stage read goes alongside the memory's
// catch-up rather than after it; a draft that still goes without it says so to Adam; and carrying on from the scene so
// far without a stage for its end tells nothing of where the previous scene ended, nor puts it in the contract's start.
// Every name is invented.

import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { keptStateBefore, type SceneState } from '../continuity/tracker'
import { sceneMemory } from '../memory/scene'
import { memoryWorld } from '../../../tests/unit/helpers'
import * as repo from '../db/repo'
import { carryOnFrom, catchUpBeforeDraft, gatherContextInput, setBeforeDraft, stageNote, STAGE_LATE, STAGE_LATE_SO_FAR, withStageRead } from './gather'
import { prepareContext } from './context'
import { contractAgain } from './contractAgain'

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

describe('a scene’s contract made again for the chapter writer’s checks', () => {
  /** Keeps where things stand at the end of the first scene, read from its words as they are now. */
  const keepEnd = (db: ReturnType<typeof world>['db'], s1: string, state: SceneState) => {
    const hash = createHash('sha1').update(repo.getScene(db, s1).text).digest('hex').slice(0, 16)
    repo.setMeta(db, 'continuity', JSON.stringify({ [s1]: { hash, base: '', state } }))
  }
  const starts = (c: ReturnType<typeof contractAgain>): string[] => (c?.items ?? []).filter((i) => i.part === 'start').map((i) => i.text)

  it('says what must be true at the start as the scene before now ends', () => {
    const { db, s1, s2 } = world()
    const o = { prefs: PREFS, contextLength: null, creativity: 'steady' as const, wanted: true }
    const asked = { options: { fresh: true }, planned: ['A knock comes at the door.'] }
    keepEnd(db, s1, ENDED)
    expect(starts(contractAgain(db, s2, asked, o))).toEqual(expect.arrayContaining([expect.stringMatching(/Mara is holding: the lamp/)]))
    // A review changes the first scene's ending: she puts the lamp on the sill and takes up a cup of tea.
    repo.saveSceneText(db, s1, null, 'Mara came in from the rain, put the lamp on the sill and took up a cup of tea.')
    keepEnd(db, s1, { ...ENDED, characters: [{ ...ENDED.characters[0], holding: 'a cup of tea' }] })
    const again = contractAgain(db, s2, asked, o)
    expect(starts(again).join('\n')).toMatch(/Mara is holding: a cup of tea/)
    expect(starts(again).join('\n')).not.toMatch(/the lamp/)
    // What the plan said must change stays.
    expect(again?.items.filter((i) => i.part === 'change').map((i) => i.text)).toContain('A knock comes at the door.')
    expect(contractAgain(db, s2, asked, { ...o, wanted: false })).toBeNull()
  })
})

describe('an empty scene between', () => {
  it('is passed over: the scene after it follows on from the one before it', () => {
    const { db, s1, s2 } = world()
    // A third scene after an empty one: the second is emptied (not written yet).
    const [story] = repo.listStories(db)
    const s3 = repo.createScene(db, repo.getOutline(db, story.id).chapters[0].id, { title: 'The road' }).id
    repo.saveSceneText(db, s2, null, '')
    repo.updateSceneCard(db, s3, { ...repo.getScene(db, s3).card, when: 'Day 3, dusk', povId: repo.getScene(db, s1).card.povId })
    const hash = createHash('sha1').update(repo.getScene(db, s1).text).digest('hex').slice(0, 16)
    repo.setMeta(db, 'continuity', JSON.stringify({ [s1]: { hash, base: '', state: ENDED } }))
    expect(sceneMemory(db, s3).previous?.sceneId).toBe(s1)
    expect(keptStateBefore(db, s3)?.characters[0]).toMatchObject({ name: 'Mara', holding: 'the lamp' })
    const input = gatherContextInput(db, s3, undefined, { prefs: PREFS, contextLength: null, creativity: 'steady' })
    expect(prepareContext(input).blocks.find((b) => b.id === 'continuity')?.text).toMatch(/the lamp/)
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

  it('keeps where things stood as the scene began, so what of it is unchanged carries only as far as it holds (2026-10-16)', () => {
    const { db, s2 } = world()
    const input = addBelow(db, s2)
    input.continuity = ENDED
    const stand: SceneState = { ...ENDED, characters: [{ ...ENDED.characters[0], where: 'by the hearth', posture: 'sitting' }] }
    carryOnFrom(db, input, stand)
    expect(input.continuityAtStart).toBe(ENDED)
    expect(input.continuity).toBe(stand)
    // Without a stage for the scene so far: nothing, as before.
    carryOnFrom(db, input, null)
    expect(input.continuityAtStart).toBeNull()
  })
})
