import { describe, expect, it } from 'vitest'
import { fleshOutUser, optionsUser, quickStartSystem, quickStartUser } from './prompts'

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
