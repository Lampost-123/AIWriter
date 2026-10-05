import { describe, expect, it } from 'vitest'
import { asksForChanges, claimsChanges } from './askChanges'

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
