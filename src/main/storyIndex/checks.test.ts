// The story index's free checks: someone in two places at the very same moment, and someone on a scene card after the
// memory is sure they died. Each says nothing where the record is unsure. Invented worlds, made in memory.
import type Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import type { ID, SceneCard } from '@shared/types'
import { memoryWorld } from '../../../tests/unit/helpers'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import { buildStoryIndex, indexChecks } from '.'

type DB = Database.Database

/** A story of one chapter with a scene for each card given (words included), and its cast and places. */
function world(scenes: { card: Partial<SceneCard>; text?: string }[] = []) {
  const db = memoryWorld()
  const story = repo.listStories(db)[0]
  const o = repo.getOutline(db, story.id)
  const ch = o.chapters[0].id
  const mara = repo.createEntry(db, 'character', { name: 'Mara' }).id
  const tobin = repo.createEntry(db, 'character', { name: 'Tobin' }).id
  const ash = repo.createEntry(db, 'character', { name: 'Ash' }).id
  const swan = repo.createEntry(db, 'place', { name: 'The Swan' }).id
  const back = repo.createEntry(db, 'place', { name: 'The back room', parentId: swan }).id
  const market = repo.createEntry(db, 'place', { name: 'The Market' }).id
  const ids: ID[] = [o.scenes[0].id]
  while (ids.length < scenes.length) ids.push(repo.createScene(db, ch, {}).id)
  return { db, storyId: story.id, ids, mara, tobin, ash, swan, back, market }
}

function fill(db: DB, ids: ID[], scenes: { card: Partial<SceneCard>; text?: string }[]): void {
  scenes.forEach((s, i) => {
    repo.saveSceneText(db, ids[i], null, s.text ?? 'They waited.')
    repo.updateSceneCard(db, ids[i], { ...repo.getScene(db, ids[i]).card, ...s.card })
  })
}

describe('someone in two places at the same moment', () => {
  it('is found when both cards give the same day and clock time, in places apart, and a card has them there', () => {
    const w = world([{ card: {} }, { card: {} }])
    // A thing on both cards is no one.
    const letter = repo.createEntry(w.db, 'item', { name: 'The Letter' }).id
    fill(w.db, w.ids, [
      { card: { povId: w.mara, presentIds: [letter], locationId: w.swan, when: 'Day 1, 9pm' } },
      { card: { povId: w.ash, presentIds: [w.mara, letter], locationId: w.market, when: 'Day 1, 9pm' } }
    ])
    buildStoryIndex(w.db, w.storyId)
    expect(indexChecks(w.db, w.storyId)).toEqual([
      {
        check: 'same-moment',
        sceneId: w.ids[1],
        otherSceneId: w.ids[0],
        entryId: w.mara,
        message: expect.stringMatching(
          /^Mara is at The Market in Ch 1, Sc 2 and at The Swan in Ch 1, Sc 1, at the same moment \(Day 1.*9pm\)\.$/
        )
      }
    ])
  })

  it('says nothing where the cards leave room: a time of day, a When that leans on the scene before, a place inside the other, a dream, another day, or someone only named', () => {
    const cases: [string, Partial<SceneCard>, Partial<SceneCard>, string?][] = [
      ['times of day', { when: 'Day 1, evening' }, { when: 'Day 1, evening' }],
      ['leans on the scene before', { when: 'Day 1, 9pm' }, { when: 'Later that day, 9pm' }],
      ['goes back', { when: 'Day 1, 9pm' }, { when: 'Earlier: Day 1, 9pm' }],
      ['another day', { when: 'Day 1, 9pm' }, { when: 'Day 2, 9pm' }],
      ['a dream', { when: 'Day 1, 9pm' }, { when: 'Day 1, 9pm', notes: 'Mara dreams she is at the market.' }]
    ]
    for (const [why, a, b] of cases) {
      const w = world([{ card: {} }, { card: {} }])
      fill(w.db, w.ids, [
        { card: { povId: w.mara, locationId: w.swan, ...a } },
        { card: { povId: w.ash, presentIds: [w.mara], locationId: w.market, ...b } }
      ])
      buildStoryIndex(w.db, w.storyId)
      expect(indexChecks(w.db, w.storyId), why).toEqual([])
    }
    // The back room is inside the Swan.
    const inside = world([{ card: {} }, { card: {} }])
    fill(inside.db, inside.ids, [
      { card: { povId: inside.mara, locationId: inside.swan, when: 'Day 1, 9pm' } },
      { card: { povId: inside.ash, presentIds: [inside.mara], locationId: inside.back, when: 'Day 1, 9pm' } }
    ])
    buildStoryIndex(inside.db, inside.storyId)
    expect(indexChecks(inside.db, inside.storyId)).toEqual([])
    // Tobin is named as there in both scenes' words, but no card has him: not enough.
    const named = world([{ card: {} }, { card: {} }])
    fill(named.db, named.ids, [
      { card: { povId: named.mara, locationId: named.swan, when: 'Day 1, 9pm' }, text: 'Tobin poured the wine.' },
      { card: { povId: named.ash, locationId: named.market, when: 'Day 1, 9pm' }, text: 'Tobin haggled over the price of eggs.' }
    ])
    buildStoryIndex(named.db, named.storyId)
    expect(indexChecks(named.db, named.storyId)).toEqual([])
  })
})

