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

describe('“same” for the narration', () => {
  it('carries on the mood before it, not no mood', () => {
    const [two] = markParts([{ id: 'p1', text: 'She ran.' }, { id: 'p2', text: 'The door held.' }], ['p1', 'p2'], new Set(), 5000, 5000)
    const got = marksFrom(two, { '1': 'tense, quick | sigh', '2': 'same' }, undefined, cast)
    expect(got.get('p2')!.delivery).toEqual({ '~the door held': { tone: 'tense, quick' } })
    // With nothing before it, it is just asked about.
    expect(marksFrom(two, { '1': 'same', '2': 'same' }, undefined, cast).get('p1')!.delivery).toEqual({ '~she ran': {} })
  })
})

describe('a line given a speaker but no note on how it is said', () => {
  it('is asked about once more, then kept as it is', () => {
    const quote = 'Adam swallowed. “I’m not scared.”'
    const [first] = markParts([{ id: 'b1', text: quote }], ['b1'], new Set(), 5000, 5000)
    const once = marksFrom(first, { '1': 'tense', '2': 'Adam' }, undefined, cast).get('b1')!
    expect(once.speakers).toEqual({ 'i m not scared': 'Adam' })
    expect(once.delivery).toEqual({ '~adam swallowed': { tone: 'tense' } })
    // Asked again: the speaker is known now, and a second reply with no note is kept, so it isn't asked again.
    const [again] = markParts([{ id: 'b1', text: quote, ...once }], ['b1'], new Set(), 5000, 5000)
    expect(again.asks).toEqual([{ blockId: 'b1', key: 'i m not scared', quote: true, again: true }])
    expect(marksFrom(again, { '1': 'Adam' }, undefined, cast).get('b1')!.delivery).toEqual({ 'i m not scared': {} })
  })
})

describe('who is in the scene', () => {
  it('tells the AI who is there, and that someone only mentioned isn’t speaking', () => {
    const [jane, laura] = castOf([
      { id: 'j', name: 'Jane', aliases: [], about: '' },
      { id: 'l', name: 'Laura', aliases: [], about: '' }
    ])
    const prompt = MARK_PROMPT([{ ...jane, here: true }, laura])
    expect(prompt).toContain('- Jane [in this scene]')
    expect(prompt).toContain('- Laura\n')
    expect(prompt).toContain('Someone only mentioned, remembered or thought about does not speak in it')
    expect(MARK_PROMPT([jane, laura])).not.toContain('[in this scene]')
  })
})
