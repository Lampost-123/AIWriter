// Issues that only say what was checked was fine (seen in a live run) aren't raised; real ones are.
import { describe, expect, it } from 'vitest'
import { saysFine } from './parse'

describe('an issue that says all is well', () => {
  it('is left out', () => {
    for (const m of [
      'Dov is described as loud, loyal, superstitious. This line fits his voice. No problem.',
      'The scene is in past tense, close third person. This sentence is in past tense and third person, consistent. No issue.',
      'Past perfect is used correctly. No tense slip.',
      "Pell's dialogue is sardonic and dry, consistent with the memory's description. No issue.",
      'Ilse knows the vault is flooding because she saw the water seeping in the previous scene. This is consistent with her knowledge.'
    ])
      expect(saysFine(m), m).toBe(true)
  })

  it('is kept when it says what is wrong', () => {
    for (const m of [
      'Dov Marren is missing the last two fingers of his right hand, but the scene says three fingers missing.',
      "Sallow's eyes are dark brown in the memory. This is consistent, but the scene has her speaking from the shore while she is still at the fen.",
      'Brother Anselm died in the fire, but speaks here.',
      "The scene is set on Day 13 at dusk, but the final line says 'the morning of Day 2'."
    ])
      expect(saysFine(m), m).toBe(false)
  })
})
