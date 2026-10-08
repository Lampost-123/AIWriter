// The desk's story board (UI overhaul, D5.2): each scene's card in a story in one call, and the board's AI-idea marks.
import { describe, expect, it } from 'vitest'
import { emptySceneCard } from '@shared/defaults'
import * as repo from './repo'
import { markAiIdea, readBoardMarks, storySceneCards } from './worldViews'
import { memoryWorld } from '../../../tests/unit/helpers'

describe('listSceneCards', () => {
  it('gives each live scene’s card in the story, by scene id, with whether it is empty', () => {
    const db = memoryWorld('Gullhaven')
    const [story] = repo.listStories(db)
    const outline = repo.getOutline(db, story.id)
    const [first] = outline.scenes
    const chapter = repo.createChapter(db, story.id, { title: 'The Drowned Steps' })
    const planned = repo.createScene(db, chapter.id, { title: 'Fog on the Quay' })
    const gone = repo.createScene(db, chapter.id, { title: 'Cut' })
    repo.updateSceneCard(db, first.id, {
      ...emptySceneCard(),
      goal: 'Wren lights the lamp herself.',
      beats: ['She climbs the steps', 'The ferry comes in early'],
      when: 'Day 1, dusk',
      setsUpIds: ['thread-1']
    })
    repo.updateSceneCard(db, planned.id, { ...emptySceneCard(), when: 'Day 4, dawn' })
    repo.deleteScene(db, gone.id)
    // A scene in another story stays out.
    const other = repo.createStory(db, { title: 'Elsewhere' })
    const otherScene = repo.getOutline(db, other.id).scenes[0]

    const cards = storySceneCards(db, story.id)
    expect(Object.keys(cards).sort()).toEqual([first.id, planned.id].sort())
    expect(cards[first.id]).toEqual({
      goal: 'Wren lights the lamp herself.',
      beats: ['She climbs the steps', 'The ferry comes in early'],
      when: 'Day 1, dusk',
      povId: null,
      locationId: null,
      presentIds: [],
      setsUpIds: ['thread-1'],
      paysOffIds: [],
      empty: false
    })
    // Who, where and when may be filled in: the card is still empty of what happens.
    expect(cards[planned.id]).toMatchObject({ when: 'Day 4, dawn', empty: true })
    expect(otherScene && cards[otherScene.id]).toBeFalsy()
  })

  it('reads a damaged card as an empty one rather than hiding the scene', () => {
    const db = memoryWorld()
    const [story] = repo.listStories(db)
    const [scene] = repo.getOutline(db, story.id).scenes
    db.prepare('UPDATE scenes SET card_json = ? WHERE id = ?').run('{not json', scene.id)
    expect(storySceneCards(db, story.id)[scene.id]).toMatchObject({ goal: '', beats: [], empty: true })
  })
})

describe('the board’s AI-idea marks', () => {
  it('round-trips, and drops marks for scenes that are gone as it saves', () => {
    const db = memoryWorld()
    const [story] = repo.listStories(db)
    const [chapter] = repo.getOutline(db, story.id).chapters
    const a = repo.createScene(db, chapter.id, { title: 'A' })
    const b = repo.createScene(db, chapter.id, { title: 'B' })
    expect(readBoardMarks(db)).toEqual({ aiIdeas: [] })
    expect(markAiIdea(db, a.id, true)).toEqual({ aiIdeas: [a.id] })
    expect(markAiIdea(db, b.id, true)).toEqual({ aiIdeas: [a.id, b.id] })
    expect(markAiIdea(db, a.id, true)).toEqual({ aiIdeas: [a.id, b.id] })
    repo.deleteScene(db, a.id)
    // Read: the gone scene is left out at once; written: it is gone for good.
    expect(readBoardMarks(db)).toEqual({ aiIdeas: [b.id] })
    expect(markAiIdea(db, b.id, false)).toEqual({ aiIdeas: [] })
    expect(JSON.parse(repo.getMeta(db, 'desk_board')!)).toEqual({ aiIdeas: [] })
  })

  it('reads damaged marks as none', () => {
    const db = memoryWorld()
    repo.setMeta(db, 'desk_board', '{oops')
    expect(readBoardMarks(db)).toEqual({ aiIdeas: [] })
  })
})
