import { describe, expect, it } from 'vitest'
import { defaultStyleGuide } from '@shared/defaults'
import type { FinalOptions } from '../ai/prompts'
import {
  beatDirection,
  beatInstruction,
  beatWords,
  cardBeats,
  MAX_STEER_CHARS,
  SO_FAR_BLOCK,
  soFarBlock,
  soFarLimit,
  tidySteer
} from './instructions'

const BEATS = ['Mara arrives at the Gilded Eel in the rain.', 'Tobin asks for the ledger.', 'She refuses.', 'Someone knocks at the door.']

const final = (over: Partial<FinalOptions> = {}): FinalOptions => ({
  targetWords: 400,
  style: { ...defaultStyleGuide(), pov: 'Close third person', tense: 'Past tense', spelling: 'UK' },
  hasBeats: true,
  hasPrevious: false,
  hasDirection: false,
  ...over
})

const ask = (index: number, over: Partial<{ steer: string; hasSoFar: boolean; beats: string[] }> = {}) => ({
  index,
  beats: BEATS,
  steer: '',
  hasSoFar: index > 1,
  ...over
})

describe('the closing instruction for one beat', () => {
  it('asks for beat i of n only, quoting it with the beats either side of it', () => {
    const text = beatInstruction(final(), ask(2))
    expect(text).toMatch(/^Write only the next beat of the scene now: beat 2 of the 4 on the scene card\./)
    expect(text).toContain('- Beat 1 (already written: the scene so far ends with it): Mara arrives at the Gilded Eel in the rain.')
    expect(text).toContain('- Beat 2 (write this one now): Tobin asks for the ledger.')
    expect(text).toContain('- Beat 3 (comes next: leave it for later): She refuses.')
    // Only the beats either side: the rest are on the scene card above.
    expect(text).not.toContain('Someone knocks')
    expect(text).toContain("don't begin beat 3, and don't round the scene off")
    expect(text).toContain('Carry on seamlessly from the very end of the scene so far')
  })

  it("gives Adam's note for the beat, and asks for it to be followed", () => {
    const text = beatInstruction(final(), ask(3, { steer: 'Make her hesitate first.\nShe nearly says yes.' }))
    expect(text).toContain("The author's note for this beat: Make her hesitate first.\n  She nearly says yes.")
    expect(text).toContain("- Follow the author's note for this beat.")
    const none = beatInstruction(final(), ask(3))
    expect(none).not.toContain("author's note")
  })

  it('keeps the usual rules: prose only, the length, the style, the direction, the facts', () => {
    const text = beatInstruction(final({ hasDirection: true, targetWords: 1250 }), ask(2))
    expect(text).toContain('- Prose only, in plain text with *asterisks* only for italics')
    expect(text).toContain('no beat numbers')
    expect(text).toContain('- Aim for about 1,250 words.')
    expect(text).toContain('- Keep to close third person, past tense and UK spelling.')
    expect(text).toContain("- Follow the author's direction for this draft.")
    expect(text.trimEnd().endsWith('- Never contradict the facts given above.')).toBe(true)
    // Not the whole scene's closing.
    expect(text).not.toContain('Write the scene now')
    expect(text).not.toContain('Hit every beat')
  })

  it('opens the scene with the first beat, carrying on from the previous scene when there is one', () => {
    const fresh = beatInstruction(final(), ask(1))
    expect(fresh).toMatch(/^Write only the first beat of the scene now: beat 1 of the 4/)
    expect(fresh).not.toContain('Beat 0')
    expect(fresh).toContain('- Open the scene with this beat.')
    expect(fresh).not.toContain('scene so far')
    const after = beatInstruction(final({ hasPrevious: true }), ask(1))
    expect(after).toContain('- Open the scene with this beat, continuing seamlessly from where the previous scene ends.')
    const otherStory = beatInstruction(
      final({ hasPrevious: true, previousStory: { title: 'Book 1', ended: true, timeGap: 'Two years' } }),
      ask(1)
    )
    expect(otherStory).toContain('The previous scene is how Book 1 ended, not part of this story.')
    expect(otherStory).toContain('Time since then: Two years.')
  })

  it('ends the scene with the last beat, where what the scene should bring about must be in place', () => {
    const text = beatInstruction(final({ hasBringAbout: true }), ask(4))
    expect(text).toMatch(/^Write only the last beat of the scene now: beat 4 of the 4/)
    expect(text).toContain('- Beat 3 (already written: the scene so far ends with it): She refuses.')
    expect(text).not.toContain('Beat 5')
    expect(text).toContain('- Write what happens in this beat, and end the scene with it.')
    expect(text).toContain('should have brought about what the scene card says it should')
    // Earlier beats don't rush it.
    expect(beatInstruction(final({ hasBringAbout: true }), ask(2))).not.toContain('brought about')
  })

  it('writes a card with one beat as the whole scene', () => {
    const text = beatInstruction(final(), ask(1, { beats: ['They talk.'] }))
    expect(text).toMatch(/^Write the scene now\. The scene card has one beat:\n- They talk\./)
    expect(text).toContain('from its first line to its last')
    expect(text).not.toContain('stop at its end')
  })

  it('starts cleanly when there is no scene so far to carry on from', () => {
    const text = beatInstruction(final(), ask(3, { hasSoFar: false }))
    expect(text).toContain('- Beat 2 (already happened): Tobin asks for the ledger.')
    expect(text).toContain('as if the beats before it had just happened')
    expect(text).not.toContain('Carry on seamlessly')
  })
})

