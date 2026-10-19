// One Issues list in clear sections (the calm overhaul): which section each finding goes in, the counts the filters
// show, and the line that says what there is to look at.
import { describe, expect, it } from 'vitest'
import type { Issue } from '@shared/contracts/checks'
import { bySection, sectionCounts, sectionOf, sectionSummary, useIssuesView } from './sections'

const issue = (over: Partial<Issue>): Pick<Issue, 'kind' | 'quote' | 'byContract' | 'memoryFix'> => ({
  kind: 'fact',
  quote: 'Her eyes were blue.',
  memoryFix: null,
  ...over
})

describe('the Issues list’s sections', () => {
  it('puts words that disagree with the record under Slips', () => {
    expect(sectionOf(issue({}))).toBe('slips')
    expect(sectionOf(issue({ kind: 'knowledge' }))).toBe('slips')
    expect(sectionOf(issue({ kind: 'timeline' }))).toBe('slips')
    expect(sectionOf(issue({ kind: 'continuity' }))).toBe('slips')
    expect(sectionOf(issue({ kind: 'spelling' }))).toBe('slips')
  })

  it('puts what only Adam can decide under Questions', () => {
    expect(sectionOf(issue({ byContract: true }))).toBe('questions')
    expect(sectionOf(issue({ quote: '  ' }))).toBe('questions')
    expect(sectionOf(issue({ memoryFix: { entryId: 'e1', field: 'eyes', value: 'blue' } }))).toBe('questions')
    expect(sectionOf(issue({ kind: 'voice' }))).toBe('questions')
    expect(sectionOf(issue({ kind: 'style' }))).toBe('questions')
    expect(sectionOf(issue({ kind: 'story' }))).toBe('questions')
    // Check and repair asks about a draft's words as it lands.
    expect(sectionOf({ ...issue({ kind: 'continuity' }), message: 'Mara took her hood off earlier. Use the fix, or keep it as it is?' })).toBe('questions')
    expect(sectionOf({ ...issue({ kind: 'continuity' }), message: 'Mara took her hood off earlier.' })).toBe('slips')
  })

  it('puts plot threads under Plot threads, whatever else they are', () => {
    expect(sectionOf(issue({ kind: 'thread', quote: '' }))).toBe('threads')
    expect(sectionOf(issue({ kind: 'thread', byContract: true }))).toBe('threads')
  })

  it('keeps each section in the order given (must fix first, as sorted)', () => {
    const a = { ...issue({}), id: 'a' }
    const b = { ...issue({ kind: 'voice' }), id: 'b' }
    const c = { ...issue({}), id: 'c' }
    const d = { ...issue({ kind: 'thread' }), id: 'd' }
    const s = bySection([a, b, c, d])
    expect(s.slips.map((i) => i.id)).toEqual(['a', 'c'])
    expect(s.questions.map((i) => i.id)).toEqual(['b'])
    expect(s.threads.map((i) => i.id)).toEqual(['d'])
  })

  it('counts each section, craft notes and the memory’s notes included, and in all', () => {
    const counts = sectionCounts({ issues: [issue({}), issue({}), issue({ kind: 'voice' })], craft: 3, memory: 1, threads: 2 })
    expect(counts).toEqual({ slips: 2, questions: 1, craft: 3, threads: 2, memory: 1, all: 9 })
  })

  it('says what there is to look at, the sections with any, in order', () => {
    expect(sectionSummary({ slips: 2, questions: 1, craft: 0, threads: 0, memory: 1 })).toBe('2 slips · 1 question · 1 memory note')
    expect(sectionSummary({ slips: 0, questions: 0, craft: 1, threads: 3, memory: 0 })).toBe('1 craft note · 3 plot threads')
    expect(sectionSummary({ slips: 0, questions: 0, craft: 0, threads: 0, memory: 0 })).toBe('')
  })

  it('keeps the filter Adam chose', () => {
    expect(useIssuesView.getState().section).toBe('all')
    useIssuesView.getState().show('craft')
    expect(useIssuesView.getState().section).toBe('craft')
    useIssuesView.getState().show('all')
  })
})
