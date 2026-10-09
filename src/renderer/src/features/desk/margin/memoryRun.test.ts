import { describe, expect, it } from 'vitest'
import type { MemoryLogItem } from '@shared/types'
import { latestRun } from './memoryRun'

function item(id: string, over: Partial<MemoryLogItem> = {}): MemoryLogItem {
  return {
    id,
    runId: 'r1',
    sceneId: 's',
    entryName: 'Wren Halloway',
    text: 'Knows the ferry is early',
    before: '',
    after: '',
    action: 'added',
    what: 'change',
    entryId: 'e',
    factId: null,
    quote: 'the ferry was early',
    where: 'Book 1, Ch 1, Sc 1',
    question: null,
    createdAt: '2026-10-08T10:00:00.000Z',
    undone: false,
    ...over
  }
}

describe('the memory’s latest run on a scene', () => {
  it('keeps the newest run’s lines, leaving out what failed or was undone', () => {
    const run = latestRun([
      item('a', { runId: 'old', createdAt: '2026-10-08T09:00:00.000Z' }),
      item('b', { createdAt: '2026-10-08T10:00:01.000Z' }),
      item('c', { entryName: 'Iska Vey', text: 'New character', quote: 'Iska' }),
      item('d', { undone: true }),
      item('e', { action: 'failed', createdAt: '2026-10-08T11:00:00.000Z', runId: 'r2' }),
      item('f', { what: 'summary', text: 'Scene summary updated' })
    ])
    expect(run).toEqual({
      runId: 'r1',
      count: 3,
      lines: ['Wren Halloway: Knows the ferry is early', 'Iska Vey: New character', 'Scene summary updated'],
      quotes: ['the ferry was early', 'Iska', 'the ferry was early']
    })
  })

  it('is nothing when nothing changed', () => {
    expect(latestRun([])).toBeNull()
    expect(latestRun([item('a', { undone: true })])).toBeNull()
  })
})
