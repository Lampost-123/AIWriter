// Place memory (2026-10-19): things left in a place are kept in the story index as dated facts, built from where things
// stand, closed when taken, moved or gone, and read back when the story returns to the place (or a room in it), and by
// where_is. Worlds made in memory with invented words.
import { describe, expect, it } from 'vitest'
import type { ID } from '@shared/types'
import type { SceneState } from '@shared/continuity'
import { memoryWorld } from '../../../tests/unit/helpers'
import { keepStages, person, setCard, stage } from '../../../tests/unit/storyIndexWorld'
import * as repo from '../db/repo'
import * as sidx from '../db/storyIndex'
import { buildStoryIndex } from '.'
import { heldNames, leftable, leftHere, placedText, sameThing, thingsLeft, whereIs } from './placed'

/** Where things stand with things in the place, each with its words from the scene. */
function withThings(sceneId: ID, base: SceneState, things: { name: string; state: string; quote: string }[]): SceneState {
  const said = { ...(base.said ?? {}) }
  for (const t of things) said[`|thing:${t.name.replace(/^the /i, '').toLowerCase()}`] = { quote: t.quote, sceneId }
  return { ...base, things: things.map(({ name, state }) => ({ name, state })), said }
}

/**
 * Hollow House with two rooms (the study, the kitchen), the vestry, and the Swan; a story of three chapters, a scene each,
 * the third being written. In Ch 1 Mara hides the letter under the loose hearthstone in the study.
 */
function world() {
  const db = memoryWorld()
  const story = repo.listStories(db)[0]
  const o = repo.getOutline(db, story.id)
  const s1 = o.scenes[0].id
  const ch2 = repo.createChapter(db, story.id, { title: 'Two' }).id
  const ch3 = repo.createChapter(db, story.id, { title: 'Three' }).id
  const s2 = repo.createScene(db, ch2, { title: 'Away' }).id
  const s3 = repo.createScene(db, ch3, { title: 'Back' }).id
  const mara = repo.createEntry(db, 'character', { name: 'Mara Venn' }).id
  const tobin = repo.createEntry(db, 'character', { name: 'Tobin' }).id
  const house = repo.createEntry(db, 'place', { name: 'Hollow House' }).id
  const study = repo.createEntry(db, 'place', { name: 'the study', parentId: house }).id
  const kitchen = repo.createEntry(db, 'place', { name: 'the kitchen', parentId: house }).id
  const vestry = repo.createEntry(db, 'place', { name: 'the vestry' }).id
  const swan = repo.createEntry(db, 'place', { name: 'The Swan' }).id
  repo.saveSceneText(db, s1, null, 'Mara pried up the loose hearthstone and slid the letter beneath it. She barred the door and lit the lamp.')
  repo.saveSceneText(db, s2, null, 'Mara and Tobin drank by the fire at the Swan and spoke of nothing.')
  repo.saveSceneText(db, s3, null, '')
  setCard(db, s1, { povId: mara, presentIds: [], locationId: study, when: 'Day 1' })
  setCard(db, s2, { povId: mara, presentIds: [tobin], locationId: swan, when: 'Day 2' })
  setCard(db, s3, { povId: mara, presentIds: [], locationId: study, when: 'Day 9' })
  const first = withThings(s1, stage(s1, [person('Mara Venn', { where: 'by the hearth' })], { 'mara venn|where': 'pried up the loose hearthstone' }), [
    { name: 'the letter', state: 'under the loose hearthstone', quote: 'slid the letter beneath it' },
    { name: 'the door', state: 'barred from inside', quote: 'She barred the door' },
    { name: 'the lamp', state: 'lit, on the desk', quote: 'lit the lamp' }
  ])
  keepStages(db, {
    [s1]: first,
    [s2]: stage(s2, [person('Mara Venn', { where: 'by the fire' }), person('Tobin', { where: 'by the fire' })], { 'mara venn|where': 'drank by the fire' })
  })
  return { db, storyId: story.id, s1, s2, s3, mara, tobin, house, study, kitchen, vestry, swan }
}

