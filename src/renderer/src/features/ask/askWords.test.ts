import { describe, expect, it } from 'vitest'
import { answerNote, asOfText, chatWhen, examples, refusedReason, savedMessage, speaksOfChanges, staleBadge, turnOutcome } from './askWords'

describe('Ask the world’s words', () => {
  it('give examples that name the world’s own characters, never someone from elsewhere', () => {
    expect(examples(['Wren Halloway', 'Edric Halloway', 'Ansel Crane', 'Iska Vey']).slice(0, 2)).toEqual([
      'What would Wren Halloway do if Edric Halloway lied?',
      'Did I already say how old Ansel Crane is?'
    ])
    // The scene's cast first, then everyone else: someone named twice is named once.
    expect(examples(['Wren Halloway', 'Wren Halloway', 'Edric Halloway']).slice(0, 2)).toEqual([
      'What would Wren Halloway do if Edric Halloway lied?',
      'Did I already say how old Edric Halloway is?'
    ])
    expect(examples(['Wren Halloway']).slice(0, 2)).toEqual(['What would Wren Halloway do if a friend lied?', 'Did I already say how old Wren Halloway is?'])
    const none = examples([])
    expect(none.slice(0, 2)).toEqual(['What would my main character do if a friend lied?', 'Did I already say how old my main character is?'])
    expect(none).toContain('Fix the spelling and grammar in this scene')
    for (const q of [...none, ...examples(['Wren Halloway'])]) expect(q).not.toMatch(/Mara|Tobin|Duke/)
  })

  it('say when a chat was last asked in, briefly', () => {
    const now = Date.parse('2026-10-02T15:00:00')
    expect(chatWhen('2026-10-02T09:05:00', now)).toMatch(/09.05/)
    expect(chatWhen('2026-10-01T22:00:00', now)).toBe('Yesterday')
    expect(chatWhen('2026-03-04T10:00:00', now)).not.toMatch(/2026/)
    expect(chatWhen('2025-03-04T10:00:00', now)).toMatch(/2025/)
    expect(chatWhen('not a date', now)).toBe('')
  })

  it('say where answers are from', () => {
    expect(asOfText({ hasScene: true, sceneLabel: 'Book 1, Ch 2, Sc 3', storyTitle: 'Book 1' })).toBe('As of Book 1, Ch 2, Sc 3')
    expect(asOfText({ hasScene: false, sceneLabel: null, storyTitle: 'Book 1' })).toBe('As of the end of Book 1')
    expect(asOfText({ hasScene: false, sceneLabel: null, storyTitle: null })).toBe('Your world as it was set up')
  })

  it('say quietly how an answer ended and what it cost', () => {
    const base = { status: 'complete', cutOff: false, cost: 0.0021, costEstimated: false, answer: 'Yes.' }
    expect(answerNote(base)).toEqual(['$0.002'])
    expect(answerNote({ ...base, status: 'stopped', costEstimated: true })).toEqual(['Stopped', 'about $0.002'])
    expect(answerNote({ ...base, cutOff: true, cost: null })).toEqual(['Cut short'])
    expect(answerNote({ ...base, status: 'streaming' })).toEqual([])
  })

  it('say what saving did', () => {
    const note = { name: 'Mara Venn', created: false, onlyIn: null, asOf: null }
    expect(savedMessage(note)).toBe('Saved to memory for Mara Venn, as your own note.')
    expect(savedMessage({ ...note, onlyIn: 'Mara Keeps Her Hand' })).toBe('Saved to memory for Mara Venn, in Mara Keeps Her Hand only.')
    // On the description a prequel starts her with, or a detail from a scene on.
    expect(savedMessage({ ...note, asOf: 'the start of Young Mara' })).toBe('Saved to memory for Mara Venn, as of the start of Young Mara.')
    expect(savedMessage({ ...note, asOf: 'Book 2, Ch 3, Sc 1' })).toBe('Saved to memory for Mara Venn, as of Book 2, Ch 3, Sc 1.')
    expect(savedMessage({ ...note, name: 'Tavern names that fit the north', created: true })).toBe(
      'Saved to your lore as “Tavern names that fit the north”.'
    )
    // In an own version of events, as a page of its own there.
    expect(savedMessage({ ...note, name: 'Mara Venn: What would she do', created: true, onlyIn: 'Mara Keeps Her Hand' })).toBe(
      'Saved to your lore as “Mara Venn: What would she do”, in Mara Keeps Her Hand only.'
    )
  })
})

