import { describe, expect, it } from 'vitest'
import type { EntryKind } from '@shared/types'
import { buildNameIndex } from '../names/nameMatch'
import { addedChangeMessage, addedEntryMessage, newName, prefill, tidySelection } from './addToMemoryLogic'

const world: { id: string; kind: EntryKind; name: string; aliases: string[] }[] = [
  { id: 'mara', kind: 'character', name: 'Mara Venn', aliases: ['Mara'] },
  { id: 'eel', kind: 'place', name: 'The Gilded Eel', aliases: [] },
  { id: 'fire', kind: 'thread', name: 'The Fire', aliases: [] }
]
const index = buildNameIndex(world)
const kinds = new Map(world.map((e) => [e.id, { kind: e.kind }]))

describe('Add to memory starts with the selected words', () => {
  it('words that name an entry: a change to it, with the words as its note', () => {
    const p = prefill('  Mara lost her left hand at the Gilded Eel.\n', index, kinds)
    expect(p.mode).toBe('change')
    expect(p.entryId).toBe('mara')
    expect(p.named).toEqual(['mara', 'eel'])
    expect(p.note).toBe('Mara lost her left hand at the Gilded Eel.')
  })

  it('words about someone new: a new character named after them, with the words as the description', () => {
    const p = prefill('A tall woman called Jory Ashdown stepped out of the rain.', index, kinds)
    expect(p).toMatchObject({ mode: 'new', kind: 'character', name: 'Jory Ashdown', entryId: null, named: [] })
    expect(p.description).toBe('A tall woman called Jory Ashdown stepped out of the rain.')
  })

  it('a plot thread named in the words is not offered for a change', () => {
    expect(prefill('Nobody spoke of The Fire.', index, kinds)).toMatchObject({ mode: 'new', named: [], entryId: null })
  })

  it('keeps paragraphs, with at most one blank line between them', () => {
    expect(tidySelection('One.  \n\n\n\nTwo.\n')).toBe('One.\n\nTwo.')
  })
})

describe('the name a new entry starts with', () => {
  const name = (text: string): string => newName(text, index)

  it('is a capitalised name that isn’t an entry yet', () => {
    expect(name('Mara met Jory by the river.')).toBe('Jory')
    expect(name('Rain fell on the roofs of Harrow.')).toBe('Harrow')
    expect(name('She saw Edda of Harrow at the door.')).toBe('Edda of Harrow')
    expect(name('In Harrow, they waited.')).toBe('Harrow')
    expect(name('On Monday, Jory’s brother left.')).toBe('Jory')
  })

  it('a word that only starts a sentence isn’t taken for a name, unless the name has more than one word', () => {
    expect(name('Rain fell. Smoke rose.')).toBe('')
    expect(name('Old Tom Farrow laughed.')).toBe('Old Tom Farrow')
    expect(name('"Run," she said.')).toBe('')
  })

  it('names that are already entries are left for a change', () => {
    expect(name('Mara Venn waited at the Gilded Eel.')).toBe('')
  })
})

describe('what the toast says', () => {
  it('in plain words', () => {
    expect(addedEntryMessage('Jory', 'character')).toBe('Added Jory to your characters.')
    expect(addedEntryMessage('Aether', 'glossary')).toBe('Added Aether to your glossary.')
    expect(addedChangeMessage('Mara', 'Lost her hand.')).toBe('Added to memory for Mara: “Lost her hand.”')
    expect(addedChangeMessage('Mara', 'word '.repeat(30), 20)).toBe('Added to memory for Mara: “word word word word…”')
  })
})
