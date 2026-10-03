// When the first-run setup shows, and where it resumes (milestone 6).

import { describe, expect, it } from 'vitest'
import { setupAt, startAt, type SetupFacts } from './state'

const fresh: SetupFacts = { off: false, reachable: true, firstRun: undefined, openWorldId: null, worldIds: [], sampleIds: [], usedBefore: false }
const facts = (patch: Partial<SetupFacts>): SetupFacts => ({ ...fresh, ...patch })

describe('setupAt', () => {
  it('shows on a fresh install, at the first step', () => {
    expect(setupAt(fresh)).toEqual({ step: 'world', worldId: null })
  })

  it('never shows to someone with worlds of their own (Adam)', () => {
    expect(setupAt(facts({ worldIds: ['w1'] })).step).toBeNull()
    expect(setupAt(facts({ worldIds: ['w1'], openWorldId: 'w1' })).step).toBeNull()
  })

  it('never shows to someone who has used AI Write before, even when the library looks empty or holds only the sample', () => {
    expect(setupAt(facts({ usedBefore: true })).step).toBeNull()
    expect(setupAt(facts({ usedBefore: true, worldIds: ['s'], sampleIds: ['s'] })).step).toBeNull()
    expect(startAt(facts({ usedBefore: true, worldIds: ['s'], sampleIds: ['s'], openWorldId: 's' })).step).toBeNull()
  })

  it('still shows when the only world is the sample, unless the sample is open', () => {
    expect(setupAt(facts({ worldIds: ['s'], sampleIds: ['s'] })).step).toBe('world')
    expect(setupAt(facts({ worldIds: ['s'], sampleIds: ['s'], openWorldId: 's' })).step).toBeNull()
  })

  it('resumes a setup under way with its world, open or not', () => {
    const firstRun = { worldId: 'w1', step: 'style' as const, sceneId: null }
    expect(setupAt(facts({ firstRun, worldIds: ['w1'], openWorldId: 'w1' }))).toEqual({ step: 'style', worldId: 'w1' })
    expect(setupAt(facts({ firstRun, worldIds: ['w1'] }))).toEqual({ step: 'style', worldId: 'w1' })
    // Exploring the sample world meanwhile: the setup waits.
    expect(setupAt(facts({ firstRun, worldIds: ['w1', 's'], sampleIds: ['s'], openWorldId: 's' })).step).toBeNull()
  })

  it('is over once the first scene has its guide', () => {
    expect(
      setupAt(facts({ firstRun: { worldId: 'w1', step: 'guide', sceneId: 'x' }, worldIds: ['w1'], openWorldId: 'w1' })).step
    ).toBeNull()
  })

  it('starts afresh when the world it was setting up has gone', () => {
    expect(setupAt(facts({ firstRun: { worldId: 'gone', step: 'model', sceneId: null } }))).toEqual({ step: 'world', worldId: null })
  })

  it('stays out of the way when the library can’t be reached, or in tests that turn it off', () => {
    expect(setupAt(facts({ reachable: false })).step).toBeNull()
    expect(setupAt(facts({ off: true })).step).toBeNull()
    // A setup already under way resumes even then.
    expect(setupAt(facts({ off: true, firstRun: { worldId: 'w1', step: 'connect', sceneId: null }, worldIds: ['w1'] })).step).toBe(
      'connect'
    )
  })
})

describe('startAt ("Start my own world" from the sample)', () => {
  it('resumes a setup under way', () => {
    const f = facts({
      firstRun: { worldId: 'w1', step: 'model', sceneId: null },
      worldIds: ['w1', 's'],
      sampleIds: ['s'],
      openWorldId: 's'
    })
    expect(startAt(f)).toEqual({ step: 'model', worldId: 'w1' })
  })

  it('starts at the first step when only the sample is there', () => {
    expect(startAt(facts({ worldIds: ['s'], sampleIds: ['s'], openWorldId: 's' }))).toEqual({ step: 'world', worldId: null })
  })

  it('leaves it to the New world dialog when Adam has worlds of his own', () => {
    expect(startAt(facts({ worldIds: ['w1', 's'], sampleIds: ['s'], openWorldId: 's' })).step).toBeNull()
  })
})
