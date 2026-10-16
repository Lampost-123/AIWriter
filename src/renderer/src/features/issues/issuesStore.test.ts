// Findings that stay current (2026-10-16): a scene's issues are read once for each change of world or memory, and again
// when Adam comes back to the scene after leaving it (the answer kept shows meanwhile). The main process stood in for.
import { describe, expect, it, vi } from 'vitest'

const main = vi.hoisted(() => ({ asked: [] as string[] }))

vi.mock('@/lib/api', () => ({
  api: {
    listIssues: async (id: string) => {
      main.asked.push(id)
      return []
    }
  },
  onEvent: () => () => undefined
}))
vi.mock('@/lib/store', async () => {
  const { create: make } = await import('zustand')
  return { useApp: make(() => ({ sceneId: 's1' as string | null, world: { id: 'w1' } })) }
})
vi.mock('@/lib/flush', () => ({ registerDiscarder: () => () => undefined }))
vi.mock('@/components/ui', () => ({ toast: () => 1 }))
vi.mock('@/features/memory/openScene', () => ({ openScene: async () => undefined }))

import { useApp } from '@/lib/store'
import { wantIssues } from './issuesStore'

const openScene = (sceneId: string): void => (useApp as unknown as { setState: (s: object) => void }).setState({ sceneId })

describe('reading a scene’s issues', () => {
  it('once per change, and again when Adam comes back to the scene', async () => {
    wantIssues('s1', 'w1:0')
    wantIssues('s1', 'w1:0')
    expect(main.asked).toEqual(['s1'])
    // The memory changed: read again.
    wantIssues('s1', 'w1:1')
    expect(main.asked).toEqual(['s1', 's1'])
    // Another scene opened, then this one again: read again, though nothing else changed.
    openScene('s2')
    wantIssues('s2', 'w1:1')
    openScene('s1')
    wantIssues('s1', 'w1:1')
    expect(main.asked).toEqual(['s1', 's1', 's2', 's1'])
    // Staying in the scene: not read again.
    wantIssues('s1', 'w1:1')
    expect(main.asked).toEqual(['s1', 's1', 's2', 's1'])
  })
})
