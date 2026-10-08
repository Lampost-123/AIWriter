import { describe, expect, it } from 'vitest'
import { asksForChanges, asksOneQuestion, claimsChanges, contractLastWords, PROPOSE_NOW, proposeNow } from './askChanges'

describe('claimsChanges', () => {
  it('catches answers that hand changes over to do by hand', () => {
    expect(claimsChanges('Apply what you want. If any beat still reads tame, tell me which.')).toBe(true)
    expect(claimsChanges('Use whichever you like best.')).toBe(true)
    expect(claimsChanges('Copy these in where they fit.')).toBe(true)
    expect(claimsChanges('Apply the changes below when ready.')).toBe(true)
    expect(claimsChanges('I’ve tightened the opening.')).toBe(true)
  })
  it('leaves ideas and plain talk alone', () => {
    expect(claimsChanges('She could apply pressure to the wound.')).toBe(false)
    expect(claimsChanges('One idea: they meet at the ferry at dusk.')).toBe(false)
  })
})

describe('asksForChanges', () => {
  it('sees a request for edits', () => {
    expect(asksForChanges('Push this beat harder')).toBe(true)
    expect(asksForChanges('Can you rewrite the opening?')).toBe(true)
    expect(asksForChanges('make it darker')).toBe(true)
    expect(asksForChanges('tighten the second paragraph')).toBe(true)
  })
  it('leaves questions alone', () => {
    expect(asksForChanges('Who is the ferryman?')).toBe(false)
    expect(asksForChanges('Give me three ideas for the next scene')).toBe(false)
  })
})

describe('the contract’s nudge and last words (AIWRITE_EXP_CHAT_CONTRACT)', () => {
  it('gives an edit no way out but proposing, or saying what stops it', () => {
    const first = proposeNow('edit')
    expect(first).toMatch(/Propose your best single version now/)
    expect(first).not.toMatch(/only meant to suggest ideas|answer again|ask again/i)
    expect(proposeNow('edit', 2)).toMatch(/^\[AI Write, not the writer\] Your answer gives no proposal again,/)
    expect(first.startsWith(PROPOSE_NOW.slice(0, 44))).toBe(true)
    // Without a known edit, the old note (with its ideas exit) stays.
    expect(proposeNow(null)).toBe(PROPOSE_NOW)
    expect(proposeNow('unsure')).toBe(PROPOSE_NOW)
  })
  it('ends with what was proposed, or what blocked it, never "ask again"', () => {
    expect(contractLastWords(['1', '2'], 'edit')).toMatch(/Proposed: change 1, change 2\. .*how many changes are ready/)
    for (const intent of ['edit', 'unsure', 'answer', 'brainstorm', null] as const) {
      const words = contractLastWords([], intent)
      expect(words).not.toMatch(/ask again|can ask for them/i)
      expect(words).toMatch(/nothing was proposed/)
    }
    expect(contractLastWords([], 'edit')).toMatch(/what stopped you/)
    expect(contractLastWords([], 'answer')).not.toMatch(/what stopped you/)
    expect(contractLastWords([], null)).toMatch(/If the writer asked for a change: say .*Otherwise answer/)
  })
  it('tells a single clarifying question from an answer', () => {
    expect(asksOneQuestion('Which paragraph do you mean, the harbour or the inn?')).toBe(true)
    expect(asksOneQuestion('Here is a darker version: the gulls went silent.')).toBe(false)
    expect(asksOneQuestion('Options:\n1. Darker\n2. Shorter\nWhich?')).toBe(false)
    expect(asksOneQuestion('')).toBe(false)
  })
})