describe('what can be left in a place', () => {
  it('a thing said to be somewhere, never part of the place, nor on someone', () => {
    expect(leftable({ name: 'the letter', state: 'under the loose hearthstone' })).toBe(true)
    expect(leftable({ name: 'the survey case', state: 'on the windowsill' })).toBe(true)
    expect(leftable({ name: 'the door', state: 'barred from inside' })).toBe(false)
    expect(leftable({ name: 'the lamp', state: 'lit, on the desk' })).toBe(false)
    expect(leftable({ name: 'the strongbox', state: 'open and empty' })).toBe(false)
    expect(leftable({ name: 'the letter', state: "in Mara's hand" })).toBe(false)
    expect(leftable({ name: 'the knife', state: 'tucked in her belt' })).toBe(false)
    expect(leftable({ name: 'the key', state: 'held by Tobin' })).toBe(false)
  })
  it('names the same thing however it is said, and reads what someone holds', () => {
    expect(sameThing('the letter', 'letter')).toBe(true)
    expect(sameThing('the sealed letter', 'letter')).toBe(true)
    expect(sameThing('letters', 'the letter')).toBe(true)
    expect(sameThing('the letter', 'the lantern')).toBe(false)
    expect(sameThing('the blue box', 'the red box')).toBe(false)
    expect(heldNames('the letter, tucked in her bodice; a lantern')).toEqual(['letter', 'lantern'])
    expect(heldNames('nothing')).toEqual([])
    expect(placedText('the letter', 'under the loose hearthstone')).toBe('the letter under the loose hearthstone')
    expect(placedText('the case', 'shut, on the sill')).toBe('the case, shut, on the sill')
  })
})

