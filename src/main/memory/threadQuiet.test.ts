// The open threads ledger (World Memory Overhaul B4, 2026-10-08): where each plot thread was last touched on a story's
// line and how many scenes it has been quiet since; the ledger's rows on the plot threads board; and the writer's
// gentle reminder, only for threads overdue in this part of the story. All text is invented.

import { describe, expect, it } from 'vitest'
import { defaultWritingPrefs } from '@shared/defaults'
import type { EntryState, ID, ThreadState } from '@shared/types'
import { QUIET_SCENES } from '@shared/contracts/worldViews'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import * as hist from '../db/history'
import { testWorld } from '../../../tests/unit/keeperRead'
import { threadsBoardOf } from '../worldViews'
import { gatherContextInput } from '../ai/gather'
import { assembleContext } from '../ai/context'
import { openThreadsAt, openThreadsText, quietReminder, REMINDER_MOST } from '../ai/openThreads'
import { sceneMemory } from './scene'

/** A world with one chapter of `n` scenes and two open plot threads: the bell opened in scene 1, the ledger in scene 2. */
function world(n = 10) {
  const w = testWorld(n - 1)
  const { db, scenes } = w
  const bell = repo.createEntry(db, 'thread', { name: 'The drowned bell', fields: { promise: 'Who rang it at night?' } })
  const ledger = repo.createEntry(db, 'thread', { name: 'The missing ledger', fields: { promise: 'Who took the harbour ledger?' } })
  const open = (entryId: ID, i: number, note = '') =>
    mem.insertChange(db, { kind: 'thread', payload: { status: 'open', note }, entryId, anchor: 'scene', sceneId: scenes[i], origin: 'text' })
  open(bell.id, 0)
  open(ledger.id, 1)
  return { ...w, bell, ledger, open }
}

describe('where a thread was last touched', () => {
  it('counts the scenes since its last thread change or the last words its facts rest on', () => {
    const w = world(10)
    const at = (i: number) => sceneMemory(w.db, w.scenes[i]).threads
    // Writing scene 10: the bell was opened in scene 1, so eight scenes since (2 to 9).
    const bell = at(9).find((t) => t.entryId === w.bell.id)!
    expect(bell.quiet).toBe(8)
    expect(bell.lastStoryId).toBe(w.storyId)
    expect(bell.lastWhere).toMatch(/Sc 1$/)
    // A clue's words in scene 6 touch it.
    hist.addLink(w.db, {
      factKind: 'field',
      factId: w.bell.id,
      field: 'clues',
      sceneId: w.scenes[5],
      sceneVersion: 1,
      paragraphId: 'p1',
      start: 0,
      end: 5,
      quote: 'A bell',
      state: 'ok'
    })
    expect(at(9).find((t) => t.entryId === w.bell.id)!.quiet).toBe(3)
    // And a step on in scene 9.
    w.open(w.bell.id, 8, 'the bell rang again')
    expect(at(9).find((t) => t.entryId === w.bell.id)!.quiet).toBe(0)
  })
})

describe('the ledger', () => {
  it('gives each thread the scene that last touched it and, while open, how long it has been quiet', () => {
    const w = world(10)
    w.open(w.ledger.id, 6, 'a page of it turned up')
    const board = threadsBoardOf(w.db, w.storyId)
    const bell = board.threads.find((t) => t.id === w.bell.id)!
    const ledger = board.threads.find((t) => t.id === w.ledger.id)!
    expect(bell.lastTouched).toMatchObject({ sceneId: w.scenes[0], storyId: w.storyId, planned: false })
    expect(bell.quietScenes).toBe(9)
    expect(ledger.lastTouched?.sceneId).toBe(w.scenes[6])
    expect(ledger.quietScenes).toBe(3)
  })

  it('has no quiet count for a resolved thread', () => {
    const w = world(4)
    mem.insertChange(w.db, {
      kind: 'thread',
      payload: { status: 'resolved', note: '' },
      entryId: w.bell.id,
      anchor: 'scene',
      sceneId: w.scenes[2],
      origin: 'text'
    })
    const bell = threadsBoardOf(w.db, w.storyId).threads.find((t) => t.id === w.bell.id)!
    expect(bell.column).toBe('resolved')
    expect(bell.lastTouched?.sceneId).toBe(w.scenes[2])
    expect(bell.quietScenes).toBeNull()
  })
})

