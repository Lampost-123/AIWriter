import { describe, expect, it } from 'vitest'
import { activityLine, activityOf, isBusy, progressOf, type ActivityInput } from './activity'

const quiet: ActivityInput = {
  draft: { phase: 'idle', retrying: false, written: null, target: null },
  polish: { running: false, stopping: false },
  change: null,
  beats: false,
  memoryReading: false
}

describe('what the AI dock shows', () => {
  it('is idle with nothing going on', () => {
    expect(activityOf(quiet)).toEqual({ kind: 'idle' })
    expect(isBusy(activityOf(quiet))).toBe(false)
    expect(activityLine(activityOf(quiet))).toBe('')
  })

  it('says why a draft is getting ready: the memory catching up first, or just getting ready', () => {
    const a = activityOf({ ...quiet, draft: { ...quiet.draft, phase: 'starting' }, memoryReading: true })
    expect(a).toEqual({ kind: 'starting', what: 'draft', memory: true })
    expect(activityLine(a)).toBe('Updating memory…')
    expect(isBusy(a)).toBe(true)
    expect(activityLine(activityOf({ ...quiet, draft: { ...quiet.draft, phase: 'starting' } }))).toBe('Getting ready…')
  })

  it('counts an Add below draft’s words, with its progress when the length is known', () => {
    const a = activityOf({ ...quiet, draft: { phase: 'streaming', retrying: false, written: 1234, target: 2000 } })
    expect(a).toMatchObject({ kind: 'writing', what: 'draft', words: 1234, target: 2000, stopping: false })
    expect(activityLine(a)).toBe('Writing… 1,234 words')
    expect(progressOf(a)).toBeCloseTo(0.617)
    // Past its target it never shows full before it ends; with Auto there is no bar to fill (a shimmer instead).
    expect(progressOf(activityOf({ ...quiet, draft: { phase: 'streaming', retrying: false, written: 2500, target: 2000 } }))).toBe(0.97)
    expect(progressOf(activityOf({ ...quiet, draft: { phase: 'streaming', retrying: false, written: 10, target: null } }))).toBeNull()
    expect(activityLine(activityOf({ ...quiet, draft: { phase: 'streaming', retrying: false, written: 1, target: null } }))).toBe('Writing… 1 word')
    expect(activityLine(activityOf({ ...quiet, draft: { phase: 'streaming', retrying: false, written: null, target: null } }))).toBe('Writing…')
  })

  it('says Stopping… and Trying again… as the draft does', () => {
    expect(activityLine(activityOf({ ...quiet, draft: { phase: 'stopping', retrying: false, written: 40, target: null } }))).toBe('Stopping…')
    expect(activityLine(activityOf({ ...quiet, draft: { phase: 'streaming', retrying: true, written: 40, target: null } }))).toBe(
      'The AI service is busy. Trying again…'
    )
  })

  it('counts Continue’s words as its change is written, then waits for Accept or Reject', () => {
    const writing = activityOf({ ...quiet, change: { tool: 'continue', status: 'writing', text: 'Tobin set his cup down at last.' } })
    expect(writing).toMatchObject({ kind: 'writing', what: 'continue', words: 7, target: null })
    expect(activityLine(writing)).toBe('Writing… 7 words')
    expect(progressOf(writing)).toBeNull()
    const ready = activityOf({ ...quiet, change: { tool: 'continue', status: 'ready', text: 'Tobin set his cup down at last.\n\nThen they went.' } })
    expect(ready).toEqual({ kind: 'review', what: 'continue', label: 'Continue', words: 10, accepting: false })
    expect(activityLine(ready)).toBe('Continue · 10 words')
    expect(isBusy(ready)).toBe(false)
    expect(activityOf({ ...quiet, change: { tool: 'continue', status: 'accepting', text: 'x y' } })).toMatchObject({ kind: 'review', accepting: true })
    expect(activityOf({ ...quiet, change: { tool: 'continue', status: 'starting', text: '' } })).toEqual({ kind: 'starting', what: 'continue', memory: false })
  })

  it('names other changes by their label or tool: the polish pass, a rewrite of selected words', () => {
    expect(activityOf({ ...quiet, change: { tool: 'rewrite', status: 'ready', text: 'A b.', label: 'Polish pass' } })).toMatchObject({ label: 'Polish pass' })
    const rewriting = activityOf({ ...quiet, change: { tool: 'condense', status: 'writing', text: '' } })
    expect(activityLine(rewriting)).toBe('Condensing…')
  })

  it('shows the polish pass while it runs, and the draft before it', () => {
    expect(activityOf({ ...quiet, polish: { running: true, stopping: false } })).toEqual({ kind: 'polishing', stopping: false })
    expect(activityLine(activityOf({ ...quiet, polish: { running: true, stopping: true } }))).toBe('Stopping…')
    // A draft still being written comes first.
    expect(activityOf({ ...quiet, draft: { ...quiet.draft, phase: 'streaming' }, polish: { running: true, stopping: false } }).kind).toBe('writing')
  })

  it('gives way to Beat by beat, whatever else is going on', () => {
    expect(activityOf({ ...quiet, beats: true, draft: { ...quiet.draft, phase: 'streaming' } })).toEqual({ kind: 'beats' })
  })

  it('keeps a change waiting in the page ahead of Beat by beat, so Accept and Reject are never under its bar', () => {
    expect(activityOf({ ...quiet, beats: true, change: { tool: 'rewrite', status: 'ready', text: 'A b.' } })).toMatchObject({ kind: 'review' })
  })
})
