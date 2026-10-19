// Write in what a draft missed (autoWriteIn.ts): only with the setting on, only for a draft this window started, only what
// didn't land and can be written in (never a length ask), and at most once a draft, however often its receipt is read.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Receipt } from './receipt'

type Active = { activeGeneration: { id: string; sceneId: string } | null }
const appState: Active = { activeGeneration: null }
const listeners: ((now: Active, before: Active) => void)[] = []
vi.mock('@/lib/store', () => ({
  useApp: {
    getState: () => appState,
    subscribe: (fn: (typeof listeners)[number]) => void listeners.push(fn)
  }
}))

const { autoWriteInFor, claimAutoWriteIn, markWrittenIn, resetAutoWriteIn, wasClaimed, wasStartedHere, watchDraftsStarted, writtenInFor } = await import('./autoWriteIn')

const receipt = (asks: Receipt['asks'], recordId = 'd1'): Receipt => ({ recordId, at: new Date().toISOString(), asks })
const MISSED: Receipt['asks'] = [
  { text: 'Mara counts the doors', kind: 'event', landed: true },
  { text: 'More dialogue', kind: 'reads', landed: false },
  { text: 'Keep it under 800 words', kind: 'length', landed: false }
]

beforeEach(() => resetAutoWriteIn())

describe('write in what a draft missed', () => {
  it('asks Continue for what didn’t land, never a length ask, only with the setting on and for a draft started here', () => {
    const r = receipt(MISSED)
    expect(autoWriteInFor(r, { on: true, startedHere: true, claimed: false })).toBe('More dialogue.')
    expect(autoWriteInFor(r, { on: false, startedHere: true, claimed: false })).toBeNull()
    expect(autoWriteInFor(r, { on: true, startedHere: false, claimed: false })).toBeNull()
    expect(autoWriteInFor(receipt([{ text: 'Keep it short', kind: 'length', landed: false }]), { on: true, startedHere: true, claimed: false })).toBeNull()
    expect(autoWriteInFor(receipt([{ text: 'Mara counts the doors', kind: 'event', landed: true }]), { on: true, startedHere: true, claimed: false })).toBeNull()
  })

  it('writes in once a draft only, however often the receipt is read', () => {
    const r = receipt(MISSED)
    const tries = (): string | null => {
      const direction = autoWriteInFor(r, { on: true, startedHere: true, claimed: wasClaimed(r.recordId) })
      return direction && claimAutoWriteIn(r.recordId) ? direction : null
    }
    expect(tries()).toBe('More dialogue.')
    expect(tries()).toBeNull()
    expect(tries()).toBeNull()
    expect(claimAutoWriteIn(r.recordId)).toBe(false)
    // Another draft has its own once.
    expect(claimAutoWriteIn('d2')).toBe(true)
  })

  it('keeps what was written in, for the receipt to say', () => {
    const r = receipt(MISSED)
    expect(writtenInFor(r.recordId)).toBeNull()
    markWrittenIn(r)
    expect(writtenInFor(r.recordId)).toEqual(['More dialogue'])
  })

  it('knows the drafts this window started, from the app’s active draft', () => {
    appState.activeGeneration = { id: 'before', sceneId: 's1' }
    watchDraftsStarted()
    watchDraftsStarted()
    expect(listeners).toHaveLength(1)
    expect(wasStartedHere('before')).toBe(true)
    const was = { ...appState }
    appState.activeGeneration = { id: 'd9', sceneId: 's1' }
    listeners[0](appState, was)
    expect(wasStartedHere('d9')).toBe(true)
    expect(wasStartedHere('from-another-session')).toBe(false)
  })
})
