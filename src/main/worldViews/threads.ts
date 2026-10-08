// The plot threads board (milestone 3): every plot thread that exists by a story's end, open or
// resolved as that story sees it, with where it was set up and paid off. Pure: ipc/worldViews.ts
// reads the world and passes it in. Tested in threads.test.ts.
//
// The memory decides open and resolved with the same line as drafting, so a thread resolved in a side
// story shows as resolved only in the stories that count that side story (spec, Multi-story rules).
// A thread the memory has never seen opened or resolved on the line is planned: it may be set up on a
// scene card (the plan), or nowhere yet. Scene cards also show where an open thread is meant to pay off.
import type { Change, ID } from '@shared/types'
import type { BoardPlace, BoardThread, ThreadsBoard } from '@shared/contracts/worldViews'
import type { Line, MemoryData, WorldShape } from '../memory/types'
import { indexChanges, type MemoryStateAll } from '../memory/state'
import { labeler } from '../memory/line'
import type { CardInfo } from '../db/worldViews'
import { chaptersAfter, walkOf } from './walk'
import { threadTouches } from '../memory/threadQuiet'

/** A thread open for this many chapters or more is highlighted on the board, so it isn't forgotten. */
export const LONG_OPEN_CHAPTERS = 10

export interface BoardInput {
  storyId: ID
  shape: WorldShape
  data: MemoryData
  /** The story's line through its end. */
  line: Line
  /** The memory at the story's end. */
  state: MemoryStateAll
  cards: Map<ID, CardInfo>
  /**
   * The words a resolving change was read from, and the "What changed" line that added it (2026-10-08). Left out (a
   * test): no words, no Undo.
   */
  payoff?: (changeIds: ID[]) => Map<ID, { quote: string; undoId: ID | null }>
  /**
   * The scenes holding words each thread's facts rest on (a clue, its promise, a mention), for the ledger's "last
   * touched" (B4). Left out (a test): only thread changes touch.
   */
  linkScenes?: (threadIds: ID[]) => Map<ID, Set<ID>>
}

const COLUMN_ORDER: Record<BoardThread['column'], number> = { open: 0, resolved: 1, planned: 2 }

