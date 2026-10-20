// Plain waits (the calm overhaul, 2026-10-19): the steps a draft takes before its first word are said as they begin, so
// the window can name each ("Looking up 3 things…", then planning again). No model is called.
import { describe, expect, it, vi } from 'vitest'
import type { DraftStep } from '@shared/contracts/calm'
import { testWorld } from '../../../tests/unit/keeperRead'
import { answerLookups, LOOKUPS_MOST, type LookupContext } from './lookups'
import { draftStep, onDraftStep } from './steps'

describe('a draft’s steps', () => {
  it('are told to every listener, and a listener that fails stops no other', () => {
    const heard: DraftStep[] = []
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const offBad = onDraftStep(() => {
      throw new Error('broken')
    })
    const off = onDraftStep((s) => heard.push(s))
    draftStep('s1', 'memory')
    draftStep('s1', 'lookups', 3)
    draftStep('', 'plan')
    off()
    offBad()
    draftStep('s1', 'writing')
    expect(warn).toHaveBeenCalledTimes(2)
    warn.mockRestore()
    expect(heard).toEqual([
      { sceneId: 's1', step: 'memory' },
      { sceneId: 's1', step: 'lookups', count: 3 }
    ])
  })

  it('say how many things are looked up, at most the most there can be, then planning again', async () => {
    const w = testWorld(0)
    const ctx: LookupContext = { db: w.db, sceneId: w.scenes[0], storyId: w.storyId, asItBegins: true, entries: [], people: [], hidden: new Set() }
    const heard: DraftStep[] = []
    const off = onDraftStep((s) => heard.push(s))
    const calls = Array.from({ length: LOOKUPS_MOST + 2 }, (_, i) => ({ id: `c${i}`, name: 'no_such_lookup', arguments: '{}' }))
    const out = await answerLookups(calls, ctx)
    off()
    expect(out.answers).toHaveLength(calls.length)
    expect(heard).toEqual([
      { sceneId: w.scenes[0], step: 'lookups', count: LOOKUPS_MOST },
      { sceneId: w.scenes[0], step: 'plan' }
    ])
  })
})