describe('the writer’s gentle reminder', () => {
  const entry = (id: string, name: string): EntryState =>
    ({ id, kind: 'thread', name, aliases: [], summary: '', description: '', fields: { promise: `${name}?` }, happened: [], changed: [], updatedAt: '' }) as unknown as EntryState
  const thread = (entryId: string, t: Partial<ThreadState> = {}): ThreadState => ({ entryId, status: 'open', setUp: '', paidOff: '', ...t })

  it('names only threads overdue in this part of the story, most quiet first, at most two, in one line', () => {
    const entries = ['a', 'b', 'c', 'd'].map((id) => entry(id, `Thread ${id.toUpperCase()}`))
    const threads = [
      thread('a', { quiet: QUIET_SCENES + 1, lastStoryId: 's1' }),
      thread('b', { quiet: QUIET_SCENES + 5, lastStoryId: 's1' }),
      thread('c', { quiet: QUIET_SCENES + 9, lastStoryId: 's1' }),
      // Quiet for longer, but last touched in an earlier book: not overdue in this part of the story.
      thread('d', { quiet: 40, lastStoryId: 's0' })
    ]
    const open = openThreadsAt({ entries, threads, storyId: 's1' }, null)
    const line = quietReminder(open)
    expect(REMINDER_MOST).toBe(2)
    expect(line).toBe(
      `Quiet for a while: Thread C (${QUIET_SCENES + 9} scenes); Thread B (${QUIET_SCENES + 5} scenes). If one fits here, a passing mention keeps it alive; never force it.`
    )
    expect(line.split('\n')).toHaveLength(1)
    expect(openThreadsText(open).split('\n').at(-1)).toBe(line)
  })

  it('says nothing when no thread has been quiet for long', () => {
    const open = openThreadsAt({ entries: [entry('a', 'Thread A')], threads: [thread('a', { quiet: QUIET_SCENES - 1, lastStoryId: 's1' })], storyId: 's1' }, null)
    expect(quietReminder(open)).toBe('')
    expect(openThreadsText(open)).not.toContain('Quiet for a while')
  })

  it('keeps an overdue thread in the list even when more recent ones would fill it', () => {
    const entries = ['a', 'b', 'c'].map((id) => entry(id, `Thread ${id.toUpperCase()}`))
    entries[1].happened = [{ note: 'moved on', where: '', changeId: 'x', at: 9 }]
    entries[2].happened = [{ note: 'moved on', where: '', changeId: 'y', at: 8 }]
    const threads = [thread('a', { quiet: 12, lastStoryId: 's1' }), thread('b', { quiet: 0, lastStoryId: 's1' }), thread('c', { quiet: 1, lastStoryId: 's1' })]
    expect(openThreadsAt({ entries, threads, storyId: 's1' }, null, 2).map((t) => t.name)).toEqual(['Thread B', 'Thread A'])
  })

  it('goes to the writer in the open plot threads block', () => {
    const count = (t: string): number => Math.ceil(t.length / 4)
    const w = world(10)
    const input = gatherContextInput(w.db, w.scenes[9], undefined, { prefs: defaultWritingPrefs(), contextLength: 32000, creativity: 'balanced' })
    const block = assembleContext(input, count).blocks.find((b) => b.id === 'open-threads')!
    expect(block.text).toContain('Quiet for a while: The drowned bell (8 scenes)')
    // Not yet quiet for long when writing scene 5.
    const early = gatherContextInput(w.db, w.scenes[4], undefined, { prefs: defaultWritingPrefs(), contextLength: 32000, creativity: 'balanced' })
    expect(assembleContext(early, count).blocks.find((b) => b.id === 'open-threads')!.text).not.toContain('Quiet for a while')
  })
})
