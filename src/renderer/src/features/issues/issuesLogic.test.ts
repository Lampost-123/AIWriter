import { describe, expect, it } from 'vitest'
import type { Issue } from '@shared/contracts/checks'
import type { ContractCheck } from '@shared/contracts/checks'
import {
  contractNote,
  contractOk,
  disagreesWith,
  fieldWords,
  fixAgainNote,
  fixDirection,
  foundWords,
  ignoredWords,
  SET_ASIDE_WORDS,
  memoryFixWords,
  occurrencesIn,
  openCount,
  pickOccurrence,
  reportHeadline,
  reportWhen,
  runFor,
  sentenceAround,
  splitIssues,
  usableFix
} from './issuesLogic'

describe('the check report’s line', () => {
  it('says what the checks found, and never that all is well (the page may have words underlined)', () => {
    const items = new Array(6).fill(null) as never[]
    expect(reportHeadline({ after: 'draft', items, found: 0 })).toBe('Checked after the latest draft · 6 checks · no issues')
    expect(reportHeadline({ after: 'done', items, found: 2 })).toBe('Checked when marked done · 6 checks · 2 issues')
  })

  it('counts the scene’s issues open now, so the line follows every fix (findings that stay current)', () => {
    const items = new Array(6).fill(null) as never[]
    expect(reportHeadline({ after: 'draft', items, found: 3 }, 3)).toBe('Checked after the latest draft · 6 checks · 3 issues open')
    expect(reportHeadline({ after: 'draft', items, found: 3 }, 1)).toBe('Checked after the latest draft · 6 checks · 1 issue open')
    expect(reportHeadline({ after: 'draft', items, found: 3 }, 0)).toBe('Checked after the latest draft · 6 checks · none left open')
    expect(reportHeadline({ after: 'request', items, found: 0 }, 0)).toBe('Checked · 6 checks · no issues')
    // The memory keeper's clash, found apart from the check, is open too.
    expect(reportHeadline({ after: 'request', items, found: 0 }, 1)).toBe('Checked · 6 checks · 1 issue open')
  })

  it('says when the check ran, and that the scene changed since when it has', () => {
    const now = Date.parse('2026-10-16T12:00:00.000Z')
    expect(reportWhen({ at: '2026-10-16T11:55:00.000Z' }, now)).toBe('5 minutes ago')
    expect(reportWhen({ at: '2026-10-16T11:59:50.000Z', changed: true }, now)).toBe('Just now · The scene changed since this check')
    expect(reportWhen({ at: 'not a time', changed: true }, now)).toBe('The scene changed since this check')
  })

  it('the scene’s contract (fix 13): how many items were kept, what went against it and what isn’t shown yet', () => {
    const contract: ContractCheck = {
      at: '2026-10-16T10:00:00.000Z',
      asks: 'scene',
      items: [
        { part: 'start', text: 'Mara holds the case', result: 'kept' },
        { part: 'change', text: 'Tobin tells her', result: 'not yet' },
        { part: 'change', text: 'They reach the gate', result: 'kept' },
        { part: 'keep', text: 'Ash is dead', result: 'broken', quote: 'Ash said' },
        { part: 'keep', text: 'The door: barred', result: 'untouched' }
      ]
    }
    expect(contractNote(contract)).toBe('2 of 5 kept · 1 goes against it · 1 not shown yet')
    expect(contractOk(contract)).toBe(false)
    expect(contractOk({ items: contract.items.filter((i) => i.result === 'kept' || i.result === 'untouched') })).toBe(true)
    // Checked only against the contract so far (as the draft landed): the line says so.
    expect(reportHeadline({ after: 'draft', items: [], found: 0, contract })).toBe('Checked against the scene contract · 2 of 5 kept · 1 goes against it · 1 not shown yet')
    // With the checks too, their line as before.
    expect(reportHeadline({ after: 'draft', items: [null, null] as never[], found: 1, contract })).toBe('Checked after the latest draft · 2 checks · 1 issue')
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

  it('keeps those saved for later apart: not shown with the open ones, not counted (findings that stay current)', () => {
    const list = [issue({ id: 'a', severity: 'must-fix', later: true }), issue({ id: 'b' }), issue({ id: 'c', status: 'ignored' })]
    expect(openCount(list)).toEqual({ count: 1, mustFix: 0 })
    const split = splitIssues(list)
    expect(split.open.map((i) => i.id)).toEqual(['b'])
    expect(split.later.map((i) => i.id)).toEqual(['a'])
    expect(split.ignored.map((i) => i.id)).toEqual(['c'])
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


describe('Fix the text', () => {
  // Invented: a line that goes against the story's premise and Mara's eyes.
  const premise = issue({
    quote: 'Mara had never left the city.',
    message: 'This says Mara never left the city, but the premise has her raised on a farm.',
    sources: [
      { kind: 'entry', entryId: 'e1', name: 'The premise', field: null },
      { kind: 'entry', entryId: 'e2', name: 'Mara', field: 'eyes' }
    ]
  })

  it('tells the writer the words must change, and what they disagree with', () => {
    const d = fixDirection(premise)
    expect(d).toContain('These words are wrong as they stand and must change: This says Mara never left the city')
    expect(d).toContain('They disagree with The premise and Mara’s eyes.')
    expect(d).toContain('your reply must not be the same words')
    // With nothing named, no "disagree with" sentence.
    expect(fixDirection(issue({ message: 'Wrong tense.' }))).not.toContain('disagree with')
  })

  it('asks again, saying the last answer was identical', () => {
    expect(fixAgainNote(premise)).toBe(
      'Your last answer was identical to the selected words, so nothing was fixed. Change the line so it no longer disagrees with The premise and Mara’s eyes.'
    )
    expect(fixAgainNote(issue())).toContain('so it no longer has this problem.')
  })

  it('names what the words disagree with', () => {
    expect(disagreesWith(issue({ sources: [{ kind: 'story', storyId: 'b2', title: 'The Long Road' }] }))).toBe('The Long Road')
    expect(
      disagreesWith(
        issue({
          sources: [
            { kind: 'scene', sceneId: 's2', label: 'Ch 2, Sc 1' },
            { kind: 'thread', entryId: 't1', name: 'The lost key' },
            { kind: 'thread', entryId: 't1', name: 'The lost key' }
          ]
        })
      )
    ).toBe('Ch 2, Sc 1 and The lost key')
    expect(disagreesWith(issue())).toBe('')
  })

  it('never offers a suggested rewrite that is the quoted words again', () => {
    expect(usableFix(premise)).toBeNull()
    expect(usableFix({ ...premise, fix: 'Mara had never left the city.' })).toBeNull()
    expect(usableFix({ ...premise, fix: '  mara had never  left the city. ' })).toBeNull()
    expect(usableFix({ ...premise, fix: 'Mara had left the farm only once.' })).toBe('Mara had left the farm only once.')
  })
})

describe('an issue the chapter writer set aside (2026-10-16)', () => {
  it('says who set it aside, where an issue Adam ignored says "Ignored"', () => {
    expect(ignoredWords({ setAsideBy: 'chapter' })).toBe(SET_ASIDE_WORDS)
    expect(SET_ASIDE_WORDS).toBe('The chapter writer set this aside')
    expect(ignoredWords({})).toBe('Ignored')
  })
})
