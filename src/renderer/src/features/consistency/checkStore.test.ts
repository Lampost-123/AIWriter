// Starting and stopping a check: Stop pressed while the check is still being got ready is never lost,
// and a check belongs to the world it was started in.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls: string[] = []
let release: () => void = () => undefined
const appState = { stories: [{ id: 'story', title: 'Book 1' }], view: { kind: 'write' }, world: { id: 'w1' } as { id: string } | null }
const appListeners: ((now: typeof appState, before: typeof appState) => void)[] = []

vi.mock('@/lib/api', () => ({
  api: {
    getOutline: vi.fn(async () => null),
    startCheck: vi.fn(async () => void calls.push('start')),
    stopCheck: vi.fn(async () => void calls.push('stop'))
  },
  onEvent: () => () => undefined
}))
vi.mock('@/lib/flush', () => ({ flushAll: () => new Promise<void>((r) => (release = r)) }))
vi.mock('@/components/ui', () => ({ toast: (m: string) => void calls.push(`toast:${m}`) }))
vi.mock('@/lib/store', () => ({
  useApp: {
    getState: () => appState,
    subscribe: (fn: (typeof appListeners)[number]) => appListeners.push(fn)
  }
}))
vi.mock('@/features/binder/outlineStore', () => ({ useOutlineStore: { getState: () => ({ outline: null }) } }))

const { checkStory, stopCheck, useChecks } = await import('./checkStore')

/** Lets pending promises run. */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

describe('checking a story', () => {
  beforeEach(() => {
    calls.length = 0
    useChecks.setState({ run: null, failure: null })
  })

  it('starts the check once its words are saved, and Stop then reaches it', async () => {
    const started = checkStory('story')
    await settle()
    expect(calls).toEqual([])
    release()
    await started
    expect(calls).toEqual(['start'])
    await stopCheck()
    expect(calls).toEqual(['start', 'stop'])
  })

  it('never starts a check stopped while it was being got ready', async () => {
    const started = checkStory('story')
    await settle()
    await stopCheck()
    expect(useChecks.getState().run?.stopping).toBe(true)
    release()
    await started
    expect(calls).toEqual(['toast:Check of Book 1 stopped.'])
    expect(useChecks.getState().run).toBeNull()
  })

  it('forgets a check when another world opens', async () => {
    const started = checkStory('story')
    await settle()
    const before = { ...appState }
    appState.world = { id: 'w2' }
    for (const fn of appListeners) fn(appState, before)
    expect(useChecks.getState().run).toBeNull()
    release()
    await started
    expect(calls).toEqual([])
    appState.world = { id: 'w1' }
  })
})
