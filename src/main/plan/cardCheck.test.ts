// The card check before writing (plan/cardCheck.ts): the scene card held to the story index with no AI call. Each kind of
// finding the stand-in test asked for (a card's Where that the people on it can't have reached, or that its own beats
// contradict; someone on the card who is dead; a thing the card uses that was filed away or given up; a When earlier than
// the scene before; an age that contradicts the entry), each with its controls, so it never says what the index isn't
// sure of. Worlds made in memory with invented words.
import { describe, expect, it } from 'vitest'
import type { ID, SceneCard } from '@shared/types'
import type { SceneState } from '@shared/continuity'
import { memoryWorld } from '../../../tests/unit/helpers'
import { keepStages, person, setCard, stage } from '../../../tests/unit/storyIndexWorld'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import { sceneMemory } from '../memory/scene'
import { buildStoryIndex } from '../storyIndex'
import { CARD_NOTE, cardCheck, cardNoteLines, type CardWorld } from './cardCheck'
import { planMessages, CARD_NOTES_TITLE, type PlanMaterial } from './plan'

/** Where things stand with things in the place, each with its words from the scene. */
function withThings(sceneId: ID, base: SceneState, things: { name: string; state: string; quote: string }[]): SceneState {
  const said = { ...(base.said ?? {}) }
  for (const t of things) said[`|thing:${t.name.replace(/^the /i, '').toLowerCase()}`] = { quote: t.quote, sceneId }
  return { ...base, things: things.map(({ name, state }) => ({ name, state })), said }
}

/**
 * The Gull Inn (on the coast road), the Drove Road (two days' ride from the Gull Inn, in its entry), the courthouse, and
 * Mara, Tobin and Ash. Ch 1, Sc 1: at the courthouse, Mara files the case with the clerk. Ch 1, Sc 2: at the Gull Inn,
 * Mara and Tobin. Ch 1, Sc 3: the card being checked.
 */
function world() {
  const db = memoryWorld()
  const story = repo.listStories(db)[0]
  const o = repo.getOutline(db, story.id)
  const s1 = o.scenes[0].id
  const s2 = repo.createScene(db, o.chapters[0].id, { title: 'The inn' }).id
  const s3 = repo.createScene(db, o.chapters[0].id, { title: 'Now' }).id
  const mara = repo.createEntry(db, 'character', { name: 'Mara Venn', fields: { age: '34' } }).id
  const tobin = repo.createEntry(db, 'character', { name: 'Tobin', fields: { age: '45' } }).id
  const ash = repo.createEntry(db, 'character', { name: 'Ash' }).id
  const court = repo.createEntry(db, 'place', { name: 'the courthouse', summary: 'Grey stone on the square.' }).id
  const gull = repo.createEntry(db, 'place', { name: 'The Gull Inn', summary: 'An inn on the coast road.' }).id
  const drove = repo.createEntry(db, 'place', { name: 'The Drove Road', summary: "A drovers' track over the moor, two days' ride from The Gull Inn." }).id
  const box = repo.createEntry(db, 'item', { name: 'The deed box', summary: 'A tin box of old deeds.' }).id
  repo.saveSceneText(db, s1, null, 'Mara handed the case to the clerk, who locked it in his strongbox, and that was that.')
  repo.saveSceneText(db, s2, null, 'Mara and Tobin sat in the taproom of the Gull Inn and listened to the rain.')
  setCard(db, s1, { povId: mara, presentIds: [], locationId: court, when: 'Day 3, morning' })
  setCard(db, s2, { povId: mara, presentIds: [tobin], locationId: gull, when: 'Day 3, evening' })
  keepStages(db, {
    [s1]: withThings(s1, stage(s1, [person('Mara Venn', { where: 'at the clerk’s desk' })], { 'mara venn|where': 'handed the case to the clerk' }), [
      { name: 'the case', state: 'in the clerk’s strongbox', quote: 'locked it in his strongbox' }
    ]),
    [s2]: stage(s2, [person('Mara Venn', { where: 'in the taproom' }), person('Tobin', { where: 'in the taproom' })], {
      'mara venn|where': 'sat in the taproom',
      'tobin|where': 'sat in the taproom'
    })
  })
  buildStoryIndex(db, story.id)
  const ids = { db, storyId: story.id, s1, s2, s3, mara, tobin, ash, court, gull, drove, box }
  /** The world the card of Ch 1, Sc 3 is checked against, with its card as given. */
  const at = (card: Partial<SceneCard>, more: Partial<CardWorld> = {}): CardWorld => {
    setCard(db, s3, card)
    buildStoryIndex(db, story.id)
    const c = repo.getScene(db, s3).card
    const memory = sceneMemory(db, s3)
    return {
      db,
      storyId: story.id,
      sceneId: s3,
      card: c,
      direction: '',
      entries: memory.entries,
      relationships: memory.relationships,
      present: [c.povId, ...c.presentIds].filter((id): id is ID => !!id),
      asItBegins: true,
      hidden: new Set<ID>(),
      storyTitle: story.title,
      ...more
    }
  }
  return { ...ids, at }
}

