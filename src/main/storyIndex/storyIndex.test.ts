// The story index (overhaul phase 1): built with no AI call from the scene cards, the names in the words, the memory's
// changes, where things stand and the summaries; facts dated from the scene they start in to the scene a later one stops
// them in; built again only when what a scene is built from changes; and the look-ups. Worlds are made in memory with
// invented words; where things stand is kept as the stage tracker keeps it (read from each scene's words as they are).
import { describe, expect, it } from 'vitest'
import type { ID } from '@shared/types'
import { memoryWorld } from '../../../tests/unit/helpers'
import { keepStages, person, setCard, stage } from '../../../tests/unit/storyIndexWorld'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import * as sidx from '../db/storyIndex'
import { keepCalled } from '../db/called'
import { editState } from '../continuity/tracker'
import { buildStoryIndex, lastSeen, openThreads, presentAt, refreshSceneIndex, sceneGists, stateOf, timeline, whoKnows } from '.'

/**
 * A story of two chapters and five scenes: Mara and Tobin at the inn, Ash only thought of; Ash at the market; the seal
 * goes missing; Mara learns who took it; Tobin dies; Mara later forgets.
 */
function world() {
  const db = memoryWorld()
  const story = repo.listStories(db)[0]
  const o = repo.getOutline(db, story.id)
  const ch1 = o.chapters[0].id
  const ch2 = repo.createChapter(db, story.id, { title: 'Two' }).id
  const s1 = o.scenes[0].id
  const s2 = repo.createScene(db, ch1, { title: 'Market' }).id
  const s3 = repo.createScene(db, ch1, { title: 'Seal' }).id
  const s4 = repo.createScene(db, ch2, { title: 'Fire' }).id
  const s5 = repo.createScene(db, ch2, { title: 'After' }).id
  const mara = repo.createEntry(db, 'character', { name: 'Mara Venn', aliases: ['the Captain'] }).id
  const tobin = repo.createEntry(db, 'character', { name: 'Tobin' }).id
  const ash = repo.createEntry(db, 'character', { name: 'Ash' }).id
  const inn = repo.createEntry(db, 'place', { name: 'The Swan' }).id
  const market = repo.createEntry(db, 'place', { name: 'The Market' }).id
  const seal = repo.createEntry(db, 'thread', { name: 'The stolen seal' }).id
  const letter = repo.createEntry(db, 'item', { name: 'The Letter' }).id

  const write = (id: ID, text: string): void => {
    repo.saveSceneText(db, id, null, text)
  }
  write(s1, 'Mara set the lantern on the table. Tobin watched her from the hearth.\n\nShe thought of Ash, far away in the capital.')
  write(s2, 'Ash came in out of the rain, and the Captain bought bread.\n\nShe kept The Letter close.')
  write(s3, 'Mara found the strongbox empty. Tobin swore the seal had been there at dawn.')
  write(s4, 'The fire took the east wing. Tobin did not come out.')
  write(s5, 'Mara walked the ruins alone, and could not say why she had come.')
  setCard(db, s1, { povId: mara, presentIds: [tobin], locationId: inn, when: 'Day 1, 9pm' })
  setCard(db, s2, { povId: mara, presentIds: [], locationId: market, when: 'Day 2, morning' })
  setCard(db, s3, { povId: mara, presentIds: [tobin], locationId: inn, when: 'Day 2, evening', setsUpIds: [seal] })
  setCard(db, s4, { povId: tobin, presentIds: [], locationId: inn, when: 'Day 3, night' })
  setCard(db, s5, { povId: mara, presentIds: [], locationId: inn, when: 'Day 9' })
  mem.putSummary(db, { level: 'scene', targetId: s1, text: 'Mara and Tobin wait out the night at the Swan.', origin: 'text' })
  mem.putSummary(db, { level: 'scene', targetId: s3, text: 'The seal is gone from the strongbox.', origin: 'text' })

  const heir = mem.insertChange(db, {
    entryId: mara,
    anchor: 'scene',
    sceneId: s3,
    kind: 'knowledge',
    payload: { factId: 'f-heir', fact: 'Tobin took the seal', there: [mara, tobin] },
    origin: 'text'
  })
  mem.insertChange(db, {
    entryId: seal,
    anchor: 'scene',
    sceneId: s3,
    kind: 'thread',
    payload: { status: 'open', note: 'The seal is missing' },
    origin: 'text'
  })
  mem.insertChange(db, {
    entryId: tobin,
    anchor: 'scene',
    sceneId: s4,
    kind: 'update',
    payload: { note: 'died in the fire' },
    origin: 'text'
  })
  mem.insertChange(db, {
    entryId: mara,
    anchor: 'scene',
    sceneId: s5,
    kind: 'knowledge',
    payload: { factId: 'f-heir', fact: 'Tobin took the seal', forgets: true },
    origin: 'text'
  })
  mem.insertChange(db, {
    entryId: mara,
    anchor: 'scene',
    sceneId: s2,
    kind: 'relationship',
    payload: { otherId: tobin, type: 'old friends', feels: 'wary of him', otherFeels: '' },
    origin: 'text'
  })

  keepStages(db, {
    [s1]: stage(
      s1,
      [person('Mara Venn', { where: 'by the hearth', holding: 'a lantern', clothes: [{ name: 'grey coat', state: 'on' }] })],
      {
        'mara venn|where': 'from the hearth',
        'mara venn|holding': 'set the lantern',
        'mara venn|clothes:grey coat': 'Mara set the lantern'
      }
    ),
    [s2]: stage(
      s2,
      [
        person('Mara Venn', { where: 'at the bread stall', holding: 'a lantern', clothes: [{ name: 'grey coat', state: 'on' }] }),
        person('Ash', { where: 'in the doorway' })
      ],
      { 'mara venn|where': 'bought bread', 'ash|where': 'came in out of the rain' }
    ),
    [s3]: stage(
      s3,
      [
        person('Mara Venn', {
          where: 'by the strongbox',
          holding: '',
          clothes: [
            { name: 'grey coat', state: 'off, on the chair' },
            { name: 'red cloak', state: 'on' }
          ]
        })
      ],
      {
        'mara venn|where': 'found the strongbox',
        'mara venn|clothes:red cloak': 'found the strongbox empty',
        'mara venn|clothes:grey coat': 'found the strongbox'
      }
    )
  })
  return { db, storyId: story.id, ch1, ch2, s1, s2, s3, s4, s5, mara, tobin, ash, inn, market, seal, letter, heir }
}

