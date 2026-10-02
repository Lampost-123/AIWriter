import { describe, expect, it } from 'vitest'
import type { MemoryLogItem, MemoryStatus } from '@shared/types'
import {
  beforeAfter,
  canUndo,
  changesNote,
  freshUpdate,
  groupHeading,
  groupLog,
  keeperState,
  markAnswered,
  markUndone,
  pointsToSettings,
  readingNote,
  wordsGone
} from './logic'

const status = (s: Partial<MemoryStatus>): MemoryStatus => ({ behind: 0, failed: 0, reading: null, error: null, lastUpdate: null, ...s })

let n = 0
const item = (runId: string, sceneId: string | null, where: string, extra: Partial<MemoryLogItem> = {}): MemoryLogItem => ({
  id: `m${++n}`,
  runId,
  sceneId,
  entryName: 'Mara',
  text: 'Lost her left hand',
  before: '',
  after: '',
  action: 'added',
  what: 'change',
  entryId: 'e1',
  factId: null,
  quote: '',
  where,
  question: null,
  createdAt: '2026-10-02T10:00:00Z',
  undone: false,
  ...extra
})

describe('keeperState', () => {
  it('is idle when nothing is known or nothing is happening', () => {
    expect(keeperState(null)).toBe('idle')
    expect(keeperState(status({}))).toBe('idle')
    // Scenes waiting their turn (Adam is still writing) and single failed scenes don't make the bar busy.
    expect(keeperState(status({ behind: 3, failed: 1 }))).toBe('idle')
  })

  it('shows reading over an older error, and the error otherwise', () => {
    expect(keeperState(status({ reading: { sceneId: 's1', title: 'The ferry' } }))).toBe('reading')
    expect(keeperState(status({ reading: { sceneId: 's1', title: 'The ferry' }, error: 'No memory model' }))).toBe('reading')
    expect(keeperState(status({ error: 'Choose a memory model in Settings › Models.' }))).toBe('error')
  })
})

describe('readingNote', () => {
  it('names the scene and how many are waiting', () => {
    expect(readingNote(status({ reading: { sceneId: 's1', title: 'The ferry' }, behind: 1 }))).toBe(
      'Reading “The ferry”. Click to see what the memory has changed.'
    )
    expect(readingNote(status({ reading: { sceneId: 's1', title: '' }, behind: 2 }))).toMatch(
      /^Reading “Untitled scene”, then 1 more scene\./
    )
    expect(readingNote(status({ reading: { sceneId: 's1', title: 'A' }, behind: 4 }))).toMatch(/then 3 more scenes\./)
  })
})

describe('freshUpdate', () => {
  const opened = Date.parse('2026-10-02T10:00:00Z')
  const update = (at: string, runId = 'r1', changes = 2): MemoryStatus => status({ lastUpdate: { at, runId, changes } })

  it('shows a run that changed something since the world opened', () => {
    expect(freshUpdate(update('2026-10-02T10:05:00Z'), null, opened)).toEqual({ runId: 'r1', changes: 2 })
  })

  it('never shows an update from before, one already seen, or one that changed nothing', () => {
    expect(freshUpdate(update('2026-10-02T09:59:00Z'), null, opened)).toBeNull()
    expect(freshUpdate(update('2026-10-02T10:05:00Z'), 'r1', opened)).toBeNull()
    expect(freshUpdate(update('2026-10-02T10:05:00Z', 'r2', 0), null, opened)).toBeNull()
    expect(freshUpdate(status({}), null, opened)).toBeNull()
    expect(freshUpdate(null, null, opened)).toBeNull()
  })

  it('counts changes in plain words', () => {
    expect(changesNote(1)).toBe('1 change to the memory')
    expect(changesNote(1200)).toBe('1,200 changes to the memory')
  })
})

describe('pointsToSettings', () => {
  it('spots a next step in Settings', () => {
    expect(pointsToSettings('Choose a memory model in Settings › Models.')).toBe(true)
    expect(pointsToSettings('Your OpenRouter credit has run out. Top up and try again.')).toBe(false)
  })
})

