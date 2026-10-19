// Put events in their place (2026-10-19): events earlier builds left at the story's start go to the scene the record says
// they happen in, with one Undo; keeping an outline does the same for its own scenes. Never an event Adam placed by hand
// or made himself, nor one that belongs at the start. Invented stories only; no AI calls.

import { describe, expect, it } from 'vitest'
import type { ID } from '@shared/types'
import { EVENT_OUTLINE, eventWorld, oldBuiltEvent, sceneBefore } from '../../../tests/unit/eventWorld'
import { memoryWorld } from '../../../tests/unit/helpers'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import { replaceExistsPoints } from '../db/entryViews'
import { keepOutline, unkeepOutline } from '../outline/structure'
import { eventHomes, longAgo, moveEvents, namesIn, planTitle, unmoveEvents } from './eventHomes'

type DB = ReturnType<typeof memoryWorld>

/** Puts words on a scene card's goal (what the outline says happens there). */
const say = (db: DB, sceneId: ID, goal: string): void => {
  repo.updateSceneCard(db, sceneId, { ...repo.getScene(db, sceneId).card, goal })
}
const pointsOf = (db: DB, id: ID) => mem.listExistsPoints(db, id).map((p) => ({ kind: p.kind, sceneId: p.sceneId, byHand: p.byHand }))

describe('what the record says', () => {
  it('reads a scene’s title from a line of the story’s plan, old and new', () => {
    expect(planTitle('- Scene The Wreck: The Storm struck.')).toBe('The Wreck')
    expect(planTitle('- Scene 4 (The Wreck): The Storm struck.')).toBe('The Wreck')
    expect(planTitle('- Scene 4: The Storm struck.')).toBeNull()
    expect(planTitle('The Storm struck on Day 4.')).toBeNull()
  })

  it('finds a name as whole words, whatever its case or a leading “the”', () => {
    expect(namesIn('The storm drives the boat onto the reef.', ['The Storm'])).toBe(true)
    expect(namesIn('A brainstorm in the cabin.', ['The Storm'])).toBe(false)
    expect(namesIn('Rain.', ['Th'])).toBe(false)
  })

  it('knows a When that says long ago', () => {
    expect(longAgo('twenty years ago')).toBe(true)
    expect(longAgo('years before the story')).toBe(true)
    expect(longAgo('Day 4')).toBe(false)
    expect(longAgo('')).toBe(false)
  })
})

describe('events earlier builds left at the story’s start', () => {
  it('go to the scene whose card names them, and the timeline shows them right after it', () => {
    const w = eventWorld()
    const storm = oldBuiltEvent(w.db, w.storyId, 'The Storm')
    say(w.db, w.c2s3, 'The storm drives the boat onto the reef.')
    // The pile-up: every such event just after the opening scene.
    expect(sceneBefore(w.db, w.storyId, storm)).toBe(w.c1s1)
    const homes = eventHomes(w.db, w.storyId)
    expect(homes).toEqual([{ entryId: storm, name: 'The Storm', storyId: w.storyId, sceneId: w.c2s3, place: 'Ch 2, Sc 3 “The Wreck”', why: 'card' }])
    // Nothing has changed until it is moved.
    expect(pointsOf(w.db, storm)).toEqual([{ kind: 'world', sceneId: null, byHand: false }])

    const moves = w.db.transaction(() => moveEvents(w.db, homes))()
    expect(moves).toHaveLength(1)
    expect(sceneBefore(w.db, w.storyId, storm)).toBe(w.c2s3)
    expect(pointsOf(w.db, storm)).toEqual([{ kind: 'scene', sceneId: w.c2s3, byHand: false }])
    expect(repo.getEntry(w.db, storm).originSceneId).toBe(w.c2s3)
    // As a build that knew the scene makes it: working the default points out again keeps it there.
    mem.refreshDefaultExistsPoints(w.db)
    expect(pointsOf(w.db, storm)).toEqual([{ kind: 'scene', sceneId: w.c2s3, byHand: false }])
    // And nothing is left to move.
    expect(eventHomes(w.db, w.storyId)).toEqual([])
  })

  it('go where the memory read them in the words before a card that names them', () => {
    const w = eventWorld()
    const fire = oldBuiltEvent(w.db, w.storyId, 'The Fire')
    say(w.db, w.c2s3, 'The fire is still smouldering.')
    const mara = repo.createEntry(w.db, 'character', { name: 'Mara Venn' })
    mem.insertChange(w.db, {
      kind: 'relationship',
      payload: { otherId: fire, type: 'involved in', feels: '', otherFeels: '' },
      entryId: mara.id,
      anchor: 'scene',
      sceneId: w.c2s2,
      origin: 'text'
    })
    expect(eventHomes(w.db, w.storyId)).toEqual([expect.objectContaining({ entryId: fire, sceneId: w.c2s2, why: 'text' })])
  })

  it('go to the scene the build’s own line of the story’s plan names', () => {
    const w = eventWorld()
    const gale = oldBuiltEvent(w.db, w.storyId, 'The Gale', { quote: '- Scene Fog: The Gale began at sea.' })
    const squall = oldBuiltEvent(w.db, w.storyId, 'The Squall', { quote: '- Scene 4 (The Wreck): The Squall began at dusk.' })
    expect(eventHomes(w.db, w.storyId)).toEqual([
      expect.objectContaining({ entryId: gale, sceneId: w.c2s2, why: 'plan' }),
      expect.objectContaining({ entryId: squall, sceneId: w.c2s3, why: 'plan' })
    ])
  })

  it('go to the first scene on or after their day', () => {
    const w = eventWorld()
    const wedding = oldBuiltEvent(w.db, w.storyId, 'The Wedding', { when: 'Day 6' })
    const feast = oldBuiltEvent(w.db, w.storyId, 'The Feast', { when: 'Day 5' })
    const homes = eventHomes(w.db, w.storyId)
    expect(homes.map((h) => [h.name, h.sceneId, h.why])).toEqual([
      ['The Feast', w.c3s1, 'date'],
      ['The Wedding', w.c3s1, 'date']
    ])
    // On the day itself only, when an outline is kept.
    expect(eventHomes(w.db, w.storyId, { exactDay: true }).map((h) => h.entryId)).toEqual([wedding])
    expect(feast).toBeTruthy()
  })

  it('pass over a scene their date disagrees with', () => {
    const w = eventWorld()
    const storm = oldBuiltEvent(w.db, w.storyId, 'The Storm', { when: 'Day 3' })
    // Named on Day 4's card (the wreck it caused), but it happened on Day 3.
    say(w.db, w.c2s3, 'After the storm, the boat breaks up on the reef.')
    expect(eventHomes(w.db, w.storyId)).toEqual([expect.objectContaining({ entryId: storm, sceneId: w.c2s2, why: 'date' })])
  })
})

