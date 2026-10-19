// Every check run in one place (the calm overhaul): what the window knows of each, whose scenes it covers, what went
// wrong, and what it is doing in plain words, waiting included.
import { describe, expect, it } from 'vitest'
import type { CheckDone, CheckProgress } from '@shared/contracts/checks'
import { ended, isBackgroundRun, memoryWords, progressed, runFor, runLine, waitingBehind, type RunsState } from './runsLogic'

const p = (runId: string, sceneIds: string[], more: Partial<CheckProgress> = {}): CheckProgress => ({
  runId,
  target: { scope: sceneIds.length > 1 ? 'chapter' : 'scene', id: sceneIds.length > 1 ? 'ch1' : sceneIds[0] },
  done: 0,
  total: sceneIds.length,
  current: 'Ch 1, Sc 1: The ferry',
  sceneIds,
  currentSceneId: sceneIds[0],
  ...more
})
const empty: RunsState = { runs: {}, failed: {} }
const done = (runId: string, status: CheckDone['status'], error: string | null = null): CheckDone => ({
  runId,
  target: { scope: 'scene', id: 's1' },
  status,
  error,
  found: 0
})

describe('check runs in one place', () => {
  it('tells Adam’s runs from the automatic ones by their ids', () => {
    expect(isBackgroundRun('done:s1:x')).toBe(true)
    expect(isBackgroundRun('draft:s1:x')).toBe(true)
    expect(isBackgroundRun('3f2c-uuid')).toBe(false)
  })

  it('keeps where a run started, and clears its scenes’ failures when one of Adam’s starts', () => {
    let s: RunsState = { runs: {}, failed: { s1: 'The model refused.' } }
    s = progressed(s, p('a', ['s1']))
    expect(s.failed).toEqual({})
    s = progressed(s, p('a', ['s1'], { current: 'Ch 1, Sc 2', done: 1 }))
    expect(s.runs.a.where).toBe('Ch 1, Sc 1: The ferry')
    expect(s.runs.a.background).toBe(false)
    // An automatic one starting doesn't clear what went wrong with Adam's.
    const t = progressed({ runs: {}, failed: { s1: 'No.' } }, p('done:s1:x', ['s1']))
    expect(t.failed).toEqual({ s1: 'No.' })
  })

  it('says a run that went wrong in its scenes, and forgets it once one works', () => {
    const s = progressed(empty, p('a', ['s1']))
    const bad = ended(s, done('a', 'error', 'The consistency check model turned the scene down.'))
    expect(bad.state.runs).toEqual({})
    expect(bad.state.failed).toEqual({ s1: 'The consistency check model turned the scene down.' })
    expect(bad.scenes).toEqual(['s1'])
    const good = ended(progressed(bad.state, p('b', ['s1'])), done('b', 'complete'))
    expect(good.state.failed).toEqual({})
  })

  it('finds the run covering a scene, Adam’s own before a background one', () => {
    let s = progressed(empty, p('done:s1:x', ['s1']))
    s = progressed(s, p('b', ['s1', 's2']))
    expect(runFor(s.runs, 's1')?.runId).toBe('b')
    expect(runFor(s.runs, 's2')?.runId).toBe('b')
    expect(runFor(s.runs, 's3')).toBeNull()
  })

  it('knows a run waiting its turn behind another', () => {
    let s = progressed(empty, p('draft:s1:x', ['s1']))
    s = progressed(s, p('mine', ['s2']))
    expect(waitingBehind(s.runs, 'mine')?.runId).toBe('draft:s1:x')
    expect(waitingBehind(s.runs, 'draft:s1:x')).toBeNull()
    expect(runLine(s.runs.mine, { runs: s.runs })).toBe('Waiting for the check of Ch 1, Sc 1 to finish…')
  })

  it('says what a run is doing, the memory’s catching up included', () => {
    const one = progressed(empty, p('a', ['s1'])).runs.a
    expect(runLine(one)).toBe('Checking Ch 1, Sc 1: The ferry')
    const many = progressed(empty, p('a', ['s1', 's2', 's3'], { done: 1, current: 'Ch 1, Sc 2: Rain' })).runs.a
    expect(runLine(many)).toBe('Checking Ch 1, Sc 2: Rain · 2 of 3')
    expect(runLine(many, { short: true })).toBe('Checking Ch 1, Sc 2 · 2 of 3')
    const waiting = { ...one, waiting: 'memory' as const }
    expect(runLine(waiting)).toBe('Waiting for the memory to catch up…')
    expect(runLine(waiting, { memory: { catchingUp: [{ sceneId: 's1', done: 1, total: 4, stage: 'earlier' }] } })).toBe(
      'Waiting for the memory to catch up: scene 2 of 4'
    )
    expect(runLine(waiting, { memory: { catchingUp: [{ sceneId: 's1', done: 0, total: 1, stage: 'scene' }] } })).toBe(
      'Waiting for the memory to catch up: this scene’s latest words…'
    )
  })

  it('counts the memory’s scenes from one and never past the last', () => {
    expect(memoryWords({ done: 0, total: 5, stage: 'earlier' })).toBe('Catching up the memory: scene 1 of 5')
    expect(memoryWords({ done: 5, total: 5, stage: 'earlier' })).toBe('Catching up the memory: scene 5 of 5')
    expect(memoryWords({ done: 0, total: 1, stage: 'earlier' })).toBe('Catching up the memory: the scene before…')
    expect(memoryWords(null)).toBe('Catching up the memory…')
  })
})
