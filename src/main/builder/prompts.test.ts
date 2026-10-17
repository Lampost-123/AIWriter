import { describe, expect, it } from 'vitest'
import { defaultWritingPrefs } from '@shared/defaults'
import { memoryWorld } from '../../../tests/unit/helpers'
import * as repo from '../db/repo'
import { gatherWorld } from './context'
import {
  answersText,
  briefVersions,
  fleshOutUser,
  interviewMessages,
  MAX_QUESTIONS,
  optionsUser,
  questionsSystem,
  questionsUser,
  quickStartSystem,
  quickStartUser,
  sentTurns,
  WORLD_TOKENS_MAX,
  worldText
} from './prompts'
import { estimateTokens } from '../keeper/text'

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

// 2026-10-17: B2 in the world and story building plan.
describe('which of the world the builder’s model is told about', () => {
  const big = (n: number) => {
    const db = memoryWorld()
    const storyId = repo.listStories(db)[0].id
    const long = 'A quiet dock worker who keeps a ledger of every ship that passes, and never lends a coin to anyone at all.'
    for (let i = 0; i < n; i++) {
      const e = repo.createEntry(db, 'character', { name: `Dockhand ${String(i).padStart(3, '0')}`, summary: long })
      db.prepare('UPDATE entries SET updated_at = ? WHERE id = ?').run(new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(), e.id)
    }
    const old = repo.createEntry(db, 'lore', { name: 'The Drowned Bell', aliases: ['the bell'], summary: 'It rings before a storm.' })
    db.prepare('UPDATE entries SET updated_at = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', old.id)
    const brief = gatherWorld(db, { kind: 'character', excludeId: null, storyId, prefs: defaultWritingPrefs() })
    return { brief, old }
  }

  it('always tells it about what the notes name, however old, then the newest', () => {
    const { brief, old } = big(40)
    const named = worldText(brief, 'character', 400, 'She hears the bell, and Dockhand 002 runs.')
    expect(named.text).toContain('- The Drowned Bell')
    expect(named.text).toContain('- Dockhand 002')
    expect(named.text).toContain('- Dockhand 039')
    expect(named.text).not.toContain('- Dockhand 010')
    expect(named.entryIds).toContain(old.id)
    expect(worldText(brief, 'character', 400).text).not.toContain('The Drowned Bell')
  })

  it('sends at most about 6000 tokens of it, however much the model can read', () => {
    const { brief } = big(400)
    const text = worldText(brief, 'character', 100_000, 'The bell rang.').text
    expect(estimateTokens(text)).toBeLessThanOrEqual(WORLD_TOKENS_MAX)
    expect(estimateTokens(text)).toBeGreaterThan(WORLD_TOKENS_MAX - 300)
    expect(text).toContain('- Dockhand 399')
    expect(text).toContain('- The Drowned Bell')
    expect(text).not.toContain('- Dockhand 000')
  })
})

describe('notes with triple quotes in them (2026-10-17)', () => {
  it('never close the quotes the notes are wrapped in', () => {
    const user = quickStartUser('character', 'She said """leave""" and went.', '', false, '', [{ question: 'Why?', answer: 'He wrote """no""".' }])
    expect(user.split('"""').length).toBe(5)
    expect(user).toContain('She said "leave" and went.')
    expect(questionsUser('character', 'A """ B', '', false).split('"""').length).toBe(3)
  })
})

describe('the interview’s turns (2026-10-17)', () => {
  it('sends only the last turns with words in them, and counts only those', () => {
    const turns = Array.from({ length: 30 }, (_, i) => ({ from: i % 2 ? ('character' as const) : ('adam' as const), text: i === 29 ? '  ' : `Turn ${i}` }))
    const sent = sentTurns(turns)
    expect(sent.map((t) => t.text)).toEqual(Array.from({ length: 19 }, (_, i) => `Turn ${i + 10}`))
    expect(interviewMessages('S', turns, 'Q?').length).toBe(sent.length + 2)
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
