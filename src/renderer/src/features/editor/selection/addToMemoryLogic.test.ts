import { describe, expect, it } from 'vitest'
import type { EntryKind } from '@shared/types'
import { buildNameIndex } from '../names/nameMatch'
import {
  FORM_EDGE,
  FORM_GAP,
  FORM_SIZE,
  addedChangeMessage,
  addedEntryMessage,
  formPlace,
  newName,
  prefill,
  tidySelection
} from './addToMemoryLogic'

const world: { id: string; kind: EntryKind; name: string; aliases: string[]; absent?: string }[] = [
  { id: 'mara', kind: 'character', name: 'Mara Venn', aliases: ['Mara'] },
  { id: 'eel', kind: 'place', name: 'The Gilded Eel', aliases: [] },
  { id: 'fire', kind: 'thread', name: 'The Fire', aliases: [] },
  { id: 'kell', kind: 'character', name: 'Kell', aliases: [], absent: 'Not in the story yet at this point' }
]
const index = buildNameIndex(world)
const kinds = new Map(world.map((e) => [e.id, { kind: e.kind, absent: e.absent ?? null }]))

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

  it('nor is anyone not in the story yet at this point (the form doesn’t list them)', () => {
    expect(prefill('Kell watched from the hill.', index, kinds)).toMatchObject({ mode: 'new', named: [], entryId: null })
    expect(prefill('Kell watched Mara from the hill.', index, kinds)).toMatchObject({ mode: 'change', named: ['mara'], entryId: 'mara' })
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

describe('where the form opens', () => {
  const view = { width: 960, height: 600 }
  /** The bar over the selected words (34 px tall). */
  const bar = (top: number, left = 300) => ({ top, bottom: top + 34, left })

  /** Where the form's top and bottom are in the window, and how tall it is. */
  const placed = (top: number) => {
    const p = formPlace(bar(top), view)
    const height = Math.min(FORM_SIZE.height, p.room)
    const from = p.side === 'bottom' ? top + 34 + p.sideOffset : top - p.sideOffset - height
    return { ...p, from, to: from + height, height }
  }

  it('below the bar when the whole form fits there, above it when only that side has room', () => {
    expect(formPlace(bar(100), { width: 1280, height: 800 })).toMatchObject({ side: 'bottom', sideOffset: FORM_GAP, alignOffset: 0 })
    expect(formPlace(bar(500), { width: 1280, height: 800 })).toMatchObject({ side: 'top', sideOffset: FORM_GAP, alignOffset: 0 })
  })

  it('in a short window, on the side with more room, and only as tall as that room', () => {
    // 328 px below the bar, 202 above.
    expect(placed(220)).toMatchObject({ side: 'bottom', sideOffset: FORM_GAP, room: 328, height: 328 })
    // 327 px above the bar, 203 below.
    expect(placed(345)).toMatchObject({ side: 'top', sideOffset: FORM_GAP, room: 327, height: 327 })
  })

  it('with too little room on either side for all its parts, over the bar rather than cut short', () => {
    // A bar in the middle of a 600 px window: 282 px above it, 248 below.
    const mid = placed(300)
    expect(mid).toMatchObject({ side: 'top', height: FORM_SIZE.least, sideOffset: FORM_GAP - (FORM_SIZE.least - 282) })
    expect(mid.to).toBe(300 - FORM_GAP + (FORM_SIZE.least - 282))
  })

  it('always inside the window, never shorter than its parts need', () => {
    for (let top = 60; top <= 560; top += 4) {
      const p = placed(top)
      expect(p.from).toBeGreaterThanOrEqual(FORM_EDGE)
      expect(p.to).toBeLessThanOrEqual(600 - FORM_EDGE)
      expect(p.height).toBeGreaterThanOrEqual(FORM_SIZE.least)
    }
  })

  it('moves along to stay inside the window’s width', () => {
    expect(formPlace(bar(100, 800), view).alignOffset).toBe(960 - FORM_EDGE - FORM_SIZE.width - 800)
    expect(formPlace(bar(100, 4), view).alignOffset).toBe(FORM_EDGE - 4)
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