const texts = (w: CardWorld): string[] => cardCheck(w).map((f) => f.text)

describe('the card check: the card’s place', () => {
  it('finds someone on the card who can’t have come from where they were in the time the cards allow', () => {
    const w = world()
    const found = cardCheck(w.at({ povId: w.mara, presentIds: [], locationId: w.drove, when: 'Day 3, night' }))
    expect(found.filter((f) => f.kind === 'place')).toEqual([
      {
        kind: 'place',
        entryId: w.mara,
        text: 'Mara Venn is at The Gull Inn in Ch 1, Sc 2 (Day 3 · evening) and at The Drove Road in Ch 1, Sc 3 (Day 3 · night), but The Gull Inn to The Drove Road is about 2 days on horseback. Either time has passed on the way, or Mara Venn isn’t there yet.'
      }
    ])
  })

  it('finds a card whose beats have them at the place they were last, not the card’s Where', () => {
    const w = world()
    const found = cardCheck(w.at({ povId: w.mara, presentIds: [w.tobin], locationId: w.drove, when: '', beats: ['Mara waits in the Gull Inn’s taproom while the rain comes down.'] }))
    expect(found.map((f) => f.text)).toContain(
      'This card puts the scene at The Drove Road, but the card’s beat 1 (“Mara waits in the Gull Inn’s taproom while the rain comes down.”) has Mara Venn at The Gull Inn, where the story last had Mara Venn (Ch 1, Sc 2). One of the two is wrong.'
    )
  })

  it('says nothing of the place when the cards allow it, leave the time open, or the beats go there or remember it', () => {
    const w = world()
    const cases: [string, Partial<SceneCard>][] = [
      ['time enough', { povId: w.mara, presentIds: [], locationId: w.drove, when: 'Day 6, evening', beats: [] }],
      ['no time on the card', { povId: w.mara, presentIds: [], locationId: w.drove, when: '', beats: [] }],
      ['the same place', { povId: w.mara, presentIds: [], locationId: w.gull, when: 'Day 3, night', beats: ['Mara waits in the Gull Inn’s taproom.'] }],
      ['riding from there', { povId: w.mara, presentIds: [], locationId: w.drove, when: '', beats: ['Mara rides from the Gull Inn up onto the moor.'] }],
      ['remembering it', { povId: w.mara, presentIds: [], locationId: w.drove, when: '', beats: ['Mara remembers the fire in the Gull Inn.'] }],
      ['a dream', { povId: w.mara, presentIds: [], locationId: w.drove, when: 'Day 3, night', notes: 'A dream.', beats: [] }]
    ]
    for (const [why, card] of cases) expect(texts(w.at(card)), why).toEqual([])
  })

  it('reads place and time only as a scene begins: carrying on, the words have it in hand', () => {
    const w = world()
    expect(texts(w.at({ povId: w.mara, presentIds: [], locationId: w.drove, when: 'Day 3, night', beats: [] }, { asItBegins: false }))).toEqual([])
  })
})

