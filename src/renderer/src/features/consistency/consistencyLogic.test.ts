import { describe, expect, it } from 'vitest'
import type { Issue } from '@shared/contracts/checks'
import type { Outline } from '@shared/types'
import { chapterList, groupIssues, issueSummary, timesWords } from './consistencyLogic'

const outline = {
  story: { id: 'b1' },
  chapters: [
    { id: 'c1', title: 'The ferry' },
    { id: 'c2', title: '' }
  ],
  scenes: [
    { id: 's1', chapterId: 'c1', title: 'Dawn' },
    { id: 's2', chapterId: 'c1', title: '' },
    { id: 's3', chapterId: 'c2', title: 'The ford' }
  ],
  acts: []
} as unknown as Outline

let n = 0
const issue = (sceneId: string | null, over: Partial<Issue> = {}): Issue => ({
  id: `i${++n}`,
  sceneId,
  storyId: 'b1',
  kind: 'fact',
  severity: 'warning',
  status: 'open',
  quote: '',
  message: `Issue ${n}`,
  sources: [],
  fix: null,
  memoryFix: null,
  createdAt: `2026-10-02T10:00:${String(n).padStart(2, '0')}Z`,
  updatedAt: '',
  ...over
})

describe('the Consistency page’s issues', () => {
  const all = [
    issue('s3', { severity: 'minor' }),
    issue('s3', { severity: 'must-fix' }),
    issue('s1'),
    issue(null, { kind: 'thread' }),
    issue('s2', { status: 'ignored' }),
    issue('s2', { status: 'fixed' }),
    issue('gone-scene')
  ]

  it('groups open issues by chapter and scene in story order, story-wide first, must fix first', () => {
    const g = groupIssues(all, outline, false)
    expect(g.story.map((i) => i.kind)).toEqual(['thread'])
    expect(g.chapters.map((c) => [c.label, c.title, c.scenes.map((s) => `${s.label}:${s.title}`)])).toEqual([
      ['Ch 1', 'The ferry', ['Sc 1:Dawn']],
      ['Ch 2', '', ['Sc 1:The ford']]
    ])
    expect(g.chapters[1].scenes[0].issues.map((i) => i.severity)).toEqual(['must-fix', 'minor'])
    // Open issues of scenes still in the story, and story-wide ones; the deleted scene's is left out.
    expect([g.open, g.mustFix, g.ignored]).toEqual([4, 1, 1])
    expect(issueSummary(g)).toBe('4 open issues, 1 must fix')
  })

  it('shows ignored issues after the open ones when asked', () => {
    const g = groupIssues(all, outline, true)
    expect(g.chapters[0].scenes.map((s) => s.label)).toEqual(['Sc 1', 'Sc 2'])
    expect(g.chapters[0].scenes[1].issues.map((i) => i.status)).toEqual(['ignored'])
    const mixed = groupIssues([issue('s1', { status: 'ignored', severity: 'must-fix' }), issue('s1', { severity: 'minor' })], outline, true)
    expect(mixed.chapters[0].scenes[0].issues.map((i) => i.status)).toEqual(['open', 'ignored'])
  })

  it('says when there is nothing open', () => {
    expect(issueSummary({ open: 0, mustFix: 0 })).toBe('No open issues')
    expect(issueSummary({ open: 1, mustFix: 0 })).toBe('1 open issue')
  })
})

describe('the reports’ words', () => {
  const numbers = new Map(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id, i) => [id, `Ch ${i + 1}`]))
  it('lists chapters in plain words', () => {
    expect(chapterList(['a'], numbers)).toBe('Ch 1')
    expect(chapterList(['a', 'c', 'g'], numbers)).toBe('Ch 1, Ch 3 and Ch 7')
    expect(chapterList(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], numbers)).toBe('Ch 1, Ch 2, Ch 3, Ch 4, Ch 5, Ch 6 and 2 more')
  })
  it('counts uses', () => {
    expect(timesWords(9)).toBe('Used 9 times')
    expect(timesWords(6, 4)).toBe('In 4 chapters, 6 times')
  })
})
