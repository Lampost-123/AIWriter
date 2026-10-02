import { describe, expect, it } from 'vitest'
import type { RecoveryItem } from '@shared/types'
import { itemsForWorld, shouldRestore } from './recovery'

const scene = { updatedAt: '2026-10-01T10:00:00.000Z', text: 'Saved text.', doc: { type: 'doc' } }

describe('shouldRestore', () => {
  it('restores newer writing that differs from the saved scene', () => {
    expect(shouldRestore({ savedAt: '2026-10-01T10:00:05.000Z', text: 'Saved text. And more.', doc: {} }, scene)).toBe(true)
  })

  it('ignores files older than the last save', () => {
    expect(shouldRestore({ savedAt: '2026-10-01T09:59:59.000Z', text: 'Older.', doc: {} }, scene)).toBe(false)
  })

  it('ignores files that match what was saved', () => {
    expect(shouldRestore({ savedAt: '2026-10-01T10:00:05.000Z', text: 'Saved text.', doc: { type: 'doc' } }, scene)).toBe(false)
  })

  it('restores formatting-only changes', () => {
    expect(shouldRestore({ savedAt: '2026-10-01T10:00:05.000Z', text: 'Saved text.', doc: { type: 'doc', content: [] } }, scene)).toBe(true)
  })
})

describe('itemsForWorld', () => {
  it('keeps only the open world', () => {
    const items: RecoveryItem[] = [
      { worldId: 'w1', sceneId: 's1', doc: null, text: 'a', savedAt: '1' },
      { worldId: 'w2', sceneId: 's2', doc: null, text: 'b', savedAt: '1' }
    ]
    expect(itemsForWorld(items, 'w1').map((i) => i.sceneId)).toEqual(['s1'])
  })
})
