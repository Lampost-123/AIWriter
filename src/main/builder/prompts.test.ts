import { describe, expect, it } from 'vitest'
import { defaultWritingPrefs } from '@shared/defaults'
import { memoryWorld } from '../../../tests/unit/helpers'
import * as repo from '../db/repo'
import { gatherWorld } from './context'
import {
  answersText,
  briefVersions,
  fleshOutUser,
  MAX_QUESTIONS,
  optionsUser,
  questionsSystem,
  questionsUser,
  quickStartSystem,
  quickStartUser,
  worldText
} from './prompts'

describe("the world's places in what the builder's model is told (2026-10-17)", () => {
  const world = () => {
    const db = memoryWorld()
    const storyId = repo.listStories(db)[0].id
    repo.createEntry(db, 'group', { name: 'The Lantern Guild', summary: 'Smugglers' })
    const harbour = repo.createEntry(db, 'place', { name: 'Gullhaven', aliases: ['the harbour'], summary: 'A fog-bound port' })
    const brief = (kind: 'character' | 'place' | 'group' | 'item') => gatherWorld(db, { kind, excludeId: null, storyId, prefs: defaultWritingPrefs() })
    return { harbour, brief }
  }

  it('lists the places after the groups when building a character', () => {
    const w = world()
    const brief = w.brief('character')
    const { text, entryIds } = worldText(brief, 'character', 10_000)
    expect(text).toContain('Places\n- Gullhaven (also: the harbour): A fog-bound port')
    expect(text.indexOf('Groups\n')).toBeLessThan(text.indexOf('Places\n'))
    expect(entryIds).toContain(w.harbour.id)
    expect(briefVersions(brief).get(w.harbour.id)).toBe(w.harbour.updatedAt)
  })

  it('lists a place once when building a place', () => {
    const text = worldText(world().brief('place'), 'place', 10_000).text
    expect(text).toContain('Places already in the world\n- Gullhaven')
    expect(text.split('- Gullhaven').length).toBe(2)
  })

  it('leaves out places before groups when the model can read little', () => {
    const w = world()
    const brief = w.brief('character')
    for (let i = 0; i < 30; i++) brief.places.push({ ...brief.places[0], id: `p${i}`, name: `Quay ${i}`, summary: 'A long quay of old stone, wet and slick.' })
    const text = worldText(brief, 'character', 200).text
    expect(text).toContain('The Lantern Guild')
    expect(text).not.toContain('Quay 29')
  })
})

describe('the follow-up questions after Quick start’s notes', () => {
  it('asks for a short JSON list of plain questions about what the notes leave open', () => {
    const system = questionsSystem('character')
    expect(system.startsWith('[AIWRITE-BUILDER v1] questions\n')).toBe(true)
    expect(system).toContain(`Ask 3 to ${MAX_QUESTIONS} questions`)
    expect(system).toContain('Never ask about something the notes already say.')
    expect(system).toContain('Reply with {"questions": [')
    const user = questionsUser('place', 'A port where nobody asks questions.', 'THE WORLD', false)
    expect(user).toContain("The author's notes on the place:\n\"\"\"\nA port where nobody asks questions.\n\"\"\"")
    expect(user.startsWith('THE WORLD')).toBe(true)
  })

  it('gives Quick start the answers after the notes, as the author’s words, and says which were left to the AI', () => {
    const answers = [
      { question: 'What does Brann want?', answer: 'To pay off the Duke.' },
      { question: 'What is he afraid of?', answer: null },
      { question: '  ', answer: 'ignored' }
    ]
    expect(answersText(answers)).toBe('Q: What does Brann want?\nA: To pay off the Duke.\nQ: What is he afraid of?\nA: (left to you: decide it)')
    const user = quickStartUser('character', 'Brann runs the ferry.', '', false, '', answers)
    expect(user).toContain("The author's answers to a few follow-up questions. They count as the author's notes too")
    expect(user).toContain('decide it yourself and write it under "drafted"')
    // The notes come first, so they are still read as the notes.
    expect(user.indexOf('Brann runs the ferry.')).toBeLessThan(user.indexOf('follow-up questions'))
    expect(quickStartUser('character', 'Brann runs the ferry.', '', false)).not.toContain('follow-up')
  })
})

describe("what the builder's model is asked", () => {
  it('to keep one-line fields to one short phrase, so a reply fits on their line', () => {
    const system = quickStartSystem('character')
    expect(system).toContain('- hair: Hair (one short phrase, a few words at most)')
    expect(system).toContain('- marks: Distinguishing marks (Scar through the left eyebrow; one short phrase, a few words at most)')
    expect(system).toContain('- summary: Short summary (who or what it is, in one line)\n')
    expect(system).toContain('- traits: Core traits\n')
    expect(fleshOutUser('item', { name: 'The Compass' }, ['category'], '')).toContain('(Weapon, heirloom, letter, key; one short phrase')
    expect(optionsUser('character', { name: 'Mara' }, 'eyes', '')).toContain('The field: Eyes (one short phrase, a few words at most)')
    expect(optionsUser('character', { name: 'Mara' }, 'origin', '')).toContain('The field: Origin\n')
  })

  it('to leave out what is saved already when finishing a profile', () => {
    expect(quickStartUser('character', 'Brann runs the ferry.', '', false)).not.toContain('saved already')
    const user = quickStartUser('character', 'Brann runs the ferry.', '', false, 'Name: Brann\nHair: Grey')
    expect(user).toContain('These fields are saved already: leave them out, write only the others, and fit them to these:')
    expect(user).toContain('fit them to these:\nName: Brann\nHair: Grey')
    // After the notes, so the notes are still read as the notes.
    expect(user.lastIndexOf('"""')).toBeLessThan(user.indexOf('saved already'))
  })
})
