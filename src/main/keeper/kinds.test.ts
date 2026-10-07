// A thing the memory model calls a character is made as an item (keeper/kinds.ts, Adam 2026-10-07). The bead case is
// the slip a real model made in a test story: an invented bead a child wants, filed as a character.

import { describe, expect, it } from 'vitest'
import { nameSays, phraseSays, replyShowsActing, textShowsActing, thingNotCharacter, type NewEntry } from './kinds'

const SCENE = [
  'The ferry bumped against the far bank, and the girl watched Wren climb out.',
  '“There’s a man at Harrowgate sells glass beads. Blue ones.”',
  '“I’ll bring you one,” Wren said.'
]

const bead: NewEntry = {
  name: 'Pell’s blue bead',
  aliases: ['the blue bead'],
  summary: 'A glass bead sold by a man at Harrowgate market, wanted by Pell and promised by Wren.',
  fields: { description: 'blue glass beads sold at Harrowgate market by a man' },
  ref: 'N1'
}

describe('what a name or a summary says something is', () => {
  it('reads the thing a name or a summary names, past its owner and what it is made of', () => {
    expect(nameSays('Pell’s blue bead')).toBe('thing')
    expect(nameSays("Wren's grandfather's watch")).toBe('thing')
    expect(nameSays('the brass compass')).toBe('thing')
    expect(nameSays('the Sword of Kings')).toBe('thing')
    expect(phraseSays('A glass bead sold by a man at Harrowgate market.')).toBe('thing')
    expect(phraseSays("Wren's grandmother's brass pocket compass, her one keepsake.")).toBe('thing')
    expect(phraseSays("Master Edric's last survey of Carrow Fell.")).toBe('thing')
  })

  it('knows people and animals, and takes a name with a capital as a name', () => {
    expect(nameSays('the flat-faced man')).toBe('being')
    expect(nameSays('the dog')).toBe('being')
    expect(nameSays("Hobb's wife")).toBe('being')
    expect(nameSays('Mother Agate')).toBeNull()
    expect(nameSays('Cinder')).toBeNull()
    expect(phraseSays('A dun mare Wren buys at the horse fair.')).toBe('being')
    expect(phraseSays("Ash's herd dog, which lies in the shade.")).toBe('being')
    expect(phraseSays('A key witness to the fire.')).toBe('being')
    expect(phraseSays('A drover, thirty, taking cattle to Harrowgate.')).toBeNull()
  })
})

describe('a new "character" that is a thing', () => {
  it('is a thing: the bead a child wants, named and summed up like an object, never speaking', () => {
    expect(thingNotCharacter(bead, SCENE, [])).toBe(true)
    // "it" for pronouns says so too.
    expect(thingNotCharacter({ ...bead, name: 'Glimmer', aliases: [], summary: 'Something Pell wants.', fields: { pronouns: 'it/its' } }, SCENE, [])).toBe(
      true
    )
  })

  it('stays a character when anything says it is someone', () => {
    // Pronouns for a person.
    expect(thingNotCharacter({ ...bead, fields: { pronouns: 'she/her' } }, SCENE, [])).toBe(false)
    // A person or an animal in its name or summary.
    expect(thingNotCharacter({ ...bead, name: 'the bead-seller', summary: 'A man who sells glass beads at Harrowgate.' }, SCENE, [])).toBe(false)
    expect(thingNotCharacter({ ...bead, name: 'Thistle', aliases: [], summary: 'A dun mare Wren buys at the fair.', fields: {} }, SCENE, [])).toBe(false)
    // Alive: a talking sword.
    expect(thingNotCharacter({ ...bead, name: 'the sword', aliases: [], summary: 'A talking sword that hates its owner.' }, SCENE, [])).toBe(false)
    // Nothing says what it is: a name is someone's.
    expect(thingNotCharacter({ ...bead, name: 'Tobin', aliases: [], summary: 'Someone called Tobin.', fields: {} }, SCENE, [])).toBe(false)
  })

  it('stays a character when the scene has it speak or think', () => {
    const talking = ['“Pick me up,” said the blue bead.']
    expect(textShowsActing(['Pell’s blue bead', 'the blue bead'], talking)).toBe(true)
    expect(thingNotCharacter(bead, [...SCENE, ...talking], [])).toBe(false)
    expect(textShowsActing(['the blue bead'], ['The blue bead wondered where it was.'])).toBe(true)
    // Lying in a palm or rolling about isn't acting.
    expect(textShowsActing(['the blue bead'], ['The blue bead rolled across the deck.', 'The blue bead lay in her palm.'])).toBe(false)
  })

  it('stays a character when the reply gives it words, knowledge or feelings', () => {
    expect(replyShowsActing(bead, [{ type: 'said', kind: 'promise', entry: 'N1', heard: ['E3'], quote: '...' }])).toBe(true)
    expect(replyShowsActing(bead, [{ type: 'voice', entry: 'N1', quote: '...' }])).toBe(true)
    expect(replyShowsActing(bead, [{ type: 'knows', entry: 'Pell’s blue bead', fact: 'x', quote: '...' }])).toBe(true)
    expect(replyShowsActing(bead, [{ type: 'relationship', entry: 'E3', other: 'N1', rel: 'wants', feels: 'longs for it', otherFeels: 'loves her' }])).toBe(
      true
    )
    // Someone else's promise about it, or someone wanting it, is not its doing.
    const real = [
      { type: 'said', kind: 'promise', entry: 'E1', heard: ['E2', 'E3'], fact: 'Wren will bring Pell a blue bead', quote: 'I’ll bring you one' },
      { type: 'detail', entry: 'E3', field: 'desires', value: 'a blue glass bead', quote: 'I want one anyway' },
      { type: 'relationship', entry: 'E3', other: 'N1', rel: 'wants', feels: 'longs for it', otherFeels: '' }
    ]
    expect(replyShowsActing(bead, real)).toBe(false)
    expect(thingNotCharacter(bead, SCENE, real)).toBe(true)
  })
})