describe('what stays where it is', () => {
  it('an event Adam placed by hand', () => {
    const w = eventWorld()
    const storm = oldBuiltEvent(w.db, w.storyId, 'The Storm')
    replaceExistsPoints(w.db, storm, [{ kind: 'world', storyId: null, sceneId: null, byHand: true }])
    say(w.db, w.c2s3, 'The storm drives the boat onto the reef.')
    expect(eventHomes(w.db, w.storyId)).toEqual([])
  })

  it('an event Adam made himself', () => {
    const w = eventWorld()
    repo.createEntry(w.db, 'event', { name: 'The Regatta', originStoryId: w.storyId })
    say(w.db, w.c2s3, 'The regatta boats scatter.')
    expect(eventHomes(w.db, w.storyId)).toEqual([])
  })

  it('an event that belongs before the story, however a later card recalls it', () => {
    const w = eventWorld()
    oldBuiltEvent(w.db, w.storyId, 'The Old War', { when: 'twenty years ago' })
    oldBuiltEvent(w.db, w.storyId, 'The Founding', { when: 'Day 0' })
    const flood = oldBuiltEvent(w.db, w.storyId, 'The Great Flood', { when: 'in the year 312' })
    say(w.db, w.c2s3, 'Mara remembers the old war, the founding and the great flood.')
    expect(eventHomes(w.db, w.storyId)).toEqual([])
    // History dated by a year: the timeline shows it ahead of the story, and there it stays.
    expect(sceneBefore(w.db, w.storyId, flood)).toBeNull()
  })

  it('an event whose scene is the opening one: it is shown there already', () => {
    const w = eventWorld()
    oldBuiltEvent(w.db, w.storyId, 'The Homecoming')
    say(w.db, w.c1s1, 'The homecoming is quiet.')
    expect(eventHomes(w.db, w.storyId)).toEqual([])
  })

  it('an event the record says nothing about', () => {
    const w = eventWorld()
    const quiet = oldBuiltEvent(w.db, w.storyId, 'The Quiet Night')
    expect(eventHomes(w.db, w.storyId)).toEqual([])
    expect(sceneBefore(w.db, w.storyId, quiet)).toBe(w.c1s1)
  })

  it('an event of another story', () => {
    const w = eventWorld()
    const other = repo.createStory(w.db, { title: 'Book 2' })
    oldBuiltEvent(w.db, other.id, 'The Storm')
    say(w.db, w.c2s3, 'The storm drives the boat onto the reef.')
    expect(eventHomes(w.db, w.storyId)).toEqual([])
  })
})

