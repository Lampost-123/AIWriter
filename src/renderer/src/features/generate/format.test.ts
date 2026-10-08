import { describe, expect, it } from 'vitest'
import { budgetShare, creativityOf, estimateDraftCost, filterModels, formatContext, formatCost, pricePerMillion, relativeTime, shortModelName } from './format'

describe('format', () => {
  it('shortens model names', () => {
    expect(shortModelName('Acme: Story Writer 4')).toBe('Story Writer 4')
    expect(shortModelName('acme-labs/story-writer-8b')).toBe('story-writer-8b')
    expect(shortModelName('local-model')).toBe('local-model')
    expect(shortModelName('  ')).toBe('Unnamed model')
  })

  it('formats costs', () => {
    expect(formatCost(null)).toBe('—')
    expect(formatCost(0)).toBe('Free')
    expect(formatCost(0.0004)).toBe('<$0.001')
    expect(formatCost(0.0042)).toBe('$0.004')
    expect(formatCost(0.034)).toBe('$0.03')
    expect(formatCost(12.5)).toBe('$12.50')
  })

  it('formats prices per million tokens', () => {
    expect(pricePerMillion(0.000003)).toBe('$3')
    expect(pricePerMillion(0.00000015)).toBe('$0.15')
    expect(pricePerMillion(0.0000025)).toBe('$2.5')
    expect(pricePerMillion(0.00006)).toBe('$60')
    expect(pricePerMillion(0)).toBe('Free')
    expect(pricePerMillion(null)).toBe('—')
  })

  it('formats context sizes', () => {
    expect(formatContext(200000)).toBe('200K')
    expect(formatContext(8000)).toBe('8K')
    expect(formatContext(8192)).toBe('8.2K')
    expect(formatContext(512)).toBe('512')
    expect(formatContext(1048576)).toBe('1M')
    expect(formatContext(null)).toBe('—')
  })

  it('says how long ago', () => {
    const now = Date.parse('2026-10-01T12:00:00Z')
    expect(relativeTime('2026-10-01T11:59:50Z', now)).toBe('just now')
    expect(relativeTime('2026-10-01T11:59:00Z', now)).toBe('a minute ago')
    expect(relativeTime('2026-10-01T11:50:00Z', now)).toBe('10 minutes ago')
    expect(relativeTime('2026-10-01T11:00:00Z', now)).toBe('an hour ago')
    expect(relativeTime('2025-01-03T11:00:00Z', now)).toMatch(/2025/)
    expect(relativeTime('nonsense', now)).toBe('')
  })

  it('names the creativity preset', () => {
    expect(creativityOf({ temperature: 0.85, creativity: 'balanced' })).toBe('Balanced')
    expect(creativityOf({ temperature: 0.6 })).toBe('Steady')
    expect(creativityOf({ temperature: 0.3 })).toBe('Temperature 0.3')
    // Since 0.6.35 the writer writes Balanced at 1.0: a Continue record, which keeps only its temperature, reads so.
    expect(creativityOf({ temperature: 1 })).toBe('Balanced')
    expect(creativityOf({ temperature: 0.85 })).toBe('Balanced')
  })

  it('estimates a draft cost only when prices are known', () => {
    expect(estimateDraftCost(1000, 1000, { promptPrice: 0.000001, completionPrice: 0.000002 })).toBeCloseTo(0.001 + 1350 * 0.000002)
    expect(estimateDraftCost(1000, 1000, { promptPrice: null, completionPrice: null })).toBeNull()
  })

  it('filters models by every word typed', () => {
    const models = [
      { id: 'acme/story-writer-4', name: 'Acme: Story Writer 4', contextLength: 1, promptPrice: null, completionPrice: null },
      { id: 'quill/fast-7', name: 'Quill: Fast 7', contextLength: 1, promptPrice: null, completionPrice: null }
    ]
    expect(filterModels(models, 'writer 4').map((m) => m.id)).toEqual(['acme/story-writer-4'])
    expect(filterModels(models, '  ')).toHaveLength(2)
    expect(filterModels(models, 'QUILL')).toHaveLength(1)
  })

  it('works out the share of the budget', () => {
    expect(budgetShare(50, 100)).toBe(0.5)
    expect(budgetShare(0, 0)).toBe(0)
    expect(budgetShare(1, 0)).toBe(Infinity)
  })
})
