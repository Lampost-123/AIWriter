// Writing during a build (2026-10-17): Generate knows when the story's cast is still being built, from the World
// builder's events, and from the main process for a build that began before the window listened. Invented ids only.
import { describe, expect, it, vi } from 'vitest'

const s = vi.hoisted(() => ({
  handlers: new Map<string, (p: unknown) => void>(),
  running: null as { buildId: string; storyId: string | null } | null
}))

vi.mock('@/lib/api', () => ({
  api: { getWorldBuilder: async () => ({ summary: '', running: s.running, last: null }) },
  onEvent: (name: string, fn: (p: unknown) => void) => void s.handlers.set(name, fn)
}))
vi.mock('@/lib/store', () => ({ useApp: { getState: () => ({ world: { id: 'w1' } }), subscribe: () => () => undefined } }))

const { castBuilding, useBuildWatch, watchBuilds } = await import('./buildWatch')

describe('whether a draft waits on a build', () => {
  it('is its own story’s build, or one for the beginning of the world', () => {
    expect(castBuilding(null, 'st-salt')).toBe(false)
    expect(castBuilding({ buildId: 'b1', storyId: 'st-salt' }, 'st-salt')).toBe(true)
    expect(castBuilding({ buildId: 'b1', storyId: 'st-ash' }, 'st-salt')).toBe(false)
    expect(castBuilding({ buildId: 'b1', storyId: null }, 'st-salt')).toBe(true)
  })

  it('follows builds from their events, and asks about one already running', async () => {
    s.running = { buildId: 'b0', storyId: 'st-salt' }
    watchBuilds()
    await vi.waitFor(() => expect(useBuildWatch.getState().running).toEqual({ buildId: 'b0', storyId: 'st-salt' }))
    s.handlers.get('worldBuilder:done')!({ buildId: 'b0' })
    expect(useBuildWatch.getState().running).toBeNull()
    s.handlers.get('worldBuilder:progress')!({ buildId: 'b2', storyId: 'st-ash', stage: 'characters', step: '', made: [], retrying: null })
    expect(castBuilding(useBuildWatch.getState().running, 'st-ash')).toBe(true)
    // Another build's end leaves this one running.
    s.handlers.get('worldBuilder:done')!({ buildId: 'b9' })
    expect(useBuildWatch.getState().running?.buildId).toBe('b2')
    s.handlers.get('worldBuilder:done')!({ buildId: 'b2' })
    expect(castBuilding(useBuildWatch.getState().running, 'st-ash')).toBe(false)
  })
})
