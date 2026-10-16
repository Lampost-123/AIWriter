// Fix the text's rewrite is marked fixed only once its new words pass the check a draft gets (checkedFix.ts).
import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => ({
  check: vi.fn(),
  patch: vi.fn(),
  load: vi.fn(async () => undefined),
  flush: vi.fn(async () => undefined)
}))

vi.mock('./repairRun', () => ({ checkLanded: calls.check }))
vi.mock('@/features/issues/issuesStore', () => ({ patchIssue: calls.patch, loadIssues: calls.load }))
vi.mock('@/lib/flush', () => ({ flushAll: calls.flush }))

import { fixedOnceChecked } from './checkedFix'

const issue = { id: 'i1', sceneId: 's1' }
const words = { from: 10, to: 40 }
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

describe('Fix the text’s rewrite, accepted', () => {
  beforeEach(() => {
    for (const f of Object.values(calls)) f.mockClear()
  })

  it('checks the new words and marks the issue fixed when the check asks nothing', async () => {
    calls.check.mockResolvedValueOnce({ checked: true, mended: 1, asked: 0 })
    const fixed = vi.fn()
    fixedOnceChecked(issue, fixed)(words, 'rec1')
    expect(calls.patch).toHaveBeenCalledWith('s1', 'i1', { status: 'gone' })
    await settle()
    expect(calls.check).toHaveBeenCalledWith({ sceneId: 's1', recordId: 'rec1', from: 10, to: 40 })
    expect(fixed).toHaveBeenCalledTimes(1)
    expect(calls.load).not.toHaveBeenCalled()
  })

  it('isn’t marked fixed when the check asks something, or nothing was checked: the list is read again instead', async () => {
    for (const outcome of [{ checked: true, mended: 0, asked: 1 }, { checked: false }]) {
      calls.check.mockResolvedValueOnce(outcome)
      const fixed = vi.fn()
      fixedOnceChecked(issue, fixed)(words, 'rec1')
      await settle()
      expect(fixed).not.toHaveBeenCalled()
      expect(calls.flush).toHaveBeenCalled()
      expect(calls.load).toHaveBeenCalledWith('s1')
      calls.load.mockClear()
    }
  })

  it('with no record of the AI’s words, nothing is checked and it isn’t marked fixed', async () => {
    const fixed = vi.fn()
    fixedOnceChecked(issue, fixed)(words, null)
    await settle()
    expect(calls.check).not.toHaveBeenCalled()
    expect(fixed).not.toHaveBeenCalled()
    expect(calls.load).toHaveBeenCalledWith('s1')
  })
})
