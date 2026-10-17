import { describe, expect, it } from 'vitest'
import * as repo from '../db/repo'
import { memoryWorld } from '../../../tests/unit/helpers'
import { keepOutline } from '../outline/structure'
import { planScenes, storySummary } from './storySummary'

describe('a new story’s world, from its plan (2026-10-17)', () => {
  it('is nothing while the story has nothing planned', () => {
    const db = memoryWorld()
    expect(storySummary(db, repo.listStories(db)[0].id)).toBe('')
  })

  it('tells the World builder the premise and each chapter and scene with who is there, where and its threads', () => {
    const db = memoryWorld()
    const id = repo.listStories(db)[0].id
    repo.updateStory(db, id, { premise: 'A ferryman owes the Duke more than money.', tone: 'Wry' })
    keepOutline(db, id, [
      { key: 'c0', kind: 'chapter', title: 'The Ferry', text: 'Tobin is called in.', card: { pov: 'Tobin Hale', characters: ['The Duke'], location: 'Gull Quay', when: 'Day 1' } },
      { key: 's0', kind: 'scene', title: 'Debt', text: 'The Duke names his price.', beats: ['A coin on the table'], parent: { key: 'c0' }, setsUp: ['The Duke’s debt'] }
    ])
    const text = storySummary(db, id)
    expect(text).toContain('Premise: A ferryman owes the Duke more than money.')
    expect(text).toContain('Tone: Wry')
    expect(text).toContain('Chapter The Ferry: Tobin is called in. Who: Tobin Hale (point of view), The Duke. Where: Gull Quay. When: Day 1.')
    expect(text).toContain('- Scene 1 (Debt): The Duke names his price. A coin on the table')
    expect(text).toContain('Sets up: The Duke’s debt.')
    expect(text).toMatch(/looks, build, usual clothes, personality/)
  })

  it('names a room with the place it is inside', () => {
    const db = memoryWorld()
    const id = repo.listStories(db)[0].id
    keepOutline(db, id, [
      { key: 'c0', kind: 'chapter', title: 'Home', text: 'Supper goes wrong.', card: { location: 'Kitchen, Venn House' } },
      { key: 's0', kind: 'scene', title: 'Supper', text: 'The soup is cold.', parent: { key: 'c0' } }
    ])
    expect(storySummary(db, id)).toContain('Where: Kitchen (inside Venn House).')
  })

  it('numbers its scenes, for each event to say which it happens in, only when the summary is the story’s own', () => {
    const db = memoryWorld()
    const id = repo.listStories(db)[0].id
    keepOutline(db, id, [
      { key: 'c0', kind: 'chapter', title: 'One', text: 'It begins.' },
      { key: 's0', kind: 'scene', title: 'First', text: 'A door opens.', parent: { key: 'c0' } },
      { key: 's1', kind: 'scene', title: 'Last', text: 'A door shuts.', parent: { key: 'c0' } }
    ])
    const text = storySummary(db, id)
    expect(text).toContain('- Scene 1 (First): A door opens.')
    expect(text).toContain('- Scene 2 (Last): A door shuts.')
    expect(planScenes(db, id, text)).toEqual(repo.getOutline(db, id).scenes.map((s) => s.id))
    expect(planScenes(db, id, `${text} And more of Adam's.`)).toEqual([])
  })
})