describe('an answer that speaks of changes', () => {
  it('is noticed when it asks to apply, or names its proposed changes', () => {
    expect(speaksOfChanges('I’ve fixed three typos. Apply the changes when ready.')).toBe(true)
    expect(speaksOfChanges('Here are my proposed edits for the opening.')).toBe(true)
    expect(speaksOfChanges('See the changes below.')).toBe(true)
    expect(speaksOfChanges('Mara would never forgive Tobin for that lie.')).toBe(false)
    expect(speaksOfChanges('Did you want me to change the ending?')).toBe(false)
  })
})

describe('an answer that claims changes it never proposed', () => {
  it('is a clear claim, not a word in a brainstorm', () => {
    expect(speaksOfChanges('I’ve fixed the spelling in the first paragraph.')).toBe(true)
    expect(speaksOfChanges('Here is the revised paragraph: The tide came in.')).toBe(true)
    expect(speaksOfChanges('Apply these edits when you’re ready.')).toBe(true)
    expect(speaksOfChanges('She could apply pressure to the wound, or run.')).toBe(false)
    expect(speaksOfChanges('Would you accept a darker ending?')).toBe(false)
  })
})

describe('a change that didn’t go through, said plainly (Adam, 2026-10-19)', () => {
  const tried = (result: string, status: 'not-proposed' | 'done' = 'not-proposed') => ({ status, kind: 'propose' as const, result, outcome: '' })
  it('says why the changes an answer tried were turned down, when none came with it', () => {
    const tools = [
      tried('Not proposed: nothing is waiting for the writer.\n1. entry: Not proposed. “Favourite colour” isn’t one of Mara’s fields. Give fields by key; Mara’s are: eyes (Eyes).')
    ]
    expect(refusedReason(tools)).toBe('Mara has no “Favourite colour” field')
    // Nothing was tried, or it went through: no reason.
    expect(refusedReason([])).toBeNull()
    expect(refusedReason(undefined)).toBeNull()
    expect(refusedReason([tried('Proposed.', 'done')])).toBeNull()
  })
  it('marks a change it couldn’t apply by why: its words gone, or something else', () => {
    expect(staleBadge('The words this change looks for aren’t in the scene any more: another change changed them.')).toBe('Not found')
    expect(staleBadge('The words this change looks for now stand in more than one place in the scene, so it wasn’t applied.')).toBe('Not found')
    expect(staleBadge('Write the chapter is writing this scene right now, so the change can’t go in yet.')).toBe('Not applied')
    expect(staleBadge('Ch 1, Sc 1 is taking longer than usual to open, so the change wasn’t made.')).toBe('Not applied')
  })
})

describe('the outcome line of an Ask answer (chat-truth R1)', () => {
  const turn = (over: Record<string, unknown>) => ({ status: 'complete' as const, ...over })
  const p = (id: string, status: 'pending' | 'started' | 'applied' | 'declined') => ({ id, status })
  it('works it out from the answer’s changes, as they stand now', () => {
    expect(turnOutcome(turn({ proposals: [p('a', 'pending'), p('b', 'applied')] }), new Set()).words).toBe('1 applied, 1 waiting: press Apply.')
    expect(turnOutcome(turn({ proposals: [p('a', 'applied')] }), new Set()).state).toBe('applied')
  })
  it('a change whose Apply failed this session is the red one', () => {
    expect(turnOutcome(turn({ proposals: [p('a', 'pending')] }), new Set(['a'])).state).toBe('failed')
  })
  it('nothing changed, with why a tried change was turned down', () => {
    const tools = [{ status: 'not-proposed' as const, kind: 'propose' as const, result: 'Not proposed: the words it meant to change aren’t in the scene as written.', outcome: '' }]
    expect(turnOutcome(turn({ tools }), new Set()).words).toMatch(/^Nothing was changed: .+\.$/)
    expect(turnOutcome(turn({}), new Set()).words).toBe('Nothing was changed.')
  })
  it('a stopped answer still gets its line; one still streaming, or that failed with nothing to show, doesn’t', () => {
    expect(turnOutcome(turn({ status: 'stopped' }), new Set()).state).toBe('none')
    expect(turnOutcome(turn({ status: 'streaming', proposals: [p('a', 'pending')] }), new Set()).words).toBeNull()
    expect(turnOutcome(turn({ status: 'error' }), new Set()).words).toBeNull()
  })
})
