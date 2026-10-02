// The story flows' lines in What changed: what undoing or answering each needs (kept with the line),
// Undo and answers, and the heading and place each line shows in plain words. Undo puts back exactly
// what the line changed; answering a question-marked line applies the option picked, and can be
// changed any time. Undo and answers run inside a transaction (the caller's). No Electron imports.

import type Database from 'better-sqlite3'
import type { Change, ChangeInput, ID, Origin } from '@shared/types'
import type { StoryFlowKind, StoryFlowRun } from '@shared/contracts/storyFlows'
import type { WorldShape } from '../memory/types'
import { labeler } from '../memory/line'
import * as mem from '../db/memory'
import * as kdb from '../db/keeper'
import type { LogRow } from '../db/keeper'
import * as fdb from '../db/storyFlows'
import { UserError } from '../util'
import type { WhenPick } from './parse'

type DB = Database.Database

/** What undoing (or answering) a flow's line needs. `op` comes first, so the lines can be found by it. */
export type FlowUndo = {
  op: 'story-flow'
  flow: StoryFlowKind
  /** The story the run was for (the new story, for "When did these happen?"). */
  storyId: ID
  changeId: ID
} & (
  | {
      /** A new change at the story's start, and the first-exists point it needed (a prequel's starting cast). */
      did: 'added'
      pointId?: ID | null
    }
  | {
      /** An earlier AI-drafted change written over: the version to go back to. */
      did: 'replaced'
      version: number
      pointId?: ID | null
    }
  | { did: 'removed' }
  | {
      /** A plot thread closed as left unanswered; `open` while "Still open" is the answer. */
      did: 'closed'
      open: boolean
    }
  | {
      /** One of a book's start-of-story changes, sorted: where it was, and the answer in effect. */
      did: 'sorted'
      bookId: ID
      position: number
      origin: Origin
      pick: WhenPick
      /** The new story's scene that carries it, when the model said so. */
      sceneId: ID | null
    }
)

/** The same as Outcome in keeper/undo.ts: what the memory:changed event says. */
export interface FlowOutcome {
  sceneId: ID | null
  entryIds: ID[]
}

export const isFlowUndo = (u: unknown): u is FlowUndo => !!u && typeof u === 'object' && (u as { op?: unknown }).op === 'story-flow'

/** True for a line one of the story flows wrote. */
export const isFlowLine = (row: Pick<LogRow, 'undo'>): boolean => isFlowUndo(row.undo)

export const STILL_OPEN = {
  text: 'Still open?',
  options: [
    { id: 'unanswered', label: 'Left unanswered' },
    { id: 'open', label: 'Still open' }
  ]
}

export const WHEN = {
  text: 'When did this happen?',
  options: [
    { id: 'before', label: 'Before the new story' },
    { id: 'after', label: 'After it' },
    { id: 'in', label: 'It happens in the new story' }
  ]
}

const ADAM = { origin: 'adam' as const }

function liveChange(db: DB, id: ID): Change | null {
  try {
    return mem.getChange(db, id)
  } catch {
    return null
  }
}

const inputOf = (c: Change, storyId: ID | null = c.storyId): ChangeInput =>
  ({ kind: c.kind, payload: c.payload, entryId: c.entryId, anchor: c.anchor, storyId, sceneId: c.sceneId }) as ChangeInput

/** Who wrote the version of a change before its latest one. */
function earlierOrigin(db: DB, id: ID, fallback: Origin): Origin {
  const v = kdb.latestVersion(db, 'change', id)
  return kdb.versionData(db, 'change', id, v - 1)?.origin ?? fallback
}

/** Moves a change to a story's start, keeping who it is from; back on its book, it returns to its old place there. */
function moveTo(db: DB, c: Change, storyId: ID, position?: number): void {
  if (c.storyId === storyId) return
  mem.replaceChange(db, c.id, { ...inputOf(c, storyId), origin: c.origin })
  if (position !== undefined) fdb.setChangePosition(db, c.id, position)
}

/** A sorted change back where it was on its book, as before the run: brought back and moved back. */
function backOnBook(db: DB, u: Extract<FlowUndo, { did: 'sorted' }>): void {
  const row = fdb.anyChange(db, u.changeId)
  if (!row) return
  if (row.deleted) mem.restoreChange(db, u.changeId, { origin: u.origin })
  const c = liveChange(db, u.changeId)
  if (c) moveTo(db, c, u.bookId, u.position)
}

/** Applies an answer to "When did this happen?" to a change that is back on its book. */
function applyPick(db: DB, u: Extract<FlowUndo, { did: 'sorted' }>, pick: WhenPick, by: { origin: Origin; runId?: ID | null }): void {
  const c = liveChange(db, u.changeId)
  if (!c) return
  if (pick === 'before') moveTo(db, c, u.storyId)
  else if (pick === 'in') mem.deleteChange(db, c.id, by)
}

