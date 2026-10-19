// Can each planned beat happen? (2026-10-19, with place memory.) Each beat's people and things against the story index,
// no AI call: a thing used that is elsewhere (left in another place, or carried by someone not here), someone acting who
// is elsewhere; a short note for the writer when it can be put right nearby, else a flag for Adam; and no false alarms.
// Then the trap the live finding was about, end to end on the briefing: a letter hidden in one chapter, the story away,
// and back. Worlds made in memory with invented words.
import { describe, expect, it } from 'vitest'
import type { ID, SceneCard } from '@shared/types'
import type { SceneState } from '@shared/continuity'
import { defaultWritingPrefs } from '@shared/defaults'
import { memoryWorld } from '../../../tests/unit/helpers'
import { keepStages, person, setCard, stage } from '../../../tests/unit/storyIndexWorld'
import * as repo from '../db/repo'
import { buildStoryIndex, whereIs } from '../storyIndex'
import { gatherContextInput } from '../ai/gather'
import { buildBlocks, LEFT_HERE_BLOCK, prepareContext } from '../ai/context'
import { planCore } from './core'
import { planText, emptyPlan } from './plan'
import { beatsCanHappen, type BeatWorld } from './preconditions'

/** Where things stand with things in the place, each with its words from the scene. */
function withThings(sceneId: ID, base: SceneState, things: { name: string; state: string; quote: string }[]): SceneState {
  const said = { ...(base.said ?? {}) }
  for (const t of things) said[`|thing:${t.name.replace(/^the /i, '').toLowerCase()}`] = { quote: t.quote, sceneId }
  return { ...base, things: things.map(({ name, state }) => ({ name, state })), said }
}

/**
 * Hollow House (the study, the kitchen), the vestry, the mill and the Swan. Ch 1, Sc 1: Mara hides the letter under the
 * loose hearthstone in the study. Ch 1, Sc 2: Tobin at the mill with the brass key. Ch 2, Sc 1: being planned.
 */
function world() {
  const db = memoryWorld()
  const story = repo.listStories(db)[0]
  const o = repo.getOutline(db, story.id)
  const s1 = o.scenes[0].id
  const s2 = repo.createScene(db, o.chapters[0].id, { title: 'Mill' }).id
  const ch2 = repo.createChapter(db, story.id, { title: 'Two' }).id
  const s3 = repo.createScene(db, ch2, { title: 'Now' }).id
  const mara = repo.createEntry(db, 'character', { name: 'Mara Venn' }).id
  const tobin = repo.createEntry(db, 'character', { name: 'Tobin' }).id
  const ash = repo.createEntry(db, 'character', { name: 'Ash' }).id
  const house = repo.createEntry(db, 'place', { name: 'Hollow House' }).id
  const study = repo.createEntry(db, 'place', { name: 'the study', parentId: house }).id
  const kitchen = repo.createEntry(db, 'place', { name: 'the kitchen', parentId: house }).id
  const mill = repo.createEntry(db, 'place', { name: 'the mill' }).id
  const swan = repo.createEntry(db, 'place', { name: 'The Swan' }).id
  repo.saveSceneText(db, s1, null, 'Mara pried up the loose hearthstone and slid the letter beneath it.')
  repo.saveSceneText(db, s2, null, 'Tobin turned the brass key over and over in his fingers while the wheel groaned.')
  setCard(db, s1, { povId: mara, presentIds: [], locationId: study, when: 'Day 1' })
  setCard(db, s2, { povId: tobin, presentIds: [], locationId: mill, when: 'Day 2' })
  setCard(db, s3, { povId: mara, presentIds: [ash], locationId: kitchen, when: 'Day 3' })
  keepStages(db, {
    [s1]: withThings(s1, stage(s1, [person('Mara Venn', { where: 'by the hearth' })], { 'mara venn|where': 'pried up the loose hearthstone' }), [
      { name: 'the letter', state: 'under the loose hearthstone', quote: 'slid the letter beneath it' }
    ]),
    [s2]: stage(s2, [person('Tobin', { where: 'by the wheel', holding: 'the brass key' })], {
      'tobin|where': 'while the wheel groaned',
      'tobin|holding': 'turned the brass key over and over'
    })
  })
  buildStoryIndex(db, story.id)
  const entries = repo.listEntries(db).map((e) => ({ id: e.id, name: e.name, aliases: e.aliases, kind: e.kind }))
  /** The world a plan for Ch 2, Sc 1 is checked against, with its card (and who is in the scene) as given. */
  const at = (card: Partial<SceneCard> = {}, more: Partial<BeatWorld> = {}): BeatWorld => {
    setCard(db, s3, card)
    const c = repo.getScene(db, s3).card
    return {
      db,
      storyId: story.id,
      sceneId: s3,
      asItBegins: true,
      card: c,
      present: [c.povId, ...c.presentIds].filter((id): id is ID => !!id),
      entries,
      stand: null,
      calls: '',
      hidden: new Set<ID>(),
      ...more
    }
  }
  const beats = (...list: string[]) => ({ beats: list, changes: [] as string[] })
  return { db, storyId: story.id, s1, s2, s3, mara, tobin, ash, house, study, kitchen, mill, swan, at, beats }
}