export function buildBoard(input: BoardInput): ThreadsBoard {
  const { storyId, shape, data, line, state, cards } = input
  const label = labeler(shape)
  const w = walkOf(line)
  const changes = indexChanges(data.changes)

  // Each place on the line by its words, so the memory's "set up in Book 1, Ch 3, Sc 2" links to the scene.
  type Place = { step: number; storyId: ID | null; sceneId: ID | null }
  const places = new Map<string, Place>([['', { step: -1, storyId: null, sceneId: null }]])
  line.steps.forEach((step, i) => {
    if (step.type === 'scene') {
      const { storyId, sceneId } = step
      places.set(label({ storyId, sceneId }), { step: i, storyId, sceneId })
    } else if (step.type === 'start-changes') {
      places.set(label({ storyId: step.storyId }), { step: i, storyId: step.storyId, sceneId: null })
    }
  })

  // Which threads the memory sees opened or resolved on the line, and the scene cards' plans, in line order.
  const changed = new Set<ID>()
  // The change that resolved each thread last on the line (a later opening takes it back).
  const resolvedBy = new Map<ID, Change>()
  const note = (c: Change): void => {
    if (c.kind !== 'thread') return
    changed.add(c.entryId)
    if (c.payload.status === 'resolved') resolvedBy.set(c.entryId, c)
    else resolvedBy.delete(c.entryId)
  }
  for (const c of changes.baseline) note(c)
  const cardSetUp = new Map<ID, number>()
  const cardPayOff = new Map<ID, number>()
  line.steps.forEach((step, i) => {
    const { byStory, byScene } = changes
    const here = step.type === 'start-changes' ? byStory.get(step.storyId) : step.type === 'scene' ? byScene.get(step.sceneId) : []
    for (const c of here ?? []) note(c)
    if (step.type !== 'scene') return
    const card = cards.get(step.sceneId)
    for (const id of card?.setsUpIds ?? []) if (!cardSetUp.has(id)) cardSetUp.set(id, i)
    for (const id of card?.paysOffIds ?? []) if (!cardPayOff.has(id)) cardPayOff.set(id, i)
  })

  const fromStep = (i: number | undefined): BoardPlace | null => {
    const step = i === undefined ? undefined : line.steps[i]
    if (step?.type !== 'scene') return null
    return { label: label({ storyId: step.storyId, sceneId: step.sceneId }), storyId: step.storyId, sceneId: step.sceneId, planned: true }
  }
  const fromWords = (words: string): BoardPlace => {
    const at = places.get(words)
    return { label: words, storyId: at?.storyId ?? null, sceneId: at?.sceneId ?? null, planned: false }
  }

  // The ledger (B4): where each thread was last touched on the line, and how long it has been quiet since.
  const threadIds = state.threads.map((t) => t.entryId)
  const touches = threadTouches(line, changes, threadIds, input.linkScenes && threadIds.length ? input.linkScenes(threadIds) : new Map())
  const touchedAt = (id: ID): BoardPlace | null => {
    const t = touches.get(id)
    if (!t || !t.storyId) return null
    return { label: label({ storyId: t.storyId, sceneId: t.sceneId }), storyId: t.storyId, sceneId: t.sceneId, planned: false }
  }

  const resolving = state.threads.filter((t) => t.status === 'resolved').flatMap((t) => resolvedBy.get(t.entryId) ?? [])
  const payoffs = input.payoff && resolving.length ? input.payoff(resolving.map((c) => c.id)) : new Map<ID, { quote: string; undoId: ID | null }>()
  const entryRows = new Map(data.entries.map((e) => [e.id, e]))
  const threads: (BoardThread & { order: number })[] = []
  for (const t of state.threads) {
    const entry = state.entries.get(t.entryId)
    if (!entry) continue
    const inStory = changed.has(t.entryId)
    const column: BoardThread['column'] = !inStory ? 'planned' : t.status === 'resolved' ? 'resolved' : 'open'
    const setUp = inStory ? fromWords(t.setUp) : fromStep(cardSetUp.get(t.entryId))
    const paidOff = column === 'resolved' ? fromWords(t.paidOff) : fromStep(cardPayOff.get(t.entryId))
    const setUpStep = inStory ? places.get(t.setUp)?.step : cardSetUp.get(t.entryId)
    const openChapters = column === 'open' && setUpStep !== undefined ? chaptersAfter(w, setUpStep) : null
    const row = entryRows.get(t.entryId)
    const by = column === 'resolved' ? resolvedBy.get(t.entryId) : undefined
    const p = by ? payoffs.get(by.id) : undefined
    const byAi = !!by && by.origin === 'text'
    threads.push({
      id: t.entryId,
      name: entry.name.trim() || 'Unnamed plot thread',
      promise: (entry.fields.promise ?? '').trim(),
      column,
      setUp,
      paidOff,
      openChapters,
      longOpen: openChapters !== null && openChapters >= LONG_OPEN_CHAPTERS,
      aiMade: !!row && row.origin !== 'adam' && !row.byHand,
      resolved: column === 'resolved' ? { quote: p?.quote ?? '', byAi, undoId: byAi ? (p?.undoId ?? null) : null } : null,
      lastTouched: touchedAt(t.entryId),
      quietScenes: column === 'open' ? (touches.get(t.entryId)?.quiet ?? null) : null,
      order: setUpStep ?? Infinity
    })
  }
  threads.sort((a, b) => COLUMN_ORDER[a.column] - COLUMN_ORDER[b.column] || a.order - b.order || a.name.localeCompare(b.name))
  return { storyId, threads: threads.map(({ order: _order, ...t }) => t) }
}