describe('someone on a scene card after they died', () => {
  it('is found from the scene after the memory is sure of the death, until a note says they live', () => {
    const w = world(Array.from({ length: 6 }, () => ({ card: {} })))
    fill(w.db, w.ids, [
      { card: { povId: w.tobin, when: 'Day 1' } },
      { card: { povId: w.mara, presentIds: [w.tobin], when: 'Day 2' }, text: 'The fire took the east wing.' },
      { card: { povId: w.mara, presentIds: [w.tobin], when: 'Day 3' } },
      { card: { povId: w.mara, when: 'Day 4' }, text: 'They buried Tobin under the oak.' },
      { card: { povId: w.mara, presentIds: [w.tobin], when: 'Day 5' } },
      { card: { povId: w.tobin, when: 'Day 6' } }
    ])
    // Told twice, one death.
    mem.insertChange(w.db, {
      entryId: w.tobin,
      anchor: 'scene',
      sceneId: w.ids[1],
      kind: 'update',
      payload: { note: 'died in the fire' },
      origin: 'text'
    })
    mem.insertChange(w.db, {
      entryId: w.tobin,
      anchor: 'scene',
      sceneId: w.ids[1],
      kind: 'update',
      payload: { note: 'was killed by a falling beam' },
      origin: 'text'
    })
    mem.insertChange(w.db, {
      entryId: w.tobin,
      anchor: 'scene',
      sceneId: w.ids[4],
      kind: 'update',
      payload: { note: 'survived the fire after all' },
      origin: 'text'
    })
    buildStoryIndex(w.db, w.storyId)
    // Scene 3 has him on its card; scene 4 only names him (a burial); from scene 5 he lives again.
    expect(indexChecks(w.db, w.storyId)).toEqual([
      {
        check: 'after-death',
        sceneId: w.ids[2],
        otherSceneId: w.ids[1],
        entryId: w.tobin,
        message: 'Tobin died in Ch 1, Sc 2, but the scene card of Ch 1, Sc 3 has Tobin there.'
      }
    ])
  })

  it('says nothing of a death in doubt, a dream or a flashback, or a scene the calendar puts before the death', () => {
    const w = world(Array.from({ length: 5 }, () => ({ card: {} })))
    fill(w.db, w.ids, [
      { card: { povId: w.mara, when: 'Day 3' } },
      { card: { povId: w.mara, presentIds: [w.tobin], when: 'Day 4', notes: 'Mara dreams of Tobin.' } },
      { card: { povId: w.tobin, when: 'Years earlier' } },
      { card: { povId: w.tobin, when: 'Day 2' } },
      { card: { povId: w.mara, presentIds: [w.ash], when: 'Day 5' } }
    ])
    mem.insertChange(w.db, {
      entryId: w.tobin,
      anchor: 'scene',
      sceneId: w.ids[0],
      kind: 'update',
      payload: { note: 'died in the fire' },
      origin: 'text'
    })
    mem.insertChange(w.db, {
      entryId: w.ash,
      anchor: 'scene',
      sceneId: w.ids[0],
      kind: 'update',
      payload: { note: 'presumed dead' },
      origin: 'text'
    })
    buildStoryIndex(w.db, w.storyId)
    expect(indexChecks(w.db, w.storyId)).toEqual([])
  })
})
