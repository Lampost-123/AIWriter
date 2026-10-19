// Show me the plan first, in the window (logic.ts): the boxes read back as the plan's lists, a card check note as Adam
// reads it, and whether Adam changed anything.
import { describe, expect, it } from 'vitest'
import type { ScenePlanParts } from '@shared/contracts/planReview'
import { noteText, partsChanged, splitLines } from './logic'

const plan: ScenePlanParts = {
  wants: 'Mara wants the letter.',
  against: 'Tobin has it.',
  turn: 'She takes it.',
  beats: ['Mara reads the letter.', 'Tobin comes in.'],
  whoWhere: ['Mara: by the window'],
  changes: ['Mara, holding: nothing → the letter.'],
  closing: 'The letter burning.'
}

describe('the plan review', () => {
  it('reads a box a line each, leaving out empty lines and list marks', () => {
    expect(splitLines('Mara: by the window\n\n- Tobin: at the door\n2. Ash: asleep \n  ')).toEqual(['Mara: by the window', 'Tobin: at the door', 'Ash: asleep'])
  })

  it('shows a card check note without its lead', () => {
    expect(noteText('Before writing, note: this card’s When is earlier than Ch 1, Sc 2.')).toBe('This card’s When is earlier than Ch 1, Sc 2.')
  })

  it('knows when Adam changed something, and when he only moved the spaces about', () => {
    expect(partsChanged(plan, { ...plan })).toBe(false)
    expect(partsChanged(plan, { ...plan, beats: ['Mara  reads the letter. ', 'Tobin comes in.'] })).toBe(false)
    expect(partsChanged(plan, { ...plan, beats: ['Mara burns the letter.', 'Tobin comes in.'] })).toBe(true)
    expect(partsChanged(plan, { ...plan, beats: ['Mara reads the letter.'] })).toBe(true)
    expect(partsChanged(plan, { ...plan, closing: '' })).toBe(true)
  })
})