/** Undoes one of a flow's lines: puts back exactly what it changed. */
export function undoFlowLine(db: DB, row: LogRow): FlowOutcome {
  const u = row.undo as FlowUndo
  const out: FlowOutcome = { sceneId: null, entryIds: row.entryId ? [row.entryId] : [] }
  if (row.undone || row.action === 'failed') return out
  switch (u.did) {
    case 'added':
    case 'closed':
      if (liveChange(db, u.changeId)) mem.deleteChange(db, u.changeId, ADAM)
      if (u.did === 'added' && u.pointId) fdb.deletePoint(db, u.pointId)
      break
    case 'replaced': {
      const old = kdb.versionData(db, 'change', u.changeId, u.version)
      const data = old?.data as Change | null
      if (data && liveChange(db, u.changeId)) mem.replaceChange(db, u.changeId, { ...inputOf(data), origin: old!.origin })
      if (u.pointId) fdb.deletePoint(db, u.pointId)
      break
    }
    case 'removed': {
      const c = fdb.anyChange(db, u.changeId)
      if (c?.deleted) mem.restoreChange(db, u.changeId, { origin: earlierOrigin(db, u.changeId, 'ai') })
      break
    }
    case 'sorted':
      backOnBook(db, u)
      break
  }
  const now = liveChange(db, u.changeId)
  if (now) out.entryIds.push(...mem.entriesTouched(now))
  kdb.markUndone(db, row.id)
  return out
}

/** Applies the option Adam picked on one of a flow's question-marked lines (he can change it any time). */
export function answerFlowLine(db: DB, row: LogRow, optionId: string): FlowOutcome {
  const u = row.undo as FlowUndo
  const out: FlowOutcome = { sceneId: null, entryIds: row.entryId ? [row.entryId] : [] }
  if (!row.question) throw new UserError("That line doesn't ask anything.")
  if (!row.question.options.some((o) => o.id === optionId)) throw new UserError("That answer isn't one of the choices.")
  if (row.undone) throw new UserError('That change was undone, so there is nothing to answer.')
  let next: FlowUndo = u
  if (u.did === 'closed') {
    const open = optionId === 'open'
    const c = fdb.anyChange(db, u.changeId)
    if (open && c && !c.deleted) mem.deleteChange(db, u.changeId, ADAM)
    else if (!open && c?.deleted) mem.restoreChange(db, u.changeId, { origin: c.origin })
    next = { ...u, open }
  } else if (u.did === 'sorted') {
    const pick = optionId as WhenPick
    backOnBook(db, u)
    applyPick(db, u, pick, ADAM)
    next = { ...u, pick }
  }
  kdb.setLogQuestion(db, row.id, { ...row.question, answer: optionId }, next as unknown as Record<string, unknown>)
  return out
}

// ---------- In plain words ----------

/** A story's title, live or deleted. */
function titleFinder(db: DB, shape: WorldShape | null): (storyId: ID) => string {
  const titles = new Map(shape?.stories.map((s) => [s.id, s.title]) ?? [])
  return (id) => {
    const known = titles.get(id)
    if (known !== undefined) return known.trim() || 'Untitled story'
    const r = db.prepare('SELECT title FROM stories WHERE id = ?').get(id) as { title?: string } | undefined
    const title = r?.title?.trim() || 'Untitled story'
    titles.set(id, title)
    return title
  }
}

/** The heading of a flow run's group in What changed. */
export function flowHeading(u: FlowUndo, title: (storyId: ID) => string): string {
  switch (u.flow) {
    case 'time-gap':
      return `Before ${title(u.storyId)} starts`
    case 'starting-cast':
      return `Starting cast for ${title(u.storyId)}`
    case 'when':
      return 'When did these happen?'
  }
}

/** Where a change is now: its story (the one it was at, once deleted), or null once it is gone for good. */
type At = { storyId: ID | null; deleted: boolean } | null

/**
 * Where a flow line's change is now, in plain words: "Start of Book 4", or for one that happens in a
 * new story's scene, "The Quiet Year, Ch 1, Sc 2". A change moved since (by "When did these happen?")
 * shows where it went.
 */
export function flowPlace(
  u: FlowUndo,
  undone: boolean,
  at: At,
  title: (storyId: ID) => string,
  scene: (storyId: ID, sceneId: ID) => string | null
): string {
  if (u.did === 'sorted' && u.pick === 'in' && !undone && (!at || at.deleted)) {
    return (u.sceneId && scene(u.storyId, u.sceneId)) || `In ${title(u.storyId)}`
  }
  return `Start of ${title(at?.storyId ?? u.storyId)}`
}

/**
 * Places in plain words for flow lines, read from the open world: null for a line that isn't one of
 * the flows'. Made once per list (ipc/keeper.ts withWhere can use it for each line's `where`).
 */
export function flowPlacer(db: DB, shape: WorldShape | null): (row: Pick<LogRow, 'undo' | 'undone'>) => string | null {
  const title = titleFinder(db, shape)
  const label = shape ? labeler(shape) : null
  const live = new Set(shape?.stories.flatMap((s) => s.chapters.flatMap((c) => c.scenes.map((sc) => sc.id))) ?? [])
  const scene = (storyId: ID, sceneId: ID): string | null => (label && live.has(sceneId) ? label({ storyId, sceneId }) : null)
  return (row) => (isFlowUndo(row.undo) ? flowPlace(row.undo, row.undone, fdb.anyChange(db, row.undo.changeId), title, scene) : null)
}

/** Every flow run listed in What changed, with its heading and each line's place. */
export function flowRuns(db: DB, shape: WorldShape | null): StoryFlowRun[] {
  const title = titleFinder(db, shape)
  const place = flowPlacer(db, shape)
  const runs = new Map<ID, StoryFlowRun>()
  for (const row of fdb.flowLines(db)) {
    if (!isFlowUndo(row.undo)) continue
    const u = row.undo
    let run = runs.get(row.runId)
    if (!run) {
      run = { runId: row.runId, flow: u.flow, storyId: u.storyId, heading: flowHeading(u, title), places: {} }
      runs.set(row.runId, run)
    }
    run.places[row.id] = place(row) ?? ''
  }
  return [...runs.values()]
}