describe('the card check: who is on it', () => {
  it('finds someone on the card the memory is sure has died, never someone presumed dead, nor in a dream', () => {
    const w = world()
    mem.insertChange(w.db, { entryId: w.tobin, anchor: 'scene', sceneId: w.s2, kind: 'update', payload: { note: 'died in the fire' }, origin: 'text' })
    mem.insertChange(w.db, { entryId: w.ash, anchor: 'scene', sceneId: w.s2, kind: 'update', payload: { note: 'presumed dead' }, origin: 'text' })
    const found = cardCheck(w.at({ povId: w.mara, presentIds: [w.tobin, w.ash], locationId: w.gull, when: 'Day 4, morning', beats: [] }))
    expect(found).toEqual([
      {
        kind: 'person',
        entryId: w.tobin,
        text: 'Tobin died in Ch 1, Sc 2, but this scene’s card has Tobin there. The dead may be remembered, talked of or found here, never act.'
      }
    ])
    expect(texts(w.at({ povId: w.mara, presentIds: [w.tobin], locationId: w.gull, when: 'Day 4, morning', notes: 'Mara dreams of the fire.' }))).toEqual([])
  })
})

describe('the card check: things the card uses', () => {
  it('finds a thing the card has someone use that was left elsewhere (the case filed with the court)', () => {
    const w = world()
    const found = cardCheck(w.at({ povId: w.mara, presentIds: [], locationId: w.gull, when: 'Day 4, morning', beats: ['Mara opens the case and reads the depositions again.'] }))
    expect(found.map((f) => [f.kind, f.text])).toEqual([
      [
        'thing',
        'The card’s beat 1 (“Mara opens the case and reads the depositions again.”) needs the case, but the story last left it in the clerk’s strongbox at the courthouse (Ch 1, Sc 1) and nothing since has anyone take it; this scene is at The Gull Inn.'
      ]
    ])
  })

  it('finds the same in Adam’s direction', () => {
    const w = world()
    const found = cardCheck(w.at({ povId: w.mara, presentIds: [], locationId: w.gull, when: 'Day 4, morning', beats: [] }, { direction: 'Mara opens the case on the table.' }))
    expect(found.map((f) => f.text)).toEqual([
      'Your direction (“Mara opens the case on the table”) needs the case, but the story last left it in the clerk’s strongbox at the courthouse (Ch 1, Sc 1) and nothing since has anyone take it; this scene is at The Gull Inn.'
    ])
  })

  it('finds an item someone on the card gave up, as the memory tells it', () => {
    const w = world()
    mem.insertChange(w.db, { entryId: w.mara, anchor: 'scene', sceneId: w.s1, kind: 'update', payload: { note: 'handed the deed box over to the court clerk' }, origin: 'text' })
    const found = cardCheck(w.at({ povId: w.mara, presentIds: [], locationId: w.gull, when: 'Day 4, morning', beats: ['Mara unlocks the deed box by the fire.'] }))
    expect(found.map((f) => [f.kind, f.entryId, f.text])).toEqual([
      [
        'thing',
        w.box,
        'The card’s beat 1 (“Mara unlocks the deed box by the fire.”) has Mara Venn use the deed box, but Mara Venn no longer has it (handed the deed box over to the court clerk; since Ch 1, Sc 1).'
      ]
    ])
  })

  it('says nothing when the card fetches it first, it is one of many, or no one has it elsewhere', () => {
    const w = world()
    mem.insertChange(w.db, { entryId: w.mara, anchor: 'scene', sceneId: w.s1, kind: 'update', payload: { note: 'handed the deed box over to the court clerk' }, origin: 'text' })
    const cases: [string, string[]][] = [
      ['fetched first', ['Mara fetches the case from the courthouse.', 'Mara opens the case and reads it.']],
      ['got back', ['Mara gets the deed box back from the clerk.', 'Mara unlocks the deed box.']],
      ['one of many', ['Mara opens a bottle and pours.']],
      ['a thing no one left anywhere', ['Mara reads the ledger by the fire.']]
    ]
    for (const [why, beats] of cases) expect(texts(w.at({ povId: w.mara, presentIds: [], locationId: w.gull, when: 'Day 4, morning', beats })), why).toEqual([])
  })
})

