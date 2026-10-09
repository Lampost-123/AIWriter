import { describe, expect, it } from 'vitest'
import type { BoardThread, ThreadsBoard } from '@shared/contracts/worldViews'
import { columnsOf, isQuiet, ledgerRows, openFor, paidOffWords, quietWords, setUpWords, statusWords } from './boardLogic'

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