describe('can each planned beat happen: things', () => {
  it('a thing left in another room of the house: a note for the writer to fetch it first', () => {
    const w = world()
    expect(beatsCanHappen(w.at(), w.beats('Ash builds up the fire', 'Mara reads the letter to Ash'))).toEqual({
      notes: [{ beat: 1, note: 'First Mara Venn must fetch the letter from the study, where it was left under the loose hearthstone (Ch 1, Sc 1).' }],
      flags: []
    })
  })

  it('a thing left far away: left as planned, and flagged for Adam', () => {
    const w = world()
    expect(beatsCanHappen(w.at({ locationId: w.swan }), w.beats('Mara reads the letter to Ash'))).toEqual({
      notes: [],
      flags: [
        'Beat 1 (“Mara reads the letter to Ash”) needs the letter, but the story last left it under the loose hearthstone at the study (Ch 1, Sc 1) and nothing since has anyone take it; this scene is at The Swan.'
      ]
    })
  })

  it('a thing someone not in the scene has: flagged; someone here has it: they hand it over first', () => {
    const w = world()
    expect(beatsCanHappen(w.at({ locationId: w.swan }), w.beats('Mara uses the brass key on the chest')).flags).toEqual([
      'Beat 1 (“Mara uses the brass key on the chest”) needs the brass key, but Tobin has it (carrying the brass key, since Ch 1, Sc 2), and Tobin isn’t in this scene.'
    ])
    expect(beatsCanHappen(w.at({ locationId: w.swan, presentIds: [w.ash, w.tobin] }), w.beats('Mara uses the brass key on the chest'))).toEqual({
      notes: [{ beat: 0, note: 'First Tobin must hand the brass key to Mara Venn (Tobin has had it since Ch 1, Sc 2).' }],
      flags: []
    })
    // The beat has him hand it over itself.
    expect(beatsCanHappen(w.at({ locationId: w.swan, presentIds: [w.tobin] }), w.beats('Tobin gives Mara the brass key and she uses the brass key'))).toEqual({
      notes: [],
      flags: []
    })
  })

  it('no false alarms: here already, fetched first, brought by the card or the words so far, one of many, or any one', () => {
    const w = world()
    const none = { notes: [], flags: [] }
    // In the place itself, or the house it is in.
    expect(beatsCanHappen(w.at({ locationId: w.study }), w.beats('Mara reads the letter to Ash'))).toEqual(none)
    expect(beatsCanHappen(w.at({ locationId: w.house }), w.beats('Mara reads the letter to Ash'))).toEqual(none)
    // Fetched in the beat, or a beat before.
    expect(beatsCanHappen(w.at(), w.beats('Mara fetches the letter from the study', 'Mara reads the letter to Ash'))).toEqual(none)
    expect(beatsCanHappen(w.at({ locationId: w.swan }), w.beats('Mara takes out the letter and reads the letter aloud'))).toEqual(none)
    // The card or Adam's direction bring it, or take the scene where it is.
    expect(beatsCanHappen(w.at({ locationId: w.swan }, { calls: 'Mara has brought the letter with her.' }), w.beats('Mara reads the letter to Ash'))).toEqual(none)
    expect(beatsCanHappen(w.at({ locationId: w.swan }, { calls: 'Later they go up to the study.' }), w.beats('Mara reads the letter to Ash'))).toEqual(none)
    // The words so far have it, or where things stand has someone here holding it.
    expect(beatsCanHappen(w.at({ locationId: w.swan }, { soFar: 'The letter lay open on the bar.' }), w.beats('Mara reads the letter to Ash'))).toEqual(none)
    const holding = stage(w.s3, [person('Mara Venn', { holding: 'the letter' })], {})
    expect(beatsCanHappen(w.at({ locationId: w.swan }, { stand: holding }), w.beats('Mara reads the letter to Ash'))).toEqual(none)
    // Any letter ("a letter"), what is one of many (the cup), and what the story has nothing of.
    expect(beatsCanHappen(w.at({ locationId: w.swan }), w.beats('Mara reads a letter from her sister', 'Ash pours the wine', 'Mara opens the shutters'))).toEqual(none)
    // Planning off the index: nothing for a scene the index doesn't have.
    expect(beatsCanHappen({ ...w.at({ locationId: w.swan }), sceneId: 'nope' }, w.beats('Mara reads the letter to Ash'))).toEqual(none)
  })
})