describe('groupLog', () => {
  it('groups lines by run, keeping the order', () => {
    const a1 = item('r3', 'a', 'Book 1, Ch 1, Sc 2')
    const a2 = item('r3', 'a', 'Book 1, Ch 1, Sc 2')
    const b1 = item('r2', 'b', 'Book 1, Ch 1, Sc 1')
    const a3 = item('r1', 'a', 'Book 1, Ch 1, Sc 2')
    const groups = groupLog([a1, a2, b1, a3])
    expect(groups.map((g) => [g.runId, g.sceneId, g.items.map((i) => i.id)])).toEqual([
      ['r3', 'a', [a1.id, a2.id]],
      ['r2', 'b', [b1.id]],
      ['r1', 'a', [a3.id]]
    ])
    expect(groups[0].at).toBe(a1.createdAt)
    expect(new Set(groups.map((g) => g.key)).size).toBe(3)
  })

  it('gives every group a heading', () => {
    expect(groupHeading(groupLog([item('r', 'a', ' Book 2, Ch 1, Sc 1 ')])[0])).toBe('Book 2, Ch 1, Sc 1')
    expect(groupHeading(groupLog([item('r', 'a', '')])[0])).toBe('A scene')
    expect(groupHeading(groupLog([item('r', null, '')])[0])).toBe('Across the story')
  })

  it('is empty for an empty list', () => {
    expect(groupLog([])).toEqual([])
  })
})

describe('beforeAfter', () => {
  it('shows what it was and what it is now', () => {
    expect(beforeAfter(item('r', 'a', '', { before: 'Blue eyes', after: 'Grey eyes' }))).toEqual({
      before: 'Blue eyes',
      after: 'Grey eyes'
    })
    expect(beforeAfter(item('r', 'a', '', { after: 'Owns the ferry' }))).toEqual({ before: null, after: 'Owns the ferry' })
    expect(beforeAfter(item('r', 'a', '', { before: 'Owns the ferry ' }))).toEqual({ before: 'Owns the ferry', after: null })
  })

  it('shows nothing when there is nothing to compare', () => {
    expect(beforeAfter(item('r', 'a', ''))).toEqual({ before: null, after: null })
    expect(beforeAfter(item('r', 'a', '', { before: 'Same', after: 'Same' }))).toEqual({ before: null, after: null })
  })
})

describe('wordsGone', () => {
  it('lines about words that were deleted or changed have nothing left in the scene to show', () => {
    expect(wordsGone(item('r1', 's1', 'Sc 1', { action: 'removed', text: 'Lost her right hand: those words were deleted' }))).toBe(true)
    expect(wordsGone(item('r1', 's1', 'Sc 1', { action: 'removed', text: 'Eyes: the scene no longer says this' }))).toBe(true)
    expect(wordsGone(item('r1', 's1', 'Sc 1', { action: 'removed', what: 'entry', entryName: 'Kell', text: 'Moved to Trash: no scene mentions it any more' }))).toBe(true)
    expect(wordsGone(item('r1', 's1', 'Sc 1', { action: 'updated', text: "Eyes: your words are kept, but the scene's words for it were deleted" }))).toBe(true)
  })

  it('lines whose words are in the scene still point to them', () => {
    expect(wordsGone(item('r1', 's1', 'Sc 1', { action: 'added' }))).toBe(false)
    expect(wordsGone(item('r1', 's1', 'Sc 1', { action: 'updated', text: 'Eyes', before: 'grey', after: 'green' }))).toBe(false)
    expect(wordsGone(item('r1', 's1', 'Sc 1', { action: 'updated', text: 'Lost her left hand: your words are kept, but the scene now says otherwise' }))).toBe(false)
  })
})

describe('markUndone, markAnswered, canUndo', () => {
  it('greys one line and leaves the rest alone, and can put it back', () => {
    const list = [item('r', 'a', 'x'), item('r', 'a', 'x')]
    const next = markUndone(list, list[1].id)
    expect(next[0]).toBe(list[0])
    expect(next[1].undone).toBe(true)
    expect(list[1].undone).toBe(false)
    expect(markUndone(next, list[1].id, false)[1].undone).toBe(false)
  })

  it('records an answer only on a question-marked line', () => {
    const q = {
      text: 'Kell comes from Kell’s Road.',
      options: [
        { id: 'link', label: 'Same Kell' },
        { id: 'new', label: 'Make a new entry' }
      ],
      answer: 'link'
    }
    const list = [item('r', 'a', 'x', { question: q }), item('r', 'a', 'x')]
    const next = markAnswered(list, list[0].id, 'new')
    expect(next[0].question?.answer).toBe('new')
    expect(q.answer).toBe('link')
    expect(markAnswered(list, list[1].id, 'new')[1]).toBe(list[1])
  })

  it('offers Undo on every line except failures and lines already undone', () => {
    expect(canUndo(item('r', 'a', 'x'))).toBe(true)
    expect(canUndo(item('r', 'a', 'x', { action: 'removed' }))).toBe(true)
    expect(canUndo(item('r', 'a', 'x', { action: 'failed' }))).toBe(false)
    expect(canUndo(item('r', 'a', 'x', { undone: true }))).toBe(false)
  })
})
