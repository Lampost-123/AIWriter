import { describe, expect, it } from 'vitest'
import type { Issue } from '@shared/contracts/checks'
import { fieldWords, foundWords, memoryFixWords, occurrencesIn, openCount, pickOccurrence, reportHeadline, runFor, sentenceAround, splitIssues } from './issuesLogic'

describe('the check report’s line', () => {
  it('says what the checks found, and never that all is well (the page may have words underlined)', () => {
    const items = new Array(6).fill(null) as never[]
    expect(reportHeadline({ after: 'draft', items, found: 0 })).toBe('Checked after the latest draft · 6 checks · no issues')
    expect(reportHeadline({ after: 'done', items, found: 2 })).toBe('Checked when marked done · 6 checks · 2 issues')
  })
})

const issue = (over: Partial<Issue> = {}): Issue => ({
  id: 'i',
  sceneId: 's1',
  storyId: 'b1',
  kind: 'fact',
  severity: 'warning',
  status: 'open',
  quote: 'q',
  message: 'm',
  sources: [],
  fix: null,
  memoryFix: null,
  createdAt: '',
  updatedAt: '',
  ...over
})

describe('the Issues tab’s words', () => {
  it('says what marking done found, here or in the scene named', () => {
    expect(foundWords(1, null)).toBe('Found 1 thing to look at in this scene.')
    expect(foundWords(2, 'Book 1, Ch 1, Sc 2')).toBe('Found 2 things to look at in Book 1, Ch 1, Sc 2.')
  })

  it('counts open issues and must-fix ones, and keeps ignored ones apart', () => {
    const list = [issue({ id: 'a', severity: 'must-fix' }), issue({ id: 'b' }), issue({ id: 'c', status: 'ignored' }), issue({ id: 'd', status: 'fixed' })]
    expect(openCount(list)).toEqual({ count: 2, mustFix: 1 })
    expect(openCount(null)).toEqual({ count: 0, mustFix: 0 })
    expect(splitIssues(list).ignored.map((i) => i.id)).toEqual(['c'])
  })

  it('names what Update the memory sets', () => {
    expect(fieldWords('eyes')).toBe('eyes')
    expect(fieldWords('marks')).toBe('distinguishing marks')
    const i = issue({
      memoryFix: { entryId: 'm', field: 'eyes', value: 'green' },
      sources: [{ kind: 'entry', entryId: 'm', name: 'Mara', field: 'eyes' }]
    })
    expect(memoryFixWords(i)).toBe('Set Mara’s eyes to “green” in the memory')
    expect(memoryFixWords(issue())).toBeNull()
  })

  it('finds the run covering a scene, Adam’s own before a background one', () => {
    const p = (runId: string, sceneIds: string[], background = false) => ({
      runId,
      target: { scope: 'story' as const, id: 'b1' },
      done: 0,
      total: sceneIds.length,
      current: null,
      sceneIds,
      background
    })
    expect(runFor({ a: p('a', ['s1'], true), b: p('b', ['s1', 's2']) }, 's1')?.runId).toBe('b')
    expect(runFor({ a: p('a', ['s1'], true) }, 's1')?.runId).toBe('a')
    expect(runFor({ a: p('a', ['s2']) }, 's1')).toBeNull()
  })

  it('widens words to the sentence they are in for Rewrite', () => {
    const t = 'She ran. Mara’s eyes were green, and she smiled. Then it rained.'
    const at = t.indexOf('eyes were green')
    expect(t.slice(...Object.values(sentenceAround(t, at, at + 'eyes were green'.length)))).toBe('Mara’s eyes were green, and she smiled.')
    const whole = t.indexOf('Mara')
    const end = t.indexOf('smiled.') + 'smiled.'.length
    expect(sentenceAround(t, whole, end)).toEqual({ from: whole, to: end })
    expect(sentenceAround('no ending here', 3, 6)).toEqual({ from: 0, to: 14 })
  })

  it('finds every place the words are in a paragraph, and picks the one the check meant', () => {
    const t = 'Mara’s eyes were green. Later, MARA’S  eyes were green again.'
    const found = occurrencesIn(t, "Mara's eyes were green")
    expect(found.map((r) => t.slice(r.from, r.to))).toEqual(['Mara’s eyes were green', 'MARA’S  eyes were green'])
    expect(pickOccurrence(found, 1)).toBe(found[1])
    // Several, and the check didn't say which: none, so Fix the text asks Rewrite instead of guessing.
    expect(pickOccurrence(found, undefined)).toBeNull()
    expect(pickOccurrence(found.slice(0, 1), undefined)).toBe(found[0])
    expect(pickOccurrence([], 0)).toBeNull()
    expect(occurrencesIn(t, '')).toEqual([])
  })
})