describe('Undo', () => {
  it('puts every event back where it was with one Undo, and the timeline with it', () => {
    const w = eventWorld()
    const storm = oldBuiltEvent(w.db, w.storyId, 'The Storm')
    const wedding = oldBuiltEvent(w.db, w.storyId, 'The Wedding', { when: 'Day 6' })
    say(w.db, w.c2s3, 'The storm drives the boat onto the reef.')
    const moves = w.db.transaction(() => moveEvents(w.db, eventHomes(w.db, w.storyId)))()
    expect(moves.map((m) => m.entryId).sort()).toEqual([storm, wedding].sort())
    expect(sceneBefore(w.db, w.storyId, storm)).toBe(w.c2s3)

    // As the window hands it back (JSON), one Undo.
    const back = w.db.transaction(() => unmoveEvents(w.db, JSON.parse(JSON.stringify(moves))))()
    expect(back.sort()).toEqual([storm, wedding].sort())
    for (const id of [storm, wedding]) {
      expect(pointsOf(w.db, id)).toEqual([{ kind: 'world', sceneId: null, byHand: false }])
      expect(repo.getEntry(w.db, id).originSceneId).toBeNull()
    }
    expect(sceneBefore(w.db, w.storyId, storm)).toBe(w.c1s1)
    // And the offer is there again.
    expect(eventHomes(w.db, w.storyId)).toHaveLength(2)
  })

  it('leaves an event Adam has placed by hand since, and ignores what isn’t a move', () => {
    const w = eventWorld()
    const storm = oldBuiltEvent(w.db, w.storyId, 'The Storm')
    say(w.db, w.c2s3, 'The storm drives the boat onto the reef.')
    const moves = moveEvents(w.db, eventHomes(w.db, w.storyId))
    replaceExistsPoints(w.db, storm, [{ kind: 'scene', storyId: w.storyId, sceneId: w.c3s1, byHand: true }])
    expect(unmoveEvents(w.db, [...moves, null, { entryId: 'x' }, 'nonsense'])).toEqual([])
    expect(pointsOf(w.db, storm)).toEqual([{ kind: 'scene', sceneId: w.c3s1, byHand: true }])
  })
})

describe('keeping an outline', () => {
  it('puts the story’s waiting events in the kept scene that names them or is on their day; its Undo puts them back', () => {
    const db = memoryWorld()
    const storyId = repo.listStories(db)[0].id
    // The Story builder lays the events out first, before the outline has any scenes for them.
    const storm = oldBuiltEvent(db, storyId, 'The Storm')
    const wedding = oldBuiltEvent(db, storyId, 'The Wedding', { when: 'Day 6' })
    const feast = oldBuiltEvent(db, storyId, 'The Feast', { when: 'Day 5' })
    const outline = EVENT_OUTLINE.map((k) => (k.key === 's23' ? { ...k, text: 'The Storm drives the boat onto the reef.' } : k))
    const kept = keepOutline(db, storyId, outline)
    const o = repo.getOutline(db, storyId)
    const [c1s1, , , c2s3, c3s1] = o.scenes.map((s) => s.id)
    expect(kept.find((k) => k.id === c2s3)?.events?.map((m) => m.name)).toEqual(['The Storm'])
    expect(kept.find((k) => k.id === c3s1)?.events?.map((m) => m.name)).toEqual(['The Wedding'])
    expect(sceneBefore(db, storyId, storm)).toBe(c2s3)
    expect(sceneBefore(db, storyId, wedding)).toBe(c3s1)
    // No scene is on Day 5: the Feast waits (Put events in their place can offer the next day's scene).
    expect(pointsOf(db, feast)).toEqual([{ kind: 'world', sceneId: null, byHand: false }])

    unkeepOutline(db, JSON.parse(JSON.stringify(kept)))
    for (const id of [storm, wedding]) expect(pointsOf(db, id)).toEqual([{ kind: 'world', sceneId: null, byHand: false }])
    expect(repo.getEntry(db, storm).originSceneId).toBeNull()
    expect(c1s1).toBeTruthy()
  })

  it('moves an event only into the scenes it keeps', () => {
    const db = memoryWorld()
    const storyId = repo.listStories(db)[0].id
    const wedding = oldBuiltEvent(db, storyId, 'The Wedding', { when: 'Day 6' })
    const first = keepOutline(db, storyId, EVENT_OUTLINE.slice(0, 6))
    expect(first.some((k) => k.events?.length)).toBe(false)
    const later = keepOutline(db, storyId, EVENT_OUTLINE.slice(6))
    const home = repo.getOutline(db, storyId).scenes.at(-1)!.id
    expect(later.find((k) => k.id === home)?.events?.map((m) => m.entryId)).toEqual([wedding])
    expect(sceneBefore(db, storyId, wedding)).toBe(home)
  })

  it('leaves an event Adam placed by hand, or made himself, where it is', () => {
    const db = memoryWorld()
    const storyId = repo.listStories(db)[0].id
    const storm = oldBuiltEvent(db, storyId, 'The Storm')
    replaceExistsPoints(db, storm, [{ kind: 'world', storyId: null, sceneId: null, byHand: true }])
    const mine = repo.createEntry(db, 'event', { name: 'The Wedding', fields: { when: 'Day 6' }, originStoryId: storyId })
    const kept = keepOutline(
      db,
      storyId,
      EVENT_OUTLINE.map((k) => (k.key === 's23' ? { ...k, text: 'The Storm drives the boat onto the reef.' } : k))
    )
    expect(kept.some((k) => k.events?.length)).toBe(false)
    expect(pointsOf(db, storm)).toEqual([{ kind: 'world', sceneId: null, byHand: true }])
    expect(mem.listExistsPoints(db, mine.id).map((p) => p.kind)).toEqual(['world'])
  })
})
