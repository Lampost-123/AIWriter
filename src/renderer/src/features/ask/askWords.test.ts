import { describe, expect, it } from 'vitest'
import { answerNote, asOfText, chatWhen, savedMessage } from './askWords'

describe('Ask the world’s words', () => {
  it('say when a chat was last asked in, briefly', () => {
    const now = Date.parse('2026-10-02T15:00:00')
    expect(chatWhen('2026-10-02T09:05:00', now)).toMatch(/09.05/)
    expect(chatWhen('2026-10-01T22:00:00', now)).toBe('Yesterday')
    expect(chatWhen('2026-03-04T10:00:00', now)).not.toMatch(/2026/)
    expect(chatWhen('2025-03-04T10:00:00', now)).toMatch(/2025/)
    expect(chatWhen('not a date', now)).toBe('')
  })

  it('say where answers are from', () => {
    expect(asOfText({ hasScene: true, sceneLabel: 'Book 1, Ch 2, Sc 3', storyTitle: 'Book 1' })).toBe('As of Book 1, Ch 2, Sc 3')
    expect(asOfText({ hasScene: false, sceneLabel: null, storyTitle: 'Book 1' })).toBe('As of the end of Book 1')
    expect(asOfText({ hasScene: false, sceneLabel: null, storyTitle: null })).toBe('Your world as it was set up')
  })

  it('say quietly how an answer ended and what it cost', () => {
    const base = { status: 'complete', cutOff: false, cost: 0.0021, costEstimated: false, answer: 'Yes.' }
    expect(answerNote(base)).toEqual(['$0.002'])
    expect(answerNote({ ...base, status: 'stopped', costEstimated: true })).toEqual(['Stopped', 'about $0.002'])
    expect(answerNote({ ...base, cutOff: true, cost: null })).toEqual(['Cut short'])
    expect(answerNote({ ...base, status: 'streaming' })).toEqual([])
  })

  it('say what saving did', () => {
    expect(savedMessage({ name: 'Mara Venn', created: false, onlyIn: null })).toBe('Saved to memory for Mara Venn, as your own note.')
    expect(savedMessage({ name: 'Mara Venn', created: false, onlyIn: 'Mara Keeps Her Hand' })).toBe(
      'Saved to memory for Mara Venn, in Mara Keeps Her Hand only.'
    )
    expect(savedMessage({ name: 'Tavern names that fit the north', created: true, onlyIn: null })).toBe(
      'Saved to your lore as “Tavern names that fit the north”.'
    )
  })
})