describe('building the story index for free', () => {
  it('gives each scene its place in the story, who is there, who is only named, the place, the When and the gist', () => {
    const w = world()
    const b = buildStoryIndex(w.db, w.storyId)
    expect(b).toMatchObject({ scenes: 5, built: 5, dropped: 0 })
    const rows = sidx.indexScenes(w.db, w.storyId)
    expect(rows.map((r) => [r.position, r.label])).toEqual([
      [1, 'Ch 1, Sc 1'],
      [2, 'Ch 1, Sc 2'],
      [3, 'Ch 1, Sc 3'],
      [4, 'Ch 2, Sc 1'],
      [5, 'Ch 2, Sc 2']
    ])
    const [one, two, three] = rows
    // The card's people are there; Ash is only thought of.
    expect(one.present).toEqual([w.mara, w.tobin])
    expect(one.mentioned).toEqual([w.ash])
    expect(one).toMatchObject({
      placeEntryId: w.inn,
      whenText: 'Day 1, 9pm',
      gist: 'Mara and Tobin wait out the night at the Swan.',
      filled: 'free'
    })
    // Ash comes in (named as there); Mara is found by another name; the letter is a thing named; the card's place isn't "named".
    expect(two.present).toEqual(expect.arrayContaining([w.mara, w.ash]))
    expect(two.mentioned).toEqual([w.letter])
    expect(two.gist).toBe('')
    // The memory saw Tobin there when Mara learned it (and the card has him too).
    expect(three.present).toEqual(expect.arrayContaining([w.mara, w.tobin]))
  })

  it('finds someone by what this scene’s words call them', () => {
    const w = world()
    repo.saveSceneText(w.db, w.s5, null, 'The old soldier walked the ruins alone.')
    keepCalled(w.db, w.s5, [{ entryId: w.tobin, words: 'the old soldier' }])
    setCard(w.db, w.s5, { povId: null, presentIds: [] })
    buildStoryIndex(w.db, w.storyId)
    expect(sidx.indexScene(w.db, w.s5)?.present).toEqual([w.tobin])
  })

  it('keeps dated facts from the card, the memory and where things stand, each from the scene it starts in', () => {
    const w = world()
    buildStoryIndex(w.db, w.storyId)
    const facts = sidx.storyFactsInOrder(w.db, w.storyId)
    const of = (kind: string, slot?: string) =>
      facts.filter((f) => f.kind === kind && f.entryId === w.mara && (slot === undefined || f.slot === slot))
    // Where: the stage's words and the card's place, each its own run.
    expect(of('where', '').map((f) => [f.value, f.fromLabel, f.untilLabel, f.origin, f.quote])).toEqual([
      ['by the hearth', 'Ch 1, Sc 1', 'Ch 1, Sc 2', 'tracker', 'from the hearth'],
      ['at the bread stall', 'Ch 1, Sc 2', 'Ch 1, Sc 3', 'tracker', 'bought bread'],
      ['by the strongbox', 'Ch 1, Sc 3', null, 'tracker', 'found the strongbox']
    ])
    expect(of('where', 'card').map((f) => [f.value, f.fromLabel, f.untilLabel, f.origin])).toEqual([
      ['The Swan', 'Ch 1, Sc 1', 'Ch 1, Sc 2', 'card'],
      ['The Market', 'Ch 1, Sc 2', 'Ch 1, Sc 3', 'card'],
      ['The Swan', 'Ch 1, Sc 3', null, 'card'],
      ['The Swan', 'Ch 2, Sc 2', null, 'card']
    ])
    // The lantern carried until she puts it down; the grey coat until she takes it off; the cloak from then on.
    expect(of('carrying').map((f) => [f.value, f.fromLabel, f.untilLabel])).toEqual([
      ['a lantern', 'Ch 1, Sc 1', 'Ch 1, Sc 3'],
      ['', 'Ch 1, Sc 3', null]
    ])
    expect(of('wearing').map((f) => [f.slot, f.value, f.fromLabel, f.untilLabel])).toEqual([
      ['grey coat', 'grey coat', 'Ch 1, Sc 1', 'Ch 1, Sc 3'],
      ['grey coat', '', 'Ch 1, Sc 3', null],
      ['red cloak', 'red cloak', 'Ch 1, Sc 3', null]
    ])
    // What she learns, until she forgets it; the relationship; Tobin's death.
    expect(of('knows').map((f) => [f.value, f.fromLabel, f.untilLabel, f.origin])).toEqual([
      ['Tobin took the seal', 'Ch 1, Sc 3', 'Ch 2, Sc 2', 'memory'],
      ['', 'Ch 2, Sc 2', null, 'memory']
    ])
    expect(of('relationship').map((f) => [f.slot, f.value])).toEqual([[`with:${w.tobin}`, 'old friends; Mara Venn feels wary of him']])
    expect(facts.filter((f) => f.kind === 'status' && f.entryId === w.tobin).map((f) => [f.slot, f.value, f.fromLabel])).toEqual([
      ['life', 'dead', 'Ch 2, Sc 1']
    ])
    // A thread opened by the memory and set up on the card: one event.
    expect(sidx.threadEventsUpTo(w.db, w.storyId, 99).map((e) => [e.threadEntryId, e.event, e.note, e.label])).toEqual([
      [w.seal, 'opened', 'The seal is missing', 'Ch 1, Sc 3']
    ])
  })

  it('takes Adam’s Recall edits as his, and never starts a fact from a value carried from another scene’s words', () => {
    const w = world()
    // Scene 2's state carries a value whose words are in scene 1 but which differs from scene 1's kept state (a ghost).
    const ghost = stage(
      w.s2,
      [person('Mara Venn', { where: 'at the bread stall', holding: 'a basket', clothes: [{ name: 'grey coat', state: 'on' }] })],
      {
        'mara venn|where': 'bought bread'
      }
    )
    ghost.said!['mara venn|holding'] = { quote: 'set the lantern', sceneId: w.s1 }
    keepStages(w.db, { [w.s2]: ghost })
    // Scene 4: Adam sets where Tobin is by hand (Recall), with nothing read from its words.
    expect(editState(w.db, w.s4, (e) => (e.characters = { tobin: { name: 'Tobin', where: 'the east wing' } }))).toBe(true)
    buildStoryIndex(w.db, w.storyId)
    const facts = sidx.storyFactsInOrder(w.db, w.storyId)
    expect(facts.some((f) => f.kind === 'carrying' && f.value === 'a basket')).toBe(false)
    expect(facts.find((f) => f.kind === 'where' && f.entryId === w.tobin && f.slot === '')).toMatchObject({
      value: 'the east wing',
      origin: 'hand',
      fromSceneId: w.s4
    })
  })

  it('builds a scene again only when what it is built from changes, and keeps places and ends in step', () => {
    const w = world()
    buildStoryIndex(w.db, w.storyId)
    expect(buildStoryIndex(w.db, w.storyId)).toMatchObject({ built: 0 })
    const before = sidx.indexScene(w.db, w.s1)!
    // New words in scene 4: only it is built again (no scene after it has a stage).
    repo.saveSceneText(w.db, w.s4, null, 'The fire took the east wing. Ash pulled Tobin out, but too late.')
    expect(refreshSceneIndex(w.db, w.s4)).toMatchObject({ built: 1 })
    expect(sidx.indexScene(w.db, w.s4)?.present).toEqual(expect.arrayContaining([w.tobin, w.ash]))
    expect(sidx.indexScene(w.db, w.s1)?.updatedAt).toBe(before.updatedAt)
    // A summary written for scene 2: built again by the next build.
    mem.putSummary(w.db, { level: 'scene', targetId: w.s2, text: 'Ash comes in from the rain.', origin: 'text' })
    expect(buildStoryIndex(w.db, w.storyId)).toMatchObject({ built: 1 })
    expect(sidx.indexScene(w.db, w.s2)?.gist).toBe('Ash comes in from the rain.')
    // Scene 3 moves to the front of chapter 1: places and labels follow, and so do the facts' ends.
    repo.moveScene(w.db, w.s3, w.ch1, 0)
    buildStoryIndex(w.db, w.storyId)
    expect(sidx.indexScenes(w.db, w.storyId).map((s) => s.sceneId)).toEqual([w.s3, w.s1, w.s2, w.s4, w.s5])
    expect(sidx.indexScene(w.db, w.s3)?.label).toBe('Ch 1, Sc 1')
    // Read in the new order: the cloak (scene 3's) is on from the first scene, the coat from the second.
    expect(stateOf(w.db, w.storyId, w.mara, w.s2)!.wearing.map((x) => [x.value, x.since])).toEqual([
      ['red cloak', 'Ch 1, Sc 1'],
      ['grey coat', 'Ch 1, Sc 2']
    ])
  })

  it('stops a fact where the memory says it stops (“true until”), and builds again when that changes', () => {
    const w = world()
    buildStoryIndex(w.db, w.storyId)
    mem.setChangeUntil(
      w.db,
      w.heir.id,
      { sceneId: w.s4, when: '', origin: 'text', quote: 'did not come out', paragraphId: null },
      { origin: 'text' }
    )
    buildStoryIndex(w.db, w.storyId)
    const knows = sidx.storyFactsInOrder(w.db, w.storyId).filter((f) => f.kind === 'knows')
    expect(knows.map((f) => [f.value, f.fromLabel, f.untilLabel])).toEqual([
      ['Tobin took the seal', 'Ch 1, Sc 3', 'Ch 2, Sc 1'],
      ['', 'Ch 2, Sc 1', null],
      ['', 'Ch 2, Sc 2', null]
    ])
  })

  it('takes a deleted scene out, with the facts it made', () => {
    const w = world()
    buildStoryIndex(w.db, w.storyId)
    repo.deleteScene(w.db, w.s3)
    const r = refreshSceneIndex(w.db, w.s3)
    expect(r).toMatchObject({ dropped: 1, scenes: 4 })
    expect(sidx.indexScene(w.db, w.s3)).toBeNull()
    expect(sidx.storyFactsInOrder(w.db, w.storyId).some((f) => f.sourceSceneId === w.s3)).toBe(false)
    // Scene 4 is now third: the grey coat (taken off in the deleted scene) is worn again until the end.
    expect(sidx.indexScene(w.db, w.s4)).toMatchObject({ position: 3, label: 'Ch 2, Sc 1' })
    expect(stateOf(w.db, w.storyId, 'Mara Venn', w.s5)?.wearing.map((x) => x.value)).toEqual(['grey coat'])
  })

  it('counts whoever the memory or the stage saw there as there, though the words never name them', () => {
    const w = world()
    repo.saveSceneText(w.db, w.s5, null, 'Someone spoke from the dark: the seal was never stolen.')
    setCard(w.db, w.s5, { povId: w.mara, presentIds: [] })
    mem.insertChange(w.db, {
      entryId: w.mara,
      anchor: 'scene',
      sceneId: w.s5,
      kind: 'knowledge',
      payload: { factId: 'f-never', fact: 'The seal was never stolen', there: [w.mara, w.ash] },
      origin: 'text'
    })
    keepStages(w.db, { [w.s5]: stage(w.s5, [person('Tobin', { where: 'in the dark' })], { 'tobin|where': 'from the dark' }) })
    buildStoryIndex(w.db, w.storyId)
    expect(sidx.indexScene(w.db, w.s5)?.present).toEqual([w.mara, w.ash, w.tobin])
  })

  it('never keeps a wrong belief as known, nor takes a piece of clothing as off when it is only no longer listed', () => {
    const w = world()
    mem.insertChange(w.db, {
      entryId: w.tobin,
      anchor: 'scene',
      sceneId: w.s3,
      kind: 'knowledge',
      payload: { factId: 'f-ash', fact: 'Ash took the seal', wrong: true },
      origin: 'text'
    })
    keepStages(w.db, { [w.s4]: stage(w.s4, [person('Mara Venn', { where: 'by the strongbox', clothes: [] })], {}) })
    buildStoryIndex(w.db, w.storyId)
    expect(whoKnows(w.db, w.storyId, 'Ash took the seal', w.s5).facts).toEqual([])
    expect(stateOf(w.db, w.storyId, w.mara, w.s4)!.wearing.map((x) => x.value)).toEqual(['red cloak'])
  })

  it('builds the next scene with a stage again when a scene’s own stage changes (its facts are told against it)', () => {
    const w = world()
    buildStoryIndex(w.db, w.storyId)
    keepStages(w.db, {
      [w.s2]: stage(
        w.s2,
        [person('Mara Venn', { where: 'at the bread stall', holding: 'a lantern', clothes: [{ name: 'red cloak', state: 'on' }] })],
        {
          'mara venn|where': 'bought bread',
          'mara venn|clothes:red cloak': 'bought bread'
        }
      )
    })
    expect(refreshSceneIndex(w.db, w.s2)).toMatchObject({ built: 2 })
    // The cloak is on from scene 2 now, and scene 3 doesn't start it again.
    const cloak = sidx.storyFactsInOrder(w.db, w.storyId).filter((f) => f.kind === 'wearing' && f.slot === 'red cloak')
    expect(cloak.map((f) => [f.fromLabel, f.untilLabel])).toEqual([['Ch 1, Sc 2', null]])
    expect(stateOf(w.db, w.storyId, w.mara, w.s5)!.wearing.map((x) => [x.value, x.since])).toEqual([['red cloak', 'Ch 1, Sc 2']])
  })
})

