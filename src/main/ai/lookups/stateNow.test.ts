// state_of as things stand now (stand-in run, 2026-10-19): carrying on a scene, the planner asked what Wren wore, carried
// and suffered and was told "not recorded yet", though the scene had just taken her boots and coat off and her arm was
// bound. It answers from the story index, which has the scene's own words once where things stand is read from them, and
// from where things stand at the end of the scene so far, which is newer than the index. Invented test story.
import { describe, expect, it } from 'vitest'
import type { ID, ToolCall } from '@shared/types'
import type { SceneState } from '@shared/continuity'
import { memoryWorld } from '../../../../tests/unit/helpers'
import { keepStages, person, setCard, stage } from '../../../../tests/unit/storyIndexWorld'
import * as repo from '../../db/repo'
import * as mem from '../../db/memory'
import { sceneMemory } from '../../memory/scene'
import { buildStoryIndex } from '../../storyIndex'
import { runLookup, type LookupContext } from '.'

function world() {
  const db = memoryWorld()
  const story = repo.listStories(db)[0]
  const o = repo.getOutline(db, story.id)
  const road = o.scenes[0].id
  const inn = repo.createScene(db, o.chapters[0].id, { title: 'The inn' }).id
  const wren = repo.createEntry(db, 'character', { name: 'Wren Hollis', aliases: ['Wren'] }).id
  const ash = repo.createEntry(db, 'character', { name: 'Ash Penrose', aliases: ['Ash'] }).id
  repo.saveSceneText(db, road, null, 'Wren rode on in her oilskin coat, the survey case under her arm.')
  repo.saveSceneText(db, inn, null, 'Wren pulled her boots off and stood them by the hearth.')
  setCard(db, road, { povId: wren, presentIds: [ash] })
  setCard(db, inn, { povId: wren, presentIds: [ash] })
  mem.insertChange(db, {
    entryId: wren,
    anchor: 'scene',
    sceneId: road,
    kind: 'knowledge',
    payload: { factId: 'f-coast', fact: 'The Warden’s men watch the coast road', there: [wren, ash] },
    origin: 'text'
  })
  keepStages(db, {
    [road]: stage(road, [person('Wren Hollis', { where: 'on the salt road', holding: 'the survey case', clothes: [{ name: 'oilskin coat', state: 'on' }] })], {
      'wren hollis|where': 'Wren rode on',
      'wren hollis|holding': 'the survey case under her arm',
      'wren hollis|clothes:oilskin coat': 'in her oilskin coat'
    })
  })
  buildStoryIndex(db, story.id)
  const memory = sceneMemory(db, inn, { forWriter: true })
  const ctx = (over: Partial<LookupContext> = {}): LookupContext => ({
    db,
    sceneId: inn,
    storyId: story.id,
    asItBegins: false,
    entries: memory.entries,
    facts: memory.facts,
    relationships: memory.relationships,
    people: ['Wren Hollis', 'Ash Penrose'],
    hidden: new Set<ID>(),
    ...over
  })
  return { db, storyId: story.id, road, inn, ctx }
}

let n = 0
const call = (name: string, args: Record<string, unknown>): ToolCall => ({ id: `s${++n}`, name, arguments: JSON.stringify(args) })

// Where things stand at the end of the scene so far, as the writer (and the planner) is told it.
const NOW: SceneState = {
  time: 'evening',
  weather: '',
  light: '',
  characters: [
    person('Wren Hollis', {
      where: 'in the back parlour, by the settle',
      posture: 'sitting on the settle',
      holding: 'the key, in the pocket of her breeches',
      condition: 'left arm burned, the linen grey with wet',
      clothes: [
        { name: 'boots', state: 'off, on their sides at the edge of the hearth' },
        { name: 'oilskin coat', state: 'off, hung on the peg behind the door' },
        { name: 'jumper', state: 'damp at the cuffs' }
      ]
    })
  ],
  said: { 'wren hollis|clothes:boots': { quote: 'She stood them on their sides at the edge of the hearth', sceneId: '' } }
}

describe('state_of as things stand now (stand-in run, 2026-10-19)', () => {
  it('carrying on: where things stand at the end of the scene so far, over what the index last had', async () => {
    const w = world()
    const before = await runLookup(call('state_of', { name: 'Wren' }), w.ctx())
    expect(before.text).toContain('Wren Hollis: wearing oilskin coat (since Ch 1, Sc 1)')
    const a = await runLookup(call('state_of', { name: 'Wren' }), w.ctx({ stand: NOW }))
    expect(a.ok).toBe(true)
    const since = '(since Ch 1, Sc 2, in its words so far)'
    expect(a.text).toContain(`Wren Hollis: in the back parlour, by the settle ${since}`)
    expect(a.text).toContain(`Wren Hollis: placed sitting on the settle ${since}`)
    expect(a.text).toContain(
      `Wren Hollis: wearing boots off, on their sides at the edge of the hearth; oilskin coat off, hung on the peg behind the door; jumper: damp at the cuffs ${since}`
    )
    expect(a.text).toContain(`Wren Hollis: carrying the key, in the pocket of her breeches ${since}`)
    expect(a.text).toContain(`Wren Hollis: left arm burned, the linen grey with wet ${since}`)
    expect(a.text).not.toContain('oilskin coat (since Ch 1, Sc 1)')
    expect(a.text).not.toContain('Not recorded yet for Wren Hollis: what they wear')
    // What they know and their ties are the index's.
    expect(a.text).toContain('Wren Hollis knows: The Warden’s men watch the coast road (since Ch 1, Sc 1)')
    expect(a.facts).toContain(`Wren Hollis: carrying the key, in the pocket of her breeches ${since}`)
    // Someone where things stand says nothing of: as the index has them.
    const ash = await runLookup(call('state_of', { name: 'Ash' }), w.ctx({ stand: NOW }))
    expect(ash.text).not.toContain('in its words so far')
  })

  it('the story index has the scene’s own words too, once where things stand is read from them', async () => {
    const w = world()
    keepStages(w.db, {
      [w.inn]: stage(w.inn, [person('Wren Hollis', { where: 'by the hearth', clothes: [{ name: 'boots', state: 'off, by the hearth' }], condition: 'left arm burned' })], {
        'wren hollis|where': 'stood them by the hearth',
        'wren hollis|clothes:boots': 'pulled her boots off',
        'wren hollis|condition': 'her burned arm'
      })
    })
    buildStoryIndex(w.db, w.storyId)
    const a = await runLookup(call('state_of', { name: 'Wren' }), w.ctx())
    expect(a.text).toContain('Wren Hollis: by the hearth (since Ch 1, Sc 2)')
    expect(a.text).toContain('Wren Hollis: left arm burned (since Ch 1, Sc 2)')
    // The boots taken off stop being worn; the coat from the scene before is still on, as the index has it.
    expect(a.text).not.toContain('boots')
    // As the scene begins: the scene before's end.
    expect((await runLookup(call('state_of', { name: 'Wren' }), w.ctx({ asItBegins: true }))).text).toContain('Wren Hollis: on the salt road (since Ch 1, Sc 1)')
  })
})
