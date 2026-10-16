import { describe, expect, it } from 'vitest'
import type { BoardThread, ThreadsBoard } from '@shared/contracts/worldViews'
import {
  advancedWords,
  canPlan,
  columnsOf,
  dueWords,
  isQuiet,
  ledgerRows,
  openFor,
  paidOffWords,
  payBy,
  quietWords,
  setUpWords,
  statusWords,
  warnWords
} from './boardLogic'
import { droppedToast, noChapterLabel, payByToast } from './planWords'

describe('the ledger (World Memory Overhaul B4)', () => {
  const t = (id: string, column: BoardThread['column'], quietScenes: number | null): BoardThread => ({
    id,
    name: id,
    promise: '',
    column,
    setUp: null,
    paidOff: null,
    openChapters: null,
    longOpen: false,
    quietScenes
  })
  const board: ThreadsBoard = { storyId: 'b1', threads: [t('Bell', 'open', 2), t('Anchor', 'resolved', null), t('Ledger', 'open', 9), t('Crow', 'open', 0)] }

  it('sorts by quiet-for, the quietest first, with threads that are not open after', () => {
    expect(ledgerRows(board, 'quiet').map((x) => x.id)).toEqual(['Ledger', 'Bell', 'Crow', 'Anchor'])
    expect(ledgerRows(board, 'quiet', true).map((x) => x.id)).toEqual(['Crow', 'Bell', 'Ledger', 'Anchor'])
    expect(ledgerRows(board, 'name').map((x) => x.id)).toEqual(['Anchor', 'Bell', 'Crow', 'Ledger'])
  })

  it('says how long in plain words, and marks a quiet open thread', () => {
    expect(quietWords(t('a', 'open', 9))).toBe('9 scenes')
    expect(quietWords(t('a', 'open', 1))).toBe('1 scene')
    expect(quietWords(t('a', 'open', 0))).toBe('Touched in the latest scene')
    expect(quietWords(t('a', 'resolved', null))).toBe('')
    expect(isQuiet(t('a', 'open', 9))).toBe(true)
    expect(isQuiet(t('a', 'open', 2))).toBe(false)
    expect(statusWords(t('a', 'planned', null))).toBe('Planned')
  })
})

const thread = (id: string, column: BoardThread['column'], t: Partial<BoardThread> = {}): BoardThread => ({
  id,
  name: id,
  promise: '',
  column,
  setUp: null,
  paidOff: null,
  openChapters: null,
  longOpen: false,
  ...t
})

describe('the board’s columns', () => {
  it('has Open and Resolved, even when empty, and Planned only when a thread is planned', () => {
    const board = (threads: BoardThread[]): ThreadsBoard => ({ storyId: 'b1', threads })
    expect(columnsOf(board([thread('a', 'open')])).map((c) => [c.column.title, c.threads.length])).toEqual([
      ['Open', 1],
      ['Resolved', 0]
    ])
    expect(columnsOf(board([thread('a', 'open'), thread('b', 'planned'), thread('c', 'resolved')])).map((c) => c.column.title)).toEqual([
      'Open',
      'Resolved',
      'Planned'
    ])
  })
})

describe('the words on a card', () => {
  const scene = { storyId: 'b1', sceneId: 's2' }

  it('says where a thread was set up, with the scene as a link', () => {
    expect(setUpWords({ label: 'Book 1, Ch 3, Sc 2', ...scene, planned: false })).toEqual({
      before: 'Set up in ',
      place: 'Book 1, Ch 3, Sc 2',
      link: scene
    })
    expect(setUpWords({ label: 'Book 1, Ch 3, Sc 2', ...scene, planned: true }).before).toBe('To be set up in ')
    expect(setUpWords({ label: 'the start of Book 2', storyId: 'b2', sceneId: null, planned: false })).toEqual({
      before: 'Set up at ',
      place: 'the start of Book 2',
      link: null
    })
    expect(setUpWords({ label: '', storyId: null, sceneId: null, planned: false }).before).toBe('Set up before the story begins')
    expect(setUpWords(null)).toEqual({ before: 'Not set up in a scene yet', place: '', link: null })
  })

  it('says where it was paid off, or where it is meant to be', () => {
    expect(paidOffWords({ label: 'Book 3, Ch 1, Sc 2', storyId: 'b3', sceneId: 's9', planned: false })).toEqual({
      before: 'Paid off in ',
      place: 'Book 3, Ch 1, Sc 2',
      link: { storyId: 'b3', sceneId: 's9' }
    })
    expect(paidOffWords({ label: 'Book 1, Ch 3, Sc 2', ...scene, planned: true })?.before).toBe('To be paid off in ')
    expect(paidOffWords(null)).toBeNull()
  })

  it('says how long an open thread has been open', () => {
    expect(openFor({ column: 'open', openChapters: 12 })).toBe('Open for 12 chapters')
    expect(openFor({ column: 'open', openChapters: 1 })).toBe('Open for 1 chapter')
    expect(openFor({ column: 'open', openChapters: 0 })).toBeNull()
    expect(openFor({ column: 'resolved', openChapters: null })).toBeNull()
  })
})