describe('looking things up in the story index', () => {
  it('stateOf: where someone is, what they wear and carry, what they know, at any point, with since when', () => {
    const w = world()
    buildStoryIndex(w.db, w.storyId)
    const two = stateOf(w.db, w.storyId, 'mara venn', w.s2)!
    expect(two.place).toMatchObject({ value: 'at the bread stall', since: 'Ch 1, Sc 2' })
    expect(two.wearing.map((x) => [x.value, x.since])).toEqual([['grey coat', 'Ch 1, Sc 1']])
    expect(two.carrying).toMatchObject({ value: 'a lantern', since: 'Ch 1, Sc 1' })
    expect(two.knows).toEqual([])
    expect(two.relationships.map((r) => [r.withName, r.value])).toEqual([['Tobin', 'old friends; Mara Venn feels wary of him']])
    expect(two.lines).toEqual([
      'Mara Venn: at the bread stall (since Ch 1, Sc 2)',
      'Mara Venn: wearing grey coat (since Ch 1, Sc 1)',
      'Mara Venn: carrying a lantern (since Ch 1, Sc 1)',
      'Mara Venn and Tobin: old friends; Mara Venn feels wary of him (since Ch 1, Sc 2)'
    ])
    // As scene 3 begins nothing has changed yet; as it ends the coat is off, the cloak on, the lantern down.
    const begins = stateOf(w.db, w.storyId, w.mara, w.s3, { asItBegins: true })!
    expect(begins.wearing.map((x) => x.value)).toEqual(['grey coat'])
    const ends = stateOf(w.db, w.storyId, 'the Captain', w.s3)!
    expect(ends.wearing.map((x) => [x.value, x.since])).toEqual([['red cloak', 'Ch 1, Sc 3']])
    expect(ends.carrying).toBeNull()
    expect(ends.knows.map((k) => [k.value, k.since, k.quote])).toEqual([['Tobin took the seal', 'Ch 1, Sc 3', '']])
    // The words say more than the card while the card doesn't move her on; once it does (scene 5 at the market), it wins.
    expect(stateOf(w.db, w.storyId, w.mara, w.s5)!.place).toMatchObject({ value: 'by the strongbox', since: 'Ch 1, Sc 3' })
    expect(stateOf(w.db, w.storyId, w.mara, w.s5)!.knows).toEqual([])
    setCard(w.db, w.s5, { locationId: w.market })
    buildStoryIndex(w.db, w.storyId)
    expect(stateOf(w.db, w.storyId, w.mara, w.s5)!.place).toMatchObject({ value: 'The Market', since: 'Ch 2, Sc 2', origin: 'card' })
    expect(stateOf(w.db, w.storyId, w.mara, w.s5)!.lines[0]).toBe('Mara Venn: at The Market (since Ch 2, Sc 2)')
    // Tobin is dead from scene 4.
    expect(stateOf(w.db, w.storyId, 'Tobin', w.s5)!.lines[0]).toBe('Tobin: dead (since Ch 2, Sc 1)')
    expect(stateOf(w.db, w.storyId, 'Nobody', w.s5)).toBeNull()
  })

  it('stateOf: someone with no place of their own is where they were last seen', () => {
    const w = world()
    buildStoryIndex(w.db, w.storyId)
    const ash = stateOf(w.db, w.storyId, 'Ash', w.s3)!
    expect(ash.place).toMatchObject({ value: 'in the doorway', since: 'Ch 1, Sc 2' })
    repo.saveSceneText(w.db, w.s2, null, 'Ash came in out of the rain.')
    buildStoryIndex(w.db, w.storyId)
    // The stage for scene 2 no longer matches its words: Ash is where scene 2's card is.
    expect(stateOf(w.db, w.storyId, 'Ash', w.s3)!.place).toMatchObject({ value: 'The Market', since: 'Ch 1, Sc 2', lastSeen: true })
    expect(stateOf(w.db, w.storyId, 'Ash', w.s3)!.lines).toEqual(['Ash: last seen at The Market (Ch 1, Sc 2)'])
  })

  it('lastSeen, presentAt, sceneGists and timeline', () => {
    const w = world()
    buildStoryIndex(w.db, w.storyId)
    expect(lastSeen(w.db, w.storyId, 'Tobin', w.s3)).toMatchObject({
      sceneId: w.s1,
      line: 'Tobin was last there in Ch 1, Sc 1, at The Swan: Mara and Tobin wait out the night at the Swan.'
    })
    expect(lastSeen(w.db, w.storyId, 'Ash', w.s1)).toBeNull()
    expect(presentAt(w.db, w.s1)).toMatchObject({
      present: [
        { id: w.mara, name: 'Mara Venn' },
        { id: w.tobin, name: 'Tobin' }
      ],
      mentioned: [{ id: w.ash, name: 'Ash' }],
      place: { id: w.inn, name: 'The Swan' },
      lines: ['Ch 1, Sc 1 at The Swan, Day 1, 9pm', 'There: Mara Venn, Tobin', 'Named: Ash']
    })
    expect(sceneGists(w.db, w.storyId, w.s3, w.s1).lines).toEqual([
      'Ch 1, Sc 1: Mara and Tobin wait out the night at the Swan.',
      'Ch 1, Sc 3: The seal is gone from the strongbox.'
    ])
    const t = timeline(w.db, w.storyId, w.s4)
    expect(t.scenes.map((s) => s.when)).toEqual(['Day 1, 9pm', 'Day 2, morning', 'Day 2, evening', 'Day 3, night'])
    expect(t.scenes[0].date).toMatch(/Day 1/)
    expect(t.lines).toHaveLength(4)
  })

  it('whoKnows a fact or a thread, and openThreads', () => {
    const w = world()
    mem.insertChange(w.db, {
      entryId: w.tobin,
      anchor: 'scene',
      sceneId: w.s3,
      kind: 'knowledge',
      payload: { factId: 'f-heir', fact: 'Tobin took the seal' },
      origin: 'text'
    })
    buildStoryIndex(w.db, w.storyId)
    const k = whoKnows(w.db, w.storyId, 'took the seal', w.s3)
    expect(k.facts.map((f) => [f.factId, f.knownBy.map((x) => x.name)])).toEqual([['f-heir', ['Mara Venn', 'Tobin']]])
    expect(k.lines).toEqual(['Tobin took the seal: known by Mara Venn (since Ch 1, Sc 3), Tobin (since Ch 1, Sc 3)'])
    // By the thread's name (its words are in the fact); Mara has forgotten it by the end.
    expect(whoKnows(w.db, w.storyId, 'The stolen seal', w.s5).facts[0]?.knownBy.map((x) => x.name)).toEqual(['Tobin'])
    expect(whoKnows(w.db, w.storyId, 'the weather', w.s5).facts).toEqual([])

    expect(openThreads(w.db, w.storyId, w.s2).threads).toEqual([])
    const open = openThreads(w.db, w.storyId, w.s5)
    expect(open.threads).toMatchObject([
      { threadId: w.seal, name: 'The stolen seal', since: 'Ch 1, Sc 3', quietScenes: 2, note: 'The seal is missing' }
    ])
    expect(open.lines).toEqual(['The stolen seal (open since Ch 1, Sc 3, quiet for 2 scenes): The seal is missing'])
    // Paid off on scene 5's card: closed there.
    setCard(w.db, w.s5, { paysOffIds: [w.seal] })
    buildStoryIndex(w.db, w.storyId)
    expect(openThreads(w.db, w.storyId, w.s4).threads).toHaveLength(1)
    expect(openThreads(w.db, w.storyId, w.s5).threads).toEqual([])
  })
})
