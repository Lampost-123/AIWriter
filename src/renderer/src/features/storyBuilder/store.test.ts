// A story's brief that couldn't be read is never saved over (review #4, 2026-10-21): the screen says so with Try again,
// and nothing typed meanwhile writes an empty brief over the real one. The main process stood in for.
import { describe, expect, it, vi } from 'vitest'
import type { StoryBrief } from '@shared/contracts/storyBuilder'
import { emptyBrief } from '@shared/contracts/storyBuilder'

const main = vi.hoisted(() => ({ fail: true, saved: [] as unknown[] }))

vi.mock('@/lib/api', () => ({
  api: {
    getStoryBrief: async () => {
      if (main.fail) throw new Error('locked')
      return { ...emptyBrief(), plot: 'The real idea' }
    },
    saveStoryBrief: async (_id: string, brief: StoryBrief) => void main.saved.push(brief)
  },
  ApiError: class extends Error {},
  onEvent: () => () => undefined
}))
vi.mock('@/lib/store', async () => {
  const { create: make } = await import('zustand')
  return { useApp: make(() => ({ world: { id: 'w1' } })) }
})
vi.mock('@/lib/flush', () => ({ registerFlusher: () => () => undefined }))
vi.mock('@/components/ui', () => ({ toast: () => 1 }))
vi.mock('@/features/planning/talkStore', () => ({ say: async () => undefined, settlePreview: () => undefined, talkOf: () => ({}) }))
vi.mock('@/features/outline/helperStore', () => ({ setKeepBuild: () => undefined }))
vi.mock('@/features/outline/size', () => ({ defaultSize: () => ({ acts: 0, chapters: 1, scenes: 1 }) }))
vi.mock('@/features/worldBuilder/storyBuild', () => ({ madeWords: () => '' }))

import { builderKey, flushBrief, loadBrief, patchBrief, useBuilders, writeIdea } from './store'

const builder = (id: string) => useBuilders.getState().builders[builderKey(id)]

describe('a story brief that failed to load', () => {
  it('says so, saves nothing over it, and loads on Try again', async () => {
    await loadBrief('s1')
    expect(builder('s1')?.brief).toBeNull()
    expect(builder('s1')?.briefFailed).toBe(true)

    writeIdea('s1', 'typed while it failed')
    patchBrief('s1', { setting: 'somewhere' })
    await flushBrief('s1')
    expect(main.saved).toEqual([])

    main.fail = false
    await loadBrief('s1')
    expect(builder('s1')?.brief?.plot).toBe('The real idea')
    expect(builder('s1')?.briefFailed).toBe(false)

    patchBrief('s1', { setting: 'a harbour' })
    await flushBrief('s1')
    expect(main.saved).toEqual([{ ...emptyBrief(), plot: 'The real idea', setting: 'a harbour' }])
  })
})