describe('the card check: time and ages', () => {
  it('finds a When earlier than the scene before that doesn’t say it goes back, never a flashback', () => {
    const w = world()
    expect(texts(w.at({ povId: w.mara, presentIds: [], locationId: w.gull, when: 'Day 2, morning', beats: [] }))).toEqual([
      'This card’s When (“Day 2, morning”) is earlier than Ch 1, Sc 2 (Day 3 · evening), the scene before it, and the card doesn’t say the scene goes back in time.'
    ])
    expect(texts(w.at({ povId: w.mara, presentIds: [], locationId: w.gull, when: 'Flashback: Day 2, morning', beats: [] }))).toEqual([])
    expect(texts(w.at({ povId: w.mara, presentIds: [], locationId: w.gull, when: 'Day 4', beats: [] }))).toEqual([])
  })

  it('finds an age on the card that contradicts the entry, and not one that fits', () => {
    const w = world()
    const found = cardCheck(w.at({ povId: w.mara, presentIds: [w.tobin], locationId: w.gull, when: 'Day 4', beats: [], notes: 'Tobin, 17, keeps the fire going.' }))
    expect(found.map((f) => [f.kind, f.entryId])).toEqual([['age', w.tobin]])
    expect(found[0].text).toMatch(/^This card says Tobin is 17, but Tobin’s entry says 45/)
    expect(texts(w.at({ povId: w.mara, presentIds: [w.tobin], locationId: w.gull, when: 'Day 4', beats: [], notes: 'Tobin, 45, keeps the fire going.' }))).toEqual([])
  })
})

describe('the card check’s notes', () => {
  it('reach the planner as "Before writing, note: …" lines under their own heading', () => {
    const w = world()
    const notes = cardNoteLines(cardCheck(w.at({ povId: w.mara, presentIds: [], locationId: w.gull, when: 'Day 2, morning', beats: [] })))
    expect(notes).toHaveLength(1)
    expect(notes[0].startsWith(`${CARD_NOTE} This card’s When`)).toBe(true)
    const m: PlanMaterial = {
      ask: 'A whole scene.',
      card: 'Point of view: Mara Venn',
      must: '',
      reach: 'none',
      stand: '',
      standTitle: 'Where things stand',
      standNote: '',
      before: null,
      inBriefing: [],
      others: [],
      people: ['Mara Venn'],
      secrets: [],
      calls: '',
      core: { people: [], recent: [], threads: [], notes }
    }
    const user = planMessages(m)[1].content as string
    expect(user).toContain(`## ${CARD_NOTES_TITLE}\n- ${notes[0]}`)
    expect(user.indexOf(CARD_NOTES_TITLE)).toBeLessThan(user.indexOf('## What is being written'))
  })

  it('never name what Adam kept out of the scene’s briefing', () => {
    const w = world()
    mem.insertChange(w.db, { entryId: w.tobin, anchor: 'scene', sceneId: w.s2, kind: 'update', payload: { note: 'died in the fire' }, origin: 'text' })
    expect(texts(w.at({ povId: w.mara, presentIds: [w.tobin], locationId: w.gull, when: 'Day 4, morning', beats: [] }, { hidden: new Set([w.tobin]) }))).toEqual([])
  })
})
