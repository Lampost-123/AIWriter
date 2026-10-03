// Reading a "Mark who says what" reply: a note that slipped onto the wrong line (a model that skipped numbers or
// renumbered) is left out, and "same" carries the narration's mood on.
import { describe, expect, it } from 'vitest'
import { castOf } from './cast'
import { MARK_PROMPT, markParts, marksFrom } from './speakers'

const cast = castOf([{ id: 'adam', name: 'Adam', aliases: [], about: '' }])
const text = 'Adam swallowed. The room was dark. “I’m not scared.”'
const [part] = markParts([{ id: 'b1', text }], ['b1'], new Set(), 5000, 5000)

describe('a Mark who says what reply', () => {
  it('asks for a note on every number, none skipped', () => {
    expect(part.asks.map((a) => a.quote)).toEqual([false, false, true])
    expect(MARK_PROMPT(cast)).toContain('Every number gets a note, in order: never skip a number or renumber.')
  })

  it('keeps notes that fit, and “same” carries the mood on', () => {
    const got = marksFrom(part, { '1': 'tense, hushed', '2': 'same', '3': 'Adam | shaky, trying to sound brave' }, undefined, cast).get('b1')!
    expect(Object.values(got.delivery)).toEqual([{ tone: 'tense, hushed' }, { tone: 'shaky, trying to sound brave' }])
    expect(Object.values(got.speakers)).toEqual(['Adam'])
  })

  it('leaves out notes that slipped: a character’s note on narration, a mood as a speaker', () => {
    const got = marksFrom(part, { '1': 'Adam | shaky, trying to sound brave', '2': 'tense', '3': 'hushed, dread building | slow' }, undefined, cast).get('b1')!
    expect(Object.values(got.speakers)).toEqual(['?'])
    // Only the second sentence's note is kept; the quote's is empty, so the rules decide who says it.
    expect(Object.values(got.delivery)).toEqual([{ tone: 'tense' }, {}])
  })
})
