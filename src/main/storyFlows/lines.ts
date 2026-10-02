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
import { movedPosition } from './order'
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
      /**
       * An earlier AI-drafted change written over: the version to go back to, where it was among the
       * others, and where the run put it (a later run may move it on, to make room for its own drafts).
       */
      did: 'replaced'
      version: number
      position?: number
      placed?: number
      pointId?: ID | null
    }
  | { did: 'removed' }
  | {
      /** A plot thread closed as left unanswered; `open` while "Still open" is the answer. */
      did: 'closed'
      open: boolean
      /** True while the closing change is taken out because of that answer (see the same on 'sorted'). */
      removedByLine?: boolean
    }
  | {
      /** One of a book's start-of-story changes, sorted: where it was, and the answer in effect. */
      did: 'sorted'
      bookId: ID
      position: number
      origin: Origin
      pick: WhenPick
      /**
       * True while the change is taken out because of this line's answer ("It happens in the new
       * story"). Only then does another answer, or Undo, bring it back: a change Adam or a later run
       * took out stays out.
       */
      removedByLine: boolean
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

/** Moves a change back to its book's start, keeping who it is from, at its old place there. */
function moveTo(db: DB, c: Change, storyId: ID, position: number): void {
  if (c.storyId === storyId) return
  mem.replaceChange(db, c.id, { ...inputOf(c, storyId), origin: c.origin })
  fdb.setChangePosition(db, c.id, position)
}

/**
 * The changes sorted from a book's start for a new story (by lines not undone), with their places on
 * the book, so those moved to the new story's start keep the book's order there.
 */
export function sortedFromBook(db: DB, storyId: ID, bookId: ID): Map<ID, number> {
  const out = new Map<ID, number>()
  for (const l of fdb.flowLines(db)) {
    const u = l.undo
    if (!l.undone && isFlowUndo(u) && u.did === 'sorted' && u.storyId === storyId && u.bookId === bookId) out.set(u.changeId, u.position)
  }
  return out
}

/**
 * Moves a change from its book's start to the new story's start, keeping who it is from. It goes
 * before the changes already there, which say how things are at the new story's start (Adam's above
 * all), and keeps the book's order among the others moved from it (see movedPosition in order.ts).
 */
export function moveBefore(db: DB, c: Change, storyId: ID, bookPosition: number, fromBook: ReadonlyMap<ID, number>): void {
  if (c.storyId === storyId) return
  mem.replaceChange(db, c.id, { ...inputOf(c, storyId), origin: c.origin })
  const here = fdb.startChanges(db, storyId).filter((x) => x.id !== c.id)
  fdb.setChangePosition(db, c.id, movedPosition(here, bookPosition, fromBook))
}

/**
 * A sorted change back where it was on its book, as before the run: brought back (only when this
 * line's answer took it out) and moved back.
 */
function backOnBook(db: DB, u: Extract<FlowUndo, { did: 'sorted' }>): void {
  const row = fdb.anyChange(db, u.changeId)
  if (!row) return
  if (row.deleted && u.removedByLine) mem.restoreChange(db, u.changeId, { origin: u.origin })
  const c = liveChange(db, u.changeId)
  if (c) moveTo(db, c, u.bookId, u.position)
}

/** Applies an answer to "When did this happen?" to a change that is back on its book; true when it took the change out. */
function applyPick(db: DB, u: Extract<FlowUndo, { did: 'sorted' }>, pick: WhenPick, by: { origin: Origin; runId?: ID | null }): boolean {
  const c = liveChange(db, u.changeId)
  if (!c) return false
  if (pick === 'before') {
    const fromBook = sortedFromBook(db, u.storyId, u.bookId)
    fromBook.delete(c.id)
    moveBefore(db, c, u.storyId, u.position, fromBook)
  } else if (pick === 'in') {
    mem.deleteChange(db, c.id, by)
    return true
  }
  return false
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
      const current = liveChange(db, u.changeId)
      if (data && current) {
        mem.replaceChange(db, u.changeId, { ...inputOf(data), origin: old!.origin })
        // Back where it was, unless a later run has moved it on since to make room for its own drafts.
        if (u.position !== undefined && (u.placed === undefined || current.position === u.placed)) {
          fdb.setChangePosition(db, u.changeId, u.position)
        }
      }
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
    // "Still open" takes the closing change out; "Left unanswered" brings it back only if that answer
    // took it out (one Adam deleted, or a time gap worked out again took out, stays out).
    const open = optionId === 'open'
    const c = fdb.anyChange(db, u.changeId)
    let removedByLine = !!u.removedByLine
    if (open && c && !c.deleted) {
      mem.deleteChange(db, u.changeId, ADAM)
      removedByLine = true
    } else if (!open && removedByLine) {
      if (c?.deleted) mem.restoreChange(db, u.changeId, { origin: c.origin })
      removedByLine = false
    }
    next = { ...u, open, removedByLine }
  } else if (u.did === 'sorted') {
    const pick = optionId as WhenPick
    backOnBook(db, u)
    const removedByLine = applyPick(db, u, pick, ADAM)
    next = { ...u, pick, removedByLine }
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
    const title = fdb.storyTitle(db, id)?.trim() || 'Untitled story'
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

/** What a line's place says once something else has taken its change out of the memory. */
export const GONE = 'No longer in the memory'

/**
 * True when the line's change has been taken out of the memory by something other than the line
 * itself (Adam on the entry page, the time gap worked out again, or another line's answer "It happens
 * in the new story"): there is nothing left to answer or undo here.
 */
export function changeGone(u: FlowUndo, undone: boolean, at: At): boolean {
  if (undone || (at && !at.deleted)) return false
  return !(u.did === 'removed' || (u.did === 'closed' && u.removedByLine) || (u.did === 'sorted' && u.pick === 'in' && u.removedByLine))
}

type SortedUndo = Extract<FlowUndo, { did: 'sorted' }>

/** True when this line's own answer "It happens in the new story" has taken its change out: a scene of the new story carries it. */
const carriedByLine = (u: FlowUndo, undone: boolean, at: At): u is SortedUndo =>
  u.did === 'sorted' && u.pick === 'in' && u.removedByLine && !undone && (!at || at.deleted)

/** "Happens in The Quiet Year, Ch 1, Sc 2" (or "Happens in The Quiet Year" when its scene isn't known). */
function happensIn(u: SortedUndo, title: (storyId: ID) => string, scene: (storyId: ID, sceneId: ID) => string | null): string {
  return `Happens in ${(u.sceneId && scene(u.storyId, u.sceneId)) || title(u.storyId)}`
}

/**
 * Where a flow line's change is now, in plain words: "Start of Book 4", or for one that happens in a
 * new story's scene, "Happens in The Quiet Year, Ch 1, Sc 2". A change moved since (by "When did
 * these happen?") shows where it went; one taken out since by something else says so.
 */
export function flowPlace(
  u: FlowUndo,
  undone: boolean,
  at: At,
  title: (storyId: ID) => string,
  scene: (storyId: ID, sceneId: ID) => string | null
): string {
  if (changeGone(u, undone, at)) return GONE
  if (carriedByLine(u, undone, at)) return happensIn(u, title, scene)
  return `Start of ${title(at?.storyId ?? u.storyId)}`
}

/**
 * Every flow run listed in What changed, with its heading, each line's place, and the lines whose
 * change is gone. Other lines about a change that "It happens in the new story" took out say where it
 * happens now, as that line does.
 */
export function flowRuns(db: DB, shape: WorldShape | null): StoryFlowRun[] {
  const title = titleFinder(db, shape)
  const label = shape ? labeler(shape) : null
  const live = new Set(shape?.stories.flatMap((s) => s.chapters.flatMap((c) => c.scenes.map((sc) => sc.id))) ?? [])
  const scene = (storyId: ID, sceneId: ID): string | null => (label && live.has(sceneId) ? label({ storyId, sceneId }) : null)
  const changes = fdb.flowLineChanges(db)
  const rows = fdb.flowLines(db).flatMap((row) => (isFlowUndo(row.undo) ? [{ row, u: row.undo }] : []))
  const carried = new Map<ID, string>()
  for (const { row, u } of rows) {
    const at = changes.get(u.changeId) ?? null
    if (carriedByLine(u, row.undone, at)) carried.set(u.changeId, happensIn(u, title, scene))
  }
  const runs = new Map<ID, StoryFlowRun>()
  for (const { row, u } of rows) {
    let run = runs.get(row.runId)
    if (!run) {
      run = { runId: row.runId, flow: u.flow, storyId: u.storyId, heading: flowHeading(u, title), places: {}, gone: [] }
      runs.set(row.runId, run)
    }
    const at = changes.get(u.changeId) ?? null
    const gone = changeGone(u, row.undone, at)
    run.places[row.id] = gone ? (carried.get(u.changeId) ?? GONE) : flowPlace(u, row.undone, at, title, scene)
    if (gone) run.gone.push(row.id)
  }
  return [...runs.values()]
}
