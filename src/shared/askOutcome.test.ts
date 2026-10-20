// The outcome line under a chat answer (chat-truth R1): built only from what the app recorded, never from the AI's words.
import { describe, expect, it } from 'vitest'
import { outcomeOf, type OutcomeChange } from './askOutcome'

const ch = (...statuses: OutcomeChange['status'][]): OutcomeChange[] => statuses.map((status) => ({ status }))

describe('outcomeOf', () => {
  it('says nothing while the answer is still coming', () => {
    expect(outcomeOf({ finished: false, changes: ch('pending') })).toEqual({ state: 'unknown', parts: [], words: null })
  })

  it('shows no line for an old answer with nothing recorded (never a wrong one)', () => {
    expect(outcomeOf({ finished: true, recorded: false, changes: [] })).toMatchObject({ state: 'unknown', words: null })
  })

  it('nothing changed', () => {
    expect(outcomeOf({ finished: true, changes: [] })).toMatchObject({ state: 'none', words: 'Nothing was changed.' })
  })

  it('nothing changed, with why when a change was tried and turned down', () => {
    const o = outcomeOf({ finished: true, changes: [], refused: 'Mara has no “Favourite colour” field.' })
    expect(o).toMatchObject({ state: 'refused', words: 'Nothing was changed: Mara has no “Favourite colour” field.' })
  })

  it('waiting, one and many, with the count in amber', () => {
    const one = outcomeOf({ finished: true, changes: ch('pending') })
    expect(one).toMatchObject({ state: 'waiting', words: '1 change is waiting for you: press Apply.' })
    expect(one.parts[0]).toEqual({ text: '1 change is waiting for you', tone: 'ai' })
    expect(outcomeOf({ finished: true, changes: ch('pending', 'pending', 'pending') }).words).toBe('3 changes are waiting for you: press Apply.')
  })

  it('waiting, said of a preview (the talks)', () => {
    const o = outcomeOf({ finished: true, changes: ch('pending', 'pending'), where: 'The plan below' })
    expect(o).toMatchObject({ state: 'waiting', words: 'The plan below has 2 changes waiting: press Apply.' })
    expect(o.parts.find((p) => p.tone)).toEqual({ text: '2 changes waiting', tone: 'ai' })
  })

  it('started', () => {
    expect(outcomeOf({ finished: true, changes: ch('started') })).toMatchObject({ state: 'started', words: '1 change has started.' })
    expect(outcomeOf({ finished: true, changes: ch('started', 'started') }).words).toBe('2 changes have started.')
  })

  it('applied, in green', () => {
    const o = outcomeOf({ finished: true, changes: ch('applied', 'applied') })
    expect(o).toMatchObject({ state: 'applied', words: 'Applied.' })
    expect(o.parts[0]).toEqual({ text: 'Applied', tone: 'success' })
  })

  it('partly applied: the rest turned down', () => {
    expect(outcomeOf({ finished: true, changes: ch('applied', 'applied', 'declined') })).toMatchObject({ state: 'partly', words: '2 of 3 applied.' })
  })

  it('turned down', () => {
    expect(outcomeOf({ finished: true, changes: ch('declined') })).toMatchObject({ state: 'declined', words: 'Not applied: you turned it down.' })
    expect(outcomeOf({ finished: true, changes: ch('declined', 'declined') }).words).toBe('Not applied: you turned them down.')
  })

  it('mixed cases read naturally', () => {
    const o = outcomeOf({ finished: true, changes: ch('applied', 'pending', 'pending') })
    expect(o).toMatchObject({ state: 'waiting', words: '1 applied, 2 waiting: press Apply.' })
    expect(o.parts.filter((p) => p.tone)).toEqual([
      { text: '1 applied', tone: 'success' },
      { text: '2 waiting', tone: 'ai' }
    ])
    expect(outcomeOf({ finished: true, changes: ch('applied', 'started', 'declined') })).toMatchObject({ state: 'started', words: '1 applied, 1 started.' })
    expect(outcomeOf({ finished: true, changes: ch('started', 'pending') }).words).toBe('1 started, 1 waiting: press Apply.')
  })

  it('a change that could not go in is the only red', () => {
    const o = outcomeOf({ finished: true, changes: [{ status: 'pending', failed: true }] })
    expect(o).toMatchObject({ state: 'failed', words: '1 change couldn’t be applied: see why on its card.' })
    expect(o.parts[0].tone).toBe('danger')
    expect(outcomeOf({ finished: true, changes: [{ status: 'applied' }, { status: 'pending', failed: true }] }).words).toBe(
      '1 applied, 1 couldn’t be applied: see why on its card.'
    )
    expect(outcomeOf({ finished: true, changes: [{ status: 'pending' }, { status: 'pending', failed: true }] }).words).toBe(
      '1 waiting, 1 couldn’t be applied: press Apply.'
    )
  })

  it('no red anywhere else', () => {
    for (const changes of [ch(), ch('pending'), ch('started'), ch('applied'), ch('declined'), ch('applied', 'declined')]) {
      expect(outcomeOf({ finished: true, changes }).parts.some((p) => p.tone === 'danger')).toBe(false)
    }
  })
})
