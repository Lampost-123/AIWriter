// The direction receipt (2026-10-19): which of Adam's asks a draft landed, from the scene's check report. Invented text.
import { describe, expect, it } from 'vitest'
import type { ContractCheck } from '@shared/contracts/checks'
import { allLanded, isFresh, RECEIPT_FRESH_MS, receiptLabel, receiptOf, toWriteIn, writeInDirection } from './receipt'

const AT = '2026-10-19T10:00:00.000Z'
const check = (over: Partial<ContractCheck> = {}): { contract: ContractCheck } => ({
  contract: {
    at: AT,
    asks: 'scene',
    recordId: 'draft-1',
    items: [
      { part: 'start', text: 'Mira: holding: the key', result: 'kept' },
      { part: 'change', text: 'Mira lies about the key', result: 'kept', ask: 'event' },
      { part: 'change', text: 'End on the knock', result: 'kept', ask: 'event' },
      { part: 'change', text: 'More dialogue', result: 'not yet', ask: 'reads' },
      { part: 'change', text: 'Keep it under 800 words', result: 'not yet', ask: 'length' },
      { part: 'change', text: 'Tobin reaches the gate', result: 'not yet' },
      { part: 'keep', text: 'Ash is dead', result: 'untouched' }
    ],
    ...over
  }
})

describe('the direction receipt', () => {
  it('is each ask of the direction, landed or not; never the card’s items', () => {
    const r = receiptOf(check())!
    expect(r.recordId).toBe('draft-1')
    expect(r.asks).toEqual([
      { text: 'Mira lies about the key', kind: 'event', landed: true },
      { text: 'End on the knock', kind: 'event', landed: true },
      { text: 'More dialogue', kind: 'reads', landed: false },
      { text: 'Keep it under 800 words', kind: 'length', landed: false }
    ])
    expect(allLanded(r)).toBe(false)
    expect(receiptLabel(r)).toBe(
      'Your direction: Mira lies about the key, done; End on the knock, done; More dialogue, not yet; Keep it under 800 words, not yet.'
    )
  })

  it('Write it in asks Continue for what didn’t land, never for a length', () => {
    const r = receiptOf(check())!
    expect(toWriteIn(r).map((a) => a.text)).toEqual(['More dialogue'])
    expect(writeInDirection(r)).toBe('More dialogue.')
    const two = receiptOf(
      check({
        items: [
          { part: 'change', text: 'Mira lies about the key', result: 'untouched', ask: 'event' },
          { part: 'change', text: 'End on the knock!', result: 'broken', ask: 'event' }
        ]
      })
    )!
    expect(writeInDirection(two)).toBe('Mira lies about the key. End on the knock!')
  })

  it('all landed: quiet', () => {
    const r = receiptOf(check({ items: [{ part: 'change', text: 'Mira lies about the key', result: 'kept', ask: 'event' }] }))!
    expect(allLanded(r)).toBe(true)
    expect(writeInDirection(r)).toBe('')
  })

  it('none for a check that wasn’t of a draft as it landed, a draft with no direction, or asks left unanswered', () => {
    expect(receiptOf(null)).toBeNull()
    expect(receiptOf({})).toBeNull()
    // Check this scene, Mark done, the chapter writer: no record.
    expect(receiptOf(check({ recordId: undefined }))).toBeNull()
    // Continue and a beat have no receipt.
    expect(receiptOf(check({ asks: 'continue' }))).toBeNull()
    expect(receiptOf(check({ asks: 'beat' }))).toBeNull()
    expect(receiptOf(check({ asks: 'stretch' }))).not.toBeNull()
    expect(receiptOf(check({ items: [{ part: 'change', text: 'Tobin reaches the gate', result: 'kept' }] }))).toBeNull()
    expect(receiptOf(check({ items: [{ part: 'change', text: 'More dialogue', result: 'unchecked', ask: 'reads' }] }))).toBeNull()
  })

  it('shows only while fresh', () => {
    const at = Date.parse(AT)
    expect(isFresh({ at: AT }, at + 1_000)).toBe(true)
    expect(isFresh({ at: AT }, at + RECEIPT_FRESH_MS + 1)).toBe(false)
    expect(isFresh({ at: 'not a time' }, at)).toBe(false)
  })
})
