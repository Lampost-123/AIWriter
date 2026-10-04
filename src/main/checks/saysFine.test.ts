// Issues that only say what was checked was fine (seen in a live run) aren't raised; real ones are.
import { describe, expect, it } from 'vitest'
import { onlyUnlisted, saysFine } from './parse'

describe('an issue that says all is well', () => {
  it('is left out', () => {
    for (const m of [
      'Dov is described as loud, loyal, superstitious. This line fits his voice. No problem.',
      'The scene is in past tense, close third person. This sentence is in past tense and third person, consistent. No issue.',
      'Past perfect is used correctly. No tense slip.',
      "Pell's dialogue is sardonic and dry, consistent with the memory's description. No issue.",
      'Ilse knows the vault is flooding because she saw the water seeping in the previous scene. This is consistent with her knowledge.',
      "Ilse's eyes are grey in the memory, but the scene says 'her grey eyes' – this matches, no problem.",
      "The scene is in past tense, but this sentence is in present tense ('pressed' is past, so it's fine. No issue.)"
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

describe('a knowledge issue that rests on the memory not listing it', () => {
  const k = (message: string) => onlyUnlisted({ check: 'knowledge', message })
  it('is left out', () => {
    expect(k('Dov knows the property of salt-ink, but the memory does not list this knowledge for Dov.')).toBe(true)
    expect(k("Sallow knows the secret channel, but the memory says this is known only to Ilse and Dov.")).toBe(true)
    expect(k('Captain Sallow knows that the compass speaks, but according to the memory, this knowledge is known only by Ilse.')).toBe(true)
  })
  it('stays when the knowledge comes later, or they weren’t there', () => {
    expect(k('Ilse speaks of the vault, but she only learns of it in a later scene; the memory does not list it.')).toBe(false)
    expect(k('Dov knows what Anselm said in the Archive, but he was not present and the memory does not show anyone telling him.')).toBe(false)
    expect(onlyUnlisted({ check: 'facts', message: 'the memory does not list his scar' })).toBe(false)
  })
})