describe('can each planned beat happen: people', () => {
  it('someone who acts but is elsewhere, and whom the card doesn’t bring: flagged for Adam', () => {
    const w = world()
    expect(beatsCanHappen(w.at({ locationId: w.swan }), w.beats('Tobin pours the ale and tells Mara about the flood')).flags).toEqual([
      'Beat 1 (“Tobin pours the ale and tells Mara about the flood”) has Tobin there, but Tobin isn’t in this scene: its card doesn’t bring them, and the story last had them at the mill (Ch 1, Sc 2).'
    ])
  })

  it('no false alarms: on the card, only thought of, brought by the card or a beat, or last seen here', () => {
    const w = world()
    const none = { notes: [], flags: [] }
    expect(beatsCanHappen(w.at({ locationId: w.swan, presentIds: [w.tobin] }), w.beats('Tobin pours the ale'))).toEqual(none)
    expect(beatsCanHappen(w.at({ locationId: w.swan }), w.beats('Mara thinks of Tobin at the mill'))).toEqual(none)
    expect(beatsCanHappen(w.at({ locationId: w.swan }), w.beats('Ash reads out Tobin’s note'))).toEqual(none)
    expect(beatsCanHappen(w.at({ locationId: w.swan }, { calls: 'Tobin comes in late, soaked.' }), w.beats('Tobin pours the ale'))).toEqual(none)
    expect(beatsCanHappen(w.at({ locationId: w.swan }), w.beats('Tobin arrives from the mill', 'Tobin pours the ale'))).toEqual(none)
    expect(beatsCanHappen(w.at({ locationId: w.mill }), w.beats('Tobin pours the ale'))).toEqual(none)
    // Ash has never been anywhere: the index can't say they are elsewhere.
    expect(beatsCanHappen(w.at({ locationId: w.swan, presentIds: [] }), w.beats('Ash pours the ale'))).toEqual(none)
  })
})

describe('the writer’s notes', () => {
  it('say what must come first after its beat, and nothing more when there is nothing', () => {
    const plan = { ...emptyPlan(), beats: ['Ash builds up the fire', 'Mara reads the letter to Ash'] }
    const first = [{ beat: 1, note: 'First Mara Venn must fetch the letter from the study, where it was left under the loose hearthstone (Ch 1, Sc 1).' }]
    expect(planText({ ...plan, first }, false)).toContain(
      '1. Ash builds up the fire\n2. Mara reads the letter to Ash. First Mara Venn must fetch the letter from the study, where it was left under the loose hearthstone (Ch 1, Sc 1).\n'
    )
    expect(planText(plan, false)).toContain('1. Ash builds up the fire\n2. Mara reads the letter to Ash\n')
  })
})

