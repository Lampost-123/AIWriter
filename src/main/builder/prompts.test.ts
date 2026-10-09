import { describe, expect, it } from 'vitest'
import { answersText, fleshOutUser, MAX_QUESTIONS, optionsUser, questionsSystem, questionsUser, quickStartSystem, quickStartUser } from './prompts'

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