describe('place memory across visits', () => {
  it('a letter hidden in Ch 1 is still there when the story comes back in Ch 3, after a scene elsewhere', () => {
    const w = world()
    buildStoryIndex(w.db, w.storyId)
    const back = leftHere(w.db, w.storyId, w.s3, w.study, { asItBegins: true })
    expect(back.lines).toEqual(['Left here before: the letter under the loose hearthstone (since Ch 1, Sc 1)'])
    expect(back.things[0]).toMatchObject({ name: 'the letter', how: 'under the loose hearthstone', quote: 'slid the letter beneath it', place: 'the study' })
    // Nothing of it at the Swan, nor in another room of the house; the house itself says which room.
    expect(leftHere(w.db, w.storyId, w.s3, w.swan, { asItBegins: true }).lines).toEqual([])
    expect(leftHere(w.db, w.storyId, w.s3, w.kitchen, { asItBegins: true }).lines).toEqual([])
    expect(leftHere(w.db, w.storyId, w.s3, w.house, { asItBegins: true }).lines).toEqual([
      'Left here before: the letter under the loose hearthstone, in the study (since Ch 1, Sc 1)'
    ])
    // A room inside the place the letter was left at counts too.
    setCard(w.db, w.s1, { locationId: w.house })
    buildStoryIndex(w.db, w.storyId)
    expect(leftHere(w.db, w.storyId, w.s3, w.study, { asItBegins: true }).lines).toEqual([
      'Left here before: the letter under the loose hearthstone, in Hollow House (since Ch 1, Sc 1)'
    ])
  })

  it('taken: someone holding it by a later scene’s words ends it, wherever they are', () => {
    const w = world()
    keepStages(w.db, {
      [w.s2]: stage(w.s2, [person('Mara Venn', { where: 'by the fire', holding: 'the letter, folded small' })], {
        'mara venn|holding': 'the letter, folded small in her fist'
      })
    })
    buildStoryIndex(w.db, w.storyId)
    expect(leftHere(w.db, w.storyId, w.s3, w.study, { asItBegins: true }).lines).toEqual([])
    expect(whereIs(w.db, w.storyId, 'letter', w.s3, { asItBegins: true }).lines).toEqual(['Now: Mara Venn is carrying the letter, folded small (since Ch 2, Sc 1).'])
  })

  it('what became of it once no one has it: taken by whom, and when', () => {
    const w = world()
    repo.saveSceneText(w.db, w.s3, null, 'Mara read the letter twice and burned it.')
    keepStages(w.db, {
      [w.s2]: stage(w.s2, [person('Mara Venn', { holding: 'the letter' })], { 'mara venn|holding': 'took the letter' }),
      [w.s3]: stage(w.s3, [person('Mara Venn', { holding: '' })], {})
    })
    buildStoryIndex(w.db, w.storyId)
    expect(whereIs(w.db, w.storyId, 'the letter', w.s3).lines).toEqual([
      'Last left: the letter under the loose hearthstone, at the study (Ch 1, Sc 1); taken by Mara Venn in Ch 2, Sc 1. Nothing since says where it is.'
    ])
  })

  it('moved: the same thing put somewhere else ends it where it was', () => {
    const w = world()
    setCard(w.db, w.s2, { locationId: w.vestry })
    keepStages(w.db, {
      [w.s2]: withThings(w.s2, stage(w.s2, [person('Mara Venn')], {}), [{ name: 'the sealed letter', state: 'in the poor box', quote: 'dropped the letter in the poor box' }])
    })
    buildStoryIndex(w.db, w.storyId)
    expect(leftHere(w.db, w.storyId, w.s3, w.study, { asItBegins: true }).lines).toEqual([])
    expect(whereIs(w.db, w.storyId, 'letter', w.s3, { asItBegins: true }).lines).toEqual(['Now: the sealed letter in the poor box, at the vestry (since Ch 2, Sc 1).'])
  })

  it('gone: the scene right after, in the same place, no longer has it', () => {
    const w = world()
    setCard(w.db, w.s2, { locationId: w.study })
    keepStages(w.db, {
      [w.s2]: withThings(w.s2, stage(w.s2, [person('Mara Venn')], {}), [{ name: 'the inkwell', state: 'on the desk', quote: 'set the inkwell on the desk' }])
    })
    buildStoryIndex(w.db, w.storyId)
    expect(thingsLeft(w.db, w.storyId, w.s3, { asItBegins: true }).map((t) => t.name)).toEqual(['the inkwell'])
  })

  it('never gone because a scene in between was somewhere else, nor carried on twice', () => {
    const w = world()
    const s4 = repo.createScene(w.db, repo.sceneLocation(w.db, w.s3).chapter.id, { title: 'Later' }).id
    repo.saveSceneText(w.db, w.s3, null, 'Mara sat in the study and wrote to her brother.')
    setCard(w.db, s4, { locationId: w.study })
    // Ch 3, Sc 1 is in the study after the Swan: its stage starts with nothing in the place, and says nothing of the letter.
    keepStages(w.db, { [w.s3]: withThings(w.s3, stage(w.s3, [person('Mara Venn')], {}), [{ name: 'the quill', state: 'on the desk', quote: 'wrote' }]) })
    buildStoryIndex(w.db, w.storyId)
    expect(leftHere(w.db, w.storyId, s4, w.study, { asItBegins: true }).lines).toEqual([
      'Left here before: the letter under the loose hearthstone (since Ch 1, Sc 1)',
      'Left here before: the quill on the desk (since Ch 3, Sc 1)'
    ])
    expect(sidx.storyFactsInOrder(w.db, w.storyId).filter((f) => f.kind === 'placed' && f.value).length).toBe(2)
  })

  it('where_is says when nothing is known, and as a scene begins leaves out its own facts', () => {
    const w = world()
    buildStoryIndex(w.db, w.storyId)
    expect(whereIs(w.db, w.storyId, 'the compass', w.s3).lines).toEqual([])
    expect(whereIs(w.db, w.storyId, 'the letter', w.s1, { asItBegins: true }).lines).toEqual([])
    expect(whereIs(w.db, w.storyId, 'the letter', w.s1).lines).toEqual(['Now: the letter under the loose hearthstone, at the study (since Ch 1, Sc 1).'])
  })
})