describe('the scene so far', () => {
  it('is left out when the page has nothing to carry on from', () => {
    expect(soFarBlock('', 32000)).toBeNull()
    expect(soFarBlock('  \n ', 32000)).toBeNull()
  })

  it('goes in whole when it fits', () => {
    const text = 'Mara came in from the rain.\n\nTobin was by the fire.'
    expect(soFarBlock(text, 32000)).toEqual({ id: SO_FAR_BLOCK, title: 'The scene so far', text })
  })

  it('keeps only its later part for a small model, from the start of a paragraph', () => {
    const para = (n: number): string => `Paragraph ${n} ${'word '.repeat(59).trim()}.`
    const text = Array.from({ length: 40 }, (_, i) => para(i + 1)).join('\n\n')
    const block = soFarBlock(text, 4000)!
    expect(block.title).toBe('End of the scene so far')
    expect(block.text.startsWith('Paragraph ')).toBe(true)
    expect(block.text.endsWith(para(40))).toBe(true)
    const words = block.text.split(/\s+/).length
    expect(words).toBeLessThanOrEqual(soFarLimit(4000))
    expect(words).toBeGreaterThan(soFarLimit(4000) * 0.5)
  })

  it('is about a quarter of the model window, between 400 and 3,500 words', () => {
    expect(soFarLimit(1000)).toBe(400)
    expect(soFarLimit(16000)).toBe(Math.round((16000 * 0.25) / 1.35))
    expect(soFarLimit(200000)).toBe(3500)
    expect(soFarLimit(null)).toBe(soFarLimit(16000))
  })
})

describe('the beats and their length', () => {
  it('counts the beats as the briefing numbers them, blank ones left out', () => {
    expect(cardBeats([' One ', '', '  ', 'Two'])).toEqual(['One', 'Two'])
  })

  it("shares the scene's length out between the beats, to the nearest ten words", () => {
    expect(beatWords(1500, 3)).toBe(500)
    expect(beatWords(2000, 3)).toBe(670)
    expect(beatWords(2000, 0)).toBe(2000)
    // Never shorter than the shortest draft asked for.
    expect(beatWords(300, 5)).toBe(100)
  })

  it("tidies Adam's note for a beat", () => {
    expect(tidySteer('  Slower.  ')).toBe('Slower.')
    expect(tidySteer(undefined)).toBe('')
    expect(tidySteer('x'.repeat(MAX_STEER_CHARS + 50))).toHaveLength(MAX_STEER_CHARS)
  })

  it("keeps the note with the beat's record, after the scene's direction", () => {
    expect(beatDirection('', '')).toBe('')
    expect(beatDirection('Keep it tense', '')).toBe('Keep it tense')
    expect(beatDirection('', 'Make Tobin stall')).toBe('For this beat: Make Tobin stall')
    expect(beatDirection('Keep it tense', 'Make Tobin stall')).toBe('Keep it tense. For this beat: Make Tobin stall')
    expect(beatDirection('Keep it tense!', 'Slower')).toBe('Keep it tense! For this beat: Slower')
  })
})