describe('the hidden letter (trap): hidden in Ch 1, the story away in Ch 2, back in Ch 3', () => {
  /** Ch 1 the study, the letter hidden; Ch 2 the Swan; Ch 3, Sc 1 back in the study (or a room by it). */
  function trap(back: 'study' | 'kitchen') {
    const w = world()
    repo.saveSceneText(w.db, w.s3, null, 'Mara and Ash drank at the Swan and spoke of the harvest.')
    setCard(w.db, w.s3, { locationId: w.swan })
    keepStages(w.db, { [w.s3]: stage(w.s3, [person('Mara Venn', { where: 'at the bar' })], { 'mara venn|where': 'drank at the Swan' }) })
    const ch3 = repo.createChapter(w.db, w.storyId, { title: 'Three' }).id
    const s4 = repo.createScene(w.db, ch3, { title: 'Back' }).id
    setCard(w.db, s4, { povId: w.mara, presentIds: [w.ash], locationId: back === 'study' ? w.study : w.kitchen, when: 'Day 9' })
    buildStoryIndex(w.db, w.storyId)
    const input = gatherContextInput(w.db, s4, { direction: '', targetWords: 600, creativity: 'balanced' }, { prefs: defaultWritingPrefs(), contextLength: 64_000, creativity: 'balanced' })
    return { ...w, s4, input }
  }

  it('back in the study: the writer’s briefing and the planner’s core both say where the letter is', () => {
    const t = trap('study')
    expect(t.input.leftHere).toEqual(['Left here before: the letter under the loose hearthstone (since Ch 1, Sc 1)'])
    const block = buildBlocks(t.input).find((b) => b.id === LEFT_HERE_BLOCK.id)
    expect(block?.text).toContain('- Left here before: the letter under the loose hearthstone (since Ch 1, Sc 1)')
    // Sent late, right before where things stand.
    const told = stage(t.s4, [person('Mara Venn', { where: 'by the hearth' })], { 'mara venn|where': 'sat by the hearth' })
    const ids = prepareContext({ ...t.input, continuity: told }).blocks.map((b) => b.id)
    expect(ids).toContain('continuity')
    expect(ids.indexOf(LEFT_HERE_BLOCK.id)).toBe(ids.indexOf('continuity') - 1)
    const core = planCore(t.db, t.input, t.s4, { carryingOn: false, hidden: new Set<ID>() })
    expect(core?.left).toEqual(['Left here before: the letter under the loose hearthstone (since Ch 1, Sc 1)'])
  })

  it('in the kitchen next door: a beat that reads the letter is told to fetch it from the study first', () => {
    const t = trap('kitchen')
    expect(t.input.leftHere).toEqual([])
    const core = planCore(t.db, t.input, t.s4, { carryingOn: false, hidden: new Set<ID>() })!
    const can = beatsCanHappen(
      {
        db: t.db,
        storyId: t.storyId,
        sceneId: t.s4,
        asItBegins: true,
        card: t.input.scene.card,
        present: core.present,
        entries: t.input.memory.entries,
        calls: '',
        hidden: new Set<ID>()
      },
      { beats: ['Mara reads the letter to Ash'], changes: [] }
    )
    expect(can.notes).toEqual([{ beat: 0, note: 'First Mara Venn must fetch the letter from the study, where it was left under the loose hearthstone (Ch 1, Sc 1).' }])
  })

  it('once fetched, the next visit no longer finds it there, and where_is says who has it', () => {
    const t = trap('study')
    repo.saveSceneText(t.db, t.s4, null, 'Mara lifted the hearthstone and took the letter out.')
    keepStages(t.db, { [t.s4]: stage(t.s4, [person('Mara Venn', { holding: 'the letter' })], { 'mara venn|holding': 'took the letter out' }) })
    const s5 = repo.createScene(t.db, repo.sceneLocation(t.db, t.s4).chapter.id, { title: 'After' }).id
    setCard(t.db, s5, { povId: t.mara, presentIds: [], locationId: t.study })
    buildStoryIndex(t.db, t.storyId)
    const after = gatherContextInput(t.db, s5, { direction: '', targetWords: 600, creativity: 'balanced' }, { prefs: defaultWritingPrefs(), contextLength: 64_000, creativity: 'balanced' })
    expect(after.leftHere).toEqual([])
    expect(buildBlocks(after).some((b) => b.id === LEFT_HERE_BLOCK.id)).toBe(false)
    expect(whereIs(t.db, t.storyId, 'the letter', s5, { asItBegins: true }).lines).toEqual(['Now: Mara Venn is carrying the letter (since Ch 3, Sc 1).'])
  })
})
