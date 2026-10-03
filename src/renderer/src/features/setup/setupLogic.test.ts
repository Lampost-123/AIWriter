// The first run's step logic, the writer model it recommends, and the first scene's guide (milestone 6).

import { describe, expect, it } from 'vitest'
import type { ModelInfo } from '@shared/types'
import { emptySceneCard } from '@shared/defaults'
import { cardFilled, guideStep, nextStep, previousStep, recommendWriter, stepNumber } from './setupLogic'

const model = (id: string): ModelInfo => ({ id, name: id, contextLength: 200000, promptPrice: 0.000003, completionPrice: 0.000015 })

describe('steps', () => {
  it('go in order, with no step before the first or after the last', () => {
    expect(stepNumber('world')).toBe(1)
    expect(stepNumber('builder')).toBe(5)
    expect(nextStep('world')).toBe('connect')
    expect(nextStep('style')).toBe('builder')
    expect(nextStep('builder')).toBeNull()
    expect(previousStep('connect')).toBe('world')
    expect(previousStep('world')).toBeNull()
  })
})

describe('recommendWriter', () => {
  it('suggests the newest of the best maker on the list', () => {
    const list = ['openai/gpt-5', 'anthropic/claude-3.7-sonnet', 'anthropic/claude-sonnet-4.5', 'anthropic/claude-sonnet-4'].map(model)
    expect(recommendWriter(list)?.model.id).toBe('anthropic/claude-sonnet-4.5')
  })

  it('leaves out special editions', () => {
    const list = ['anthropic/claude-sonnet-4.5:thinking', 'openai/gpt-5-mini', 'openai/gpt-4.1'].map(model)
    expect(recommendWriter(list)?.model.id).toBe('openai/gpt-4.1')
  })

  it('suggests nothing when no model fits (another provider’s own names)', () => {
    expect(recommendWriter(['fake/writer', 'llama3:8b'].map(model))).toBeNull()
  })

  it('says why in plain words', () => {
    expect(recommendWriter([model('anthropic/claude-sonnet-4.5')])?.why).toMatch(/prose/)
  })
})

describe('the first scene’s guide', () => {
  const at = (patch: Partial<Parameters<typeof guideStep>[0]>) =>
    guideStep({ card: false, words: 0, drafting: false, edited: false, done: false, ...patch })

  it('knows when the card says something', () => {
    expect(cardFilled(null)).toBe(false)
    expect(cardFilled(emptySceneCard())).toBe(false)
    expect(cardFilled({ ...emptySceneCard(), goal: 'Wren lights the lamp' })).toBe(true)
    expect(cardFilled({ ...emptySceneCard(), presentIds: ['a'] })).toBe(true)
    expect(cardFilled({ ...emptySceneCard(), beats: ['  '] })).toBe(false)
  })

  it('follows what Adam does: card, Generate, edit, Mark done', () => {
    expect(at({})).toBe('card')
    expect(at({ card: true })).toBe('generate')
    expect(at({ card: true, drafting: true, words: 120 })).toBe('generate')
    expect(at({ card: true, words: 400 })).toBe('edit')
    expect(at({ card: true, words: 410, edited: true })).toBe('done')
    expect(at({ card: true, words: 410, edited: true, done: true })).toBe('finished')
  })

  it('lets him skip ahead: writing without a card, or marking done early', () => {
    expect(at({ words: 50 })).toBe('edit')
    expect(at({ drafting: true })).toBe('generate')
    expect(at({ done: true })).toBe('finished')
  })
})