describe('the promises ledger on the board (long story memory fix 10)', () => {
  const due = (over: Partial<NonNullable<BoardThread['due']>>): NonNullable<BoardThread['due']> => ({
    chapterId: 'c5',
    label: 'Ch 5',
    from: 'adam',
    state: 'later',
    ...over
  })

  it('says where a thread stands: Open, Advanced, Resolved, Dropped or Planned', () => {
    expect(statusWords({ column: 'open', standing: 'open' })).toBe('Open')
    expect(statusWords({ column: 'open', standing: 'advanced' })).toBe('Advanced')
    expect(statusWords({ column: 'resolved', standing: 'paid' })).toBe('Resolved')
    expect(statusWords({ column: 'dropped', standing: 'dropped' })).toBe('Dropped')
    expect(statusWords({ column: 'planned' })).toBe('Planned')
    // A board from before the ledger.
    expect(statusWords({ column: 'open' })).toBe('Open')
  })

  it('says when it is due, plainly, and which is Adam’s own choice', () => {
    expect(dueWords({ due: due({}) })).toBe('By the end of Ch 5')
    expect(dueWords({ due: due({ state: 'now' }) })).toBe('Due by the end of this chapter')
    expect(dueWords({ due: due({ state: 'overdue', label: 'Ch 4' }) })).toBe('Overdue: due by the end of Ch 4')
    expect(dueWords({ due: due({ from: 'card', sceneLabel: 'Ch 5, Sc 2' }) })).toBe('Planned for Ch 5, Sc 2')
    expect(dueWords({ due: due({ from: 'card', sceneLabel: 'Ch 3, Sc 1', state: 'overdue' }) })).toBe('Overdue: planned for Ch 3, Sc 1')
    expect(dueWords({ due: null })).toBe('')
    expect(payBy({ due: due({}) })).toBe('c5')
    expect(payBy({ due: due({ from: 'card', sceneLabel: 'Ch 5, Sc 2' }) })).toBeNull()
    expect([canPlan({ column: 'open' }), canPlan({ column: 'planned' }), canPlan({ column: 'resolved' }), canPlan({ column: 'dropped' })]).toEqual([true, true, false, false])
  })

  it('says where it last moved on, and what Worth a look says of it', () => {
    expect(advancedWords({ column: 'open', advanced: { label: 'Book 1, Ch 3, Sc 2', storyId: 'b1', sceneId: 's3', planned: false } })).toBe('Book 1, Ch 3, Sc 2')
    expect(advancedWords({ column: 'open', advanced: null })).toBe('Not since it was set up')
    expect(advancedWords({ column: 'resolved', advanced: null })).toBe('')
    expect(warnWords({ warn: 'overdue' })).toBe('Overdue')
    expect(warnWords({ warn: 'quiet' })).toBe('Untouched for a long stretch')
    expect(warnWords({ warn: null })).toBe('')
  })

  it('shows Dropped as its own column only when a thread is dropped', () => {
    const t = (id: string, column: BoardThread['column']): BoardThread => ({ id, name: id, promise: '', column, setUp: null, paidOff: null, openChapters: null, longOpen: false })
    expect(columnsOf({ storyId: 'b1', threads: [t('a', 'open')] }).map((c) => c.column.id)).toEqual(['open', 'resolved'])
    const cols = columnsOf({ storyId: 'b1', threads: [t('a', 'open'), t('b', 'dropped')] })
    expect(cols.map((c) => [c.column.id, c.threads.map((x) => x.id)])).toEqual([
      ['open', ['a']],
      ['resolved', []],
      ['dropped', ['b']]
    ])
    expect(cols[2].column.hint).toBe('You decided not to pay these off')
  })

  it('says what Pay off by and Mark as dropped did', () => {
    expect(payByToast('The drowned bell', 'Ch 5')).toBe('“The drowned bell” is to be paid off by the end of Ch 5.')
    expect(payByToast('The drowned bell', null)).toBe('“The drowned bell” no longer has a chapter to be paid off by.')
    // Back to the cards' plan: it says where they plan it, not that it has no chapter.
    expect(payByToast('The drowned bell', null, 'Ch 5, Sc 2')).toBe('“The drowned bell” will be paid off where the cards plan it: Ch 5, Sc 2.')
    expect(payByToast('The drowned bell', 'Ch 3', 'Ch 5, Sc 2')).toBe('“The drowned bell” is to be paid off by the end of Ch 3.')
    expect(noChapterLabel('Ch 5, Sc 2')).toBe('As the cards plan (Ch 5, Sc 2)')
    expect(noChapterLabel(null)).toBe('No chapter')
    expect(droppedToast('The drowned bell', true)).toBe('Marked “The drowned bell” as dropped. The AI won’t bring it up again.')
    expect(droppedToast(' ', false)).toBe('“This plot thread” is open again. The AI will keep it alive.')
  })
})
