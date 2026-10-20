import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CHANGE_WINDOW_MS, createChangeBatcher, reloadsFor, type MemoryChange, type Reloads } from './changeBatch'

const keeperRead = (sceneId: string, entryIds: string[] = []): MemoryChange => ({ sceneId, entryIds })
const entryEdit = (...entryIds: string[]): MemoryChange => ({ sceneId: null, entryIds })
const buildSave = (...entryIds: string[]): MemoryChange => ({ sceneId: '', entryIds })

describe('reloadsFor', () => {
  it('reloads only the kinds of view a batch of changes touched', () => {
    // The memory read a scene and changed two entries: everything but the stories.
    expect(reloadsFor([keeperRead('s1', ['e1', 'e2'])])).toEqual({ memory: true, entries: true, outline: true, stories: false })
    // A scene's summary or its "Memory not updated" mark: no entry changed.
    expect(reloadsFor([keeperRead('s1')])).toEqual({ memory: true, entries: false, outline: true, stories: false })
    // Adam's edit of an entry, or anything not about one scene: the stories may have changed too.
    expect(reloadsFor([entryEdit('e1')])).toEqual({ memory: true, entries: true, outline: true, stories: true })
    // A change about nothing in particular (an undo of the memory check list): everything.
    expect(reloadsFor([entryEdit()])).toEqual({ memory: true, entries: true, outline: true, stories: true })
    // A World build's saves while it runs only add entries: not the outline, nor the stories.
    expect(reloadsFor([buildSave('e1'), buildSave('e2')])).toEqual({ memory: true, entries: true, outline: false, stories: false })
    expect(reloadsFor([])).toEqual({ memory: false, entries: false, outline: false, stories: false })
  })

  it('merges what each change asks for', () => {
    expect(reloadsFor([buildSave('e1'), keeperRead('s1')])).toEqual({ memory: true, entries: true, outline: true, stories: false })
    expect(reloadsFor([keeperRead('s1'), keeperRead('s2'), entryEdit('e3')])).toEqual({ memory: true, entries: true, outline: true, stories: true })
  })
})

describe('createChangeBatcher', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const record = (): { calls: { r: Reloads; changes: MemoryChange[] }[]; reload: (r: Reloads, changes: MemoryChange[]) => void } => {
    const calls: { r: Reloads; changes: MemoryChange[] }[] = []
    return { calls, reload: (r, changes) => calls.push({ r, changes }) }
  }

  it('reloads once for a run of changes, a moment after the first of them', () => {
    const { calls, reload } = record()
    const batch = createChangeBatcher(reload)
    for (let i = 0; i < 40; i++) batch.push(keeperRead('s1', [`e${i}`]))
    expect(calls).toHaveLength(0)
    vi.advanceTimersByTime(CHANGE_WINDOW_MS - 1)
    expect(calls).toHaveLength(0)
    vi.advanceTimersByTime(1)
    expect(calls).toHaveLength(1)
    expect(calls[0].changes).toHaveLength(40)
    expect(calls[0].r).toEqual({ memory: true, entries: true, outline: true, stories: false })
    // Nothing more without another change.
    vi.advanceTimersByTime(CHANGE_WINDOW_MS * 3)
    expect(calls).toHaveLength(1)
  })

  it('is never pushed back by changes that keep coming, so a long run still shows as it goes', () => {
    const { calls, reload } = record()
    const batch = createChangeBatcher(reload)
    // A change every 100 ms for two seconds: about one reload every window, not one at the end.
    for (let t = 0; t < 2000; t += 100) {
      batch.push(buildSave(`e${t}`))
      vi.advanceTimersByTime(100)
    }
    expect(calls.length).toBeGreaterThanOrEqual(4)
    expect(calls.length).toBeLessThanOrEqual(6)
    expect(calls.flatMap((c) => c.changes)).toHaveLength(20)
  })

  it('reloads at once when flushed, and forgets what was waiting when cancelled', () => {
    const { calls, reload } = record()
    const batch = createChangeBatcher(reload)
    batch.push(entryEdit('e1'))
    batch.flush()
    expect(calls).toHaveLength(1)
    vi.advanceTimersByTime(CHANGE_WINDOW_MS)
    expect(calls).toHaveLength(1)
    batch.flush()
    expect(calls).toHaveLength(1)

    batch.push(entryEdit('e2'))
    batch.cancel()
    vi.advanceTimersByTime(CHANGE_WINDOW_MS)
    expect(calls).toHaveLength(1)
    // Still works after.
    batch.push(keeperRead('s1'))
    vi.advanceTimersByTime(CHANGE_WINDOW_MS)
    expect(calls).toHaveLength(2)
    expect(calls[1].r.entries).toBe(false)
  })
})
