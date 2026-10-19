// Starting and stopping a check: Stop pressed while the check is still being got ready is never lost,
// and a check belongs to the world it was started in.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls: string[] = []
let release: () => void = () => undefined
const appState = { stories: [{ id: 'story', title: 'Book 1' }], view: { kind: 'write' }, world: { id: 'w1' } as { id: string } | null }
const appListeners: ((now: typeof appState, before: typeof appState) => void)[] = []

const events = vi.hoisted(() => new Map<string, (p: unknown) => void>())

vi.mock('@/lib/api', () => ({
  api: {
    getOutline: vi.fn(async () => null),
    startCheck: vi.fn(async () => void calls.push('start')),
    stopCheck: vi.fn(async (id: string) => void calls.push(`stop${id.startsWith('done:') ? ':done' : ''}`)),
    checkWithoutWaiting: vi.fn(async (id: string) => void calls.push(`now:${id}`))
  },
  onEvent: (name: string, fn: (p: unknown) => void) => {
    events.set(name, fn)
    return () => undefined
  }
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

const { adamsRunWords, checkStory, checkWithoutWaiting, onCheckEnded, stopCheck, stopRun, useChecks } = await import('./checkStore')

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

describe('every check in one store', () => {
  const fire = (name: string, p: unknown): void => events.get(name)!(p)
  const progress = (runId: string, more: object = {}) => ({
    runId,
    target: { scope: 'scene', id: 's1' },
    done: 0,
    total: 1,
    current: 'Ch 1, Sc 1: The ferry',
    sceneIds: ['s1'],
    currentSceneId: 's1',
    ...more
  })

  beforeEach(() => {
    calls.length = 0
    useChecks.setState({ run: null, runs: {}, failed: {}, failure: null })
  })

  it('follows a check started by marking a scene done, and Stop reaches it', async () => {
    // Listening began with the first check above.
    fire('checks:progress', progress('done:s1:x'))
    expect(Object.keys(useChecks.getState().runs)).toEqual(['done:s1:x'])
    expect(useChecks.getState().runs['done:s1:x'].background).toBe(true)
    await stopRun('done:s1:x')
    expect(calls).toEqual(['stop:done'])
    const ends: string[] = []
    const off = onCheckEnded((d) => ends.push(`${d.run?.runId}:${d.status}:${d.scenes.join()}`))
    fire('checks:done', { runId: 'done:s1:x', target: { scope: 'scene', id: 's1' }, status: 'stopped', error: null, found: 0, background: true })
    off()
    expect(useChecks.getState().runs).toEqual({})
    expect(ends).toEqual(['done:s1:x:stopped:s1'])
  })

  it('says what Adam’s check waits for, and Check now goes ahead without the memory', async () => {
    const started = checkStory('story')
    await new Promise((r) => setTimeout(r, 0))
    release()
    await started
    const run = useChecks.getState().run!
    expect(adamsRunWords(run)).toBe('Getting ready to check Book 1…')
    fire('checks:progress', { ...progress(run.runId), target: { scope: 'story', id: 'story' }, waiting: 'memory' })
    const s = useChecks.getState()
    expect(adamsRunWords(s.run!, { runs: s.runs })).toBe('Waiting for the memory to catch up…')
    await checkWithoutWaiting(run.runId)
    expect(calls).toContain(`now:${run.runId}`)
    fire('checks:done', { runId: run.runId, target: { scope: 'story', id: 'story' }, status: 'error', error: 'The model turned it down. Pick another in Settings › Models.', found: 0 })
    expect(useChecks.getState().run).toBeNull()
    expect(useChecks.getState().failed).toEqual({ s1: 'The model turned it down. Pick another in Settings › Models.' })
    expect(useChecks.getState().failure?.message).toBe('The model turned it down. Pick another in Settings › Models.')
  })
})
