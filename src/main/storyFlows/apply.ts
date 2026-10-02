// Writes a story flow's results into the memory, with their lines in What changed, as one memory run
// (scene '', see db/storyFlows.ts). The rules (spec, Multi-story rules, "Automatic flows"):
// - Everything a flow drafts has origin 'ai' ("drafted by AI"), so the text replaces it when it says
//   otherwise and Adam editing it makes it his.
// - Nothing Adam made is overwritten or removed: a change he already has for the same thing at that
//   start wins, and his own start-of-story changes are only ever moved by "When did these happen?".
// - Every line can be undone; a judgement call carries a question mark with the other answers.
// - A run that changes nothing writes nothing, not even the run.
// Runs inside a transaction (the caller's). No Electron imports.

import type Database from 'better-sqlite3'
import type { Change, ChangeData, Entry, EntryKind, FullPayload, ID, Story } from '@shared/types'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import * as kdb from '../db/keeper'
import type { LogRow, NewLog } from '../db/keeper'
import * as fdb from '../db/storyFlows'
import { changeContent, changeWords, fieldLabel } from '../keeper/facts'
import { clip, plain, upperFirst } from '../keeper/text'
import { isFlowUndo, moveBefore, sortedFromBook, STILL_OPEN, WHEN, type FlowUndo } from './lines'
import { insertInOrder, placeCast, positionBefore, touchesAny, type CastDraft } from './order'
import type { GapPlan, WhenPick } from './parse'

type DB = Database.Database

/** What a run did, for its status and the memory:changed event. */
export interface Applied {
  runId: ID | null
  /** Lines written in What changed. */
  lines: number
  entryIds: ID[]
  /** Counts for the status note. */
  added: number
  removed: number
  closed: number
  moved: number
  left: number
  carried: number
}

const nothing = (): Applied => ({ runId: null, lines: 0, entryIds: [], added: 0, removed: 0, closed: 0, moved: 0, left: 0, carried: 0 })

/** Who made the run and what it cost, for its row in memory_runs. */
export type RunTotals = kdb.RunTotals

type Line = Omit<NewLog, 'runId' | 'sceneId' | 'undo'> & { undo: FlowUndo }

/** Starts the run, writes its lines and finishes it; the changes themselves are written by `write`. */
function inRun(db: DB, totals: RunTotals, write: (runId: ID) => Line[]): { runId: ID; lines: number } {
  const runId = kdb.startRun(db, fdb.FLOW_RUN_SCENE, 0)
  const lines = write(runId)
  for (const l of lines) kdb.insertLog(db, { ...l, runId, sceneId: null, undo: l.undo as unknown as Record<string, unknown> })
  kdb.finishRun(db, runId, 'done', null, totals)
  return { runId, lines: lines.length }
}

const liveEntries = (db: DB, ids: ID[]): Map<ID, Entry> => new Map(repo.getEntries(db, [...new Set(ids)]).map((e) => [e.id, e]))

/** New field values with their names as the entry page shows them: "Key past events: fell at the siege; Age or birth date: 240". */
function fieldWords(kind: EntryKind | undefined, fields: Record<string, string> | undefined): string {
  return Object.entries(fields ?? {})
    .filter(([, v]) => v)
    .map(([k, v]) => `${kind ? fieldLabel({ kind }, k) : upperFirst(k)}: ${v}`)
    .join('; ')
}

/** A plot thread a time gap closed, in What changed. */
const LEFT_UNANSWERED = 'Plot thread left unanswered'

const leftUnanswered = (c: ChangeData): boolean =>
  c.kind === 'thread' && c.payload.status === 'resolved' && plain(c.payload.note) === 'left unanswered'

/**
 * A change in plain words for a flow's line, as the keeper says it but with field names as the entry
 * page shows them, and a plot thread as its time gap line says it ("Plot thread left unanswered"),
 * with any other note shown under it (afterWords).
 */
function words(c: ChangeData, kind: EntryKind | undefined, nameOf: (id: ID) => string): string {
  if (c.kind === 'update' && !c.payload.note.trim()) return upperFirst(fieldWords(kind, c.payload.fields)) || 'Changed'
  if (c.kind === 'thread') {
    if (leftUnanswered(c)) return LEFT_UNANSWERED
    return c.payload.status === 'resolved' ? 'Plot thread resolved' : 'Plot thread opened'
  }
  return changeWords(c, nameOf)
}

/** What shows under a change's words: the new field values of one that also has a note, or a plot thread's note. */
function afterWords(c: ChangeData, kind: EntryKind | undefined): string {
  if (c.kind === 'update') return c.payload.note.trim() ? fieldWords(kind, c.payload.fields) : ''
  if (c.kind === 'thread') return leftUnanswered(c) ? '' : upperFirst(c.payload.note.trim())
  return ''
}

/** Every flow line, by the change it is about (one read for a whole run). */
function linesByChange(db: DB): Map<ID, LogRow[]> {
  const out = new Map<ID, LogRow[]>()
  for (const l of fdb.flowLines(db)) {
    if (!l.factId) continue
    const list = out.get(l.factId)
    if (list) list.push(l)
    else out.set(l.factId, [l])
  }
  return out
}

const fieldsOf = (c: ChangeData): string => JSON.stringify(c.kind === 'update' ? (c.payload.fields ?? {}) : null)

const sameContent = (a: ChangeData, b: ChangeData): boolean =>
  a.kind === b.kind &&
  plain(changeContent(a)) === plain(changeContent(b)) &&
  fieldsOf(a) === fieldsOf(b) &&
  (a.kind !== 'relationship' || (b.kind === 'relationship' && a.payload.otherId === b.payload.otherId))

/**
 * True when a change already at the start says something about the same thing, so a drafted one isn't
 * added beside it (where it would win over it): the same kind of change for the entry, any
 * relationship between the same two (recorded on either side), or a starting description of the entry
 * (of either one, for a relationship), which sets it afresh there.
 */
function sameThing(c: Change, entryId: ID, data: ChangeData): boolean {
  if (data.kind === 'relationship') {
    const pair = [entryId, data.payload.otherId]
    if (c.kind === 'full') return pair.includes(c.entryId)
    return c.kind === 'relationship' && pair.includes(c.entryId) && pair.includes(c.payload.otherId)
  }
  return c.entryId === entryId && (c.kind === 'full' || c.kind === data.kind)
}

/** Changes at this story's start that an earlier time gap run drafted (and nobody has edited since). */
function earlierGapChanges(log: Map<ID, LogRow[]>, storyId: ID, changes: Change[]): Change[] {
  return changes.filter(
    (c) =>
      c.origin === 'ai' &&
      c.kind !== 'full' &&
      (log.get(c.id) ?? []).some(
        (l) => isFlowUndo(l.undo) && l.undo.flow === 'time-gap' && l.undo.storyId === storyId && l.undo.did !== 'removed'
      )
  )
}

/**
 * What Adam turned down in this story's earlier time gap runs, so working the gap out again doesn't
 * bring it back: changes he undid (by entry and words) and plot threads he kept open.
 */
function turnedDown(log: Map<ID, LogRow[]>, storyId: ID): { words: Set<string>; open: Set<ID> } {
  const out = { words: new Set<string>(), open: new Set<ID>() }
  for (const l of [...log.values()].flat()) {
    const u = l.undo
    if (!isFlowUndo(u) || u.flow !== 'time-gap' || u.storyId !== storyId || !l.entryId) continue
    if (u.did === 'added' && l.undone) out.words.add(`${l.entryId}:${l.text}`)
    if (u.did === 'closed' && (l.undone || u.open)) out.open.add(l.entryId)
  }
  return out
}

// ---------- What changed before this story starts? ----------

/** A time gap's earlier change taken out when it is worked out again, in What changed. */
export const TAKEN_OUT = 'Taken out when the time gap was worked out again'
export const OPEN_AGAIN = 'Plot thread open again after the time gap was worked out again'

/**
 * Writes a time gap's changes at the story's start. Running it again replaces what an earlier run
 * drafted (keeping what is the same) and leaves Adam's changes alone, and what he undid or kept open.
 * Each new change goes before the changes already there about the same entries, so those still count
 * on top of it.
 */
export function applyGap(db: DB, story: Story, plan: GapPlan, totals: RunTotals): Applied {
  const here = fdb.startChanges(db, story.id)
  const log = linesByChange(db)
  const earlier = earlierGapChanges(log, story.id, here)
  const others = here.filter((c) => !earlier.includes(c))
  const touched = plan.changes.flatMap((c) => [c.entryId, ...mem.entriesTouched({ ...c.data, entryId: c.entryId })])
  const entries = liveEntries(db, [...touched, ...plan.closed, ...earlier.map((c) => c.entryId)])
  const nameOf = (id: ID): string => entries.get(id)?.name ?? repo.getEntries(db, [id])[0]?.name ?? 'someone'
  const kindOf = (id: ID): EntryKind | undefined => entries.get(id)?.kind
  const kept = new Set<ID>()
  const refused = turnedDown(log, story.id)

  const toAdd: GapPlan['changes'] = []
  for (const item of plan.changes) {
    if (!mem.entriesTouched({ ...item.data, entryId: item.entryId }).every((id) => entries.has(id))) continue
    if (others.some((c) => sameThing(c, item.entryId, item.data))) continue
    if (refused.words.has(`${item.entryId}:${words(item.data, kindOf(item.entryId), nameOf)}`)) continue
    const same = earlier.find((c) => !kept.has(c.id) && c.entryId === item.entryId && sameContent(c, item.data))
    if (same) kept.add(same.id)
    else toAdd.push(item)
  }
  const toClose: ID[] = []
  for (const threadId of plan.closed) {
    if (!entries.has(threadId) || refused.open.has(threadId) || others.some((c) => c.entryId === threadId && c.kind === 'thread')) continue
    const same = earlier.find((c) => !kept.has(c.id) && c.entryId === threadId && c.kind === 'thread' && c.payload.status === 'resolved')
    if (same) kept.add(same.id)
    else toClose.push(threadId)
  }
  const toRemove = earlier.filter((c) => !kept.has(c.id))
  if (!toAdd.length && !toClose.length && !toRemove.length) return nothing()

  // The changes at the start as they will be, to place each new one: before the first one about the
  // same entries that isn't the time gap's own.
  const work = here.filter((c) => !toRemove.includes(c))
  const gapOwn = new Set(earlier.map((c) => c.id))
  const positionFor = (ids: ID[]): { position?: number } => {
    const at = positionBefore(work, (c) => !gapOwn.has(c.id) && touchesAny(c, ids))
    return at === null ? {} : { position: at }
  }
  const track = (c: Change): Change => {
    gapOwn.add(c.id)
    insertInOrder(work, c)
    return c
  }

  const out = nothing()
  const base = { op: 'story-flow' as const, flow: 'time-gap' as const, storyId: story.id }
  const written = inRun(db, totals, (runId) => {
    const lines: Line[] = []
    const by = { origin: 'ai' as const, runId }
    for (const c of toRemove) {
      mem.deleteChange(db, c.id, by)
      out.removed++
      out.entryIds.push(...mem.entriesTouched(c))
      // What it was shows struck through under what happened to it.
      lines.push({
        action: 'removed',
        what: 'change',
        entryId: c.entryId,
        factId: c.id,
        entryName: nameOf(c.entryId),
        text: c.kind === 'thread' ? OPEN_AGAIN : TAKEN_OUT,
        before: words(c, kindOf(c.entryId), nameOf),
        after: '',
        quote: '',
        question: null,
        undo: { ...base, changeId: c.id, did: 'removed' }
      })
    }
    for (const item of toAdd) {
      const ids = mem.entriesTouched({ ...item.data, entryId: item.entryId })
      const data = { ...item.data, entryId: item.entryId, anchor: 'story-start' as const, storyId: story.id }
      const c = track(mem.insertChange(db, { ...data, ...by, ...positionFor(ids) }))
      out.added++
      out.entryIds.push(...ids)
      lines.push({
        action: 'added',
        what: 'change',
        entryId: c.entryId,
        factId: c.id,
        entryName: nameOf(c.entryId),
        text: words(c, kindOf(c.entryId), nameOf),
        before: '',
        after: afterWords(c, kindOf(c.entryId)),
        quote: '',
        question: null,
        undo: { ...base, changeId: c.id, did: 'added' }
      })
    }
    for (const threadId of toClose) {
      const c = track(
        mem.insertChange(db, {
          kind: 'thread',
          payload: { status: 'resolved', note: 'left unanswered' },
          entryId: threadId,
          anchor: 'story-start',
          storyId: story.id,
          ...by,
          ...positionFor([threadId])
        })
      )
      out.closed++
      out.entryIds.push(threadId)
      lines.push({
        action: 'added',
        what: 'change',
        entryId: threadId,
        factId: c.id,
        entryName: nameOf(threadId),
        text: LEFT_UNANSWERED,
        before: '',
        after: '',
        quote: '',
        question: { ...STILL_OPEN, answer: 'unanswered' },
        undo: { ...base, changeId: c.id, did: 'closed', open: false, removedByLine: false }
      })
    }
    return lines
  })
  return { ...out, runId: written.runId, lines: written.lines }
}

// ---------- A prequel's starting cast ----------

/** True when this entry already has a starting description at the story's start that isn't AI-drafted (Adam's, or the text's). */
export function hasOwnStart(changes: Change[], entryId: ID): boolean {
  return changes.some((c) => c.entryId === entryId && c.kind === 'full' && c.origin !== 'ai')
}

const startWords = (p: FullPayload): string => clip(p.summary?.trim() || p.description, 30)

/**
 * Makes an entry exist from the prequel's start (unless a point there already does), and returns the
 * point added. It goes after the entry's default point, so working the defaults out again (when a
 * story's kind or start changes) leaves it be. An entry without a default left would have it taken for
 * one and moved, so there it is kept as a point set on purpose.
 */
function startPoint(db: DB, entry: Entry, storyId: ID): ID | null {
  const points = mem.listExistsPoints(db, entry.id)
  if (points.some((x) => x.kind === 'story-pre' && x.storyId === storyId)) return null
  // The same test refreshDefaultExistsPoints uses to find an entry's default.
  const hasDefault = points.some((x) => !x.byHand && (x.kind !== 'scene' || x.sceneId === entry.originSceneId))
  return mem.addExistsPoint(db, { entryId: entry.id, kind: 'story-pre', storyId, sceneId: null, byHand: !hasDefault }).id
}

/** Two starting descriptions that say the same (facts known are compared by their words, as their ids are new each time). */
const sameStart = (a: FullPayload, b: FullPayload): boolean => {
  const key = (p: FullPayload): string =>
    JSON.stringify([p.description.trim(), p.summary ?? '', p.fields ?? {}, p.relationships, p.knows.map((k) => k.fact)])
  return key(a) === key(b)
}

type Draft = { entryId: ID; payload: FullPayload }

/**
 * Writes each drafted starting description at the prequel's start, replacing an earlier AI-drafted
 * one, and makes each entry exist from the prequel's start. An entry with a starting description of
 * Adam's (or the text's) is left alone. Each draft goes before the changes at the start about its
 * entry, so those still count on top of it, and after the starting description of each entry it names,
 * so the relationship holds as it says it (see placeCast in order.ts).
 */
export function applyCast(db: DB, story: Story, drafts: Draft[], totals: RunTotals): Applied {
  const here = fdb.startChanges(db, story.id)
  const entries = liveEntries(db, drafts.flatMap((d) => [d.entryId, ...d.payload.relationships.map((r) => r.otherId)]))
  const plan: CastDraft[] = []
  for (const d of drafts) {
    if (!entries.has(d.entryId) || hasOwnStart(here, d.entryId) || plan.some((p) => p.entryId === d.entryId)) continue
    const payload = { ...d.payload, relationships: d.payload.relationships.filter((r) => entries.has(r.otherId)) }
    const old = here.find((c) => c.entryId === d.entryId && c.kind === 'full') ?? null
    if (old && old.kind === 'full' && sameStart(old.payload, payload)) continue
    plan.push({ entryId: d.entryId, payload, old })
  }
  if (!plan.length) return nothing()
  const placed = placeCast(here, plan)

  const out = nothing()
  const base = { op: 'story-flow' as const, flow: 'starting-cast' as const, storyId: story.id }
  const written = inRun(db, totals, (runId) => {
    const lines: Line[] = []
    const by = { origin: 'ai' as const, runId }
    // Earlier drafts making room move only past changes about other entries, so what they say stays the same.
    for (const [id, position] of placed.moved) fdb.setChangePosition(db, id, position)
    for (const p of plan) {
      const name = entries.get(p.entryId)!.name
      const data = { kind: 'full' as const, payload: p.payload, entryId: p.entryId, anchor: 'story-start' as const, storyId: story.id }
      const pointId = startPoint(db, entries.get(p.entryId)!, story.id)
      const at = placed.at.get(p.entryId)!
      let c: Change
      if (p.old) {
        const version = kdb.latestVersion(db, 'change', p.old.id)
        c = mem.replaceChange(db, p.old.id, { ...data, ...by })
        if (at !== p.old.position) fdb.setChangePosition(db, c.id, at)
        lines.push({
          action: 'updated',
          what: 'change',
          entryId: p.entryId,
          factId: c.id,
          entryName: name,
          text: 'Starting description, drafted again by AI',
          before: p.old.kind === 'full' ? startWords(p.old.payload) : '',
          after: startWords(p.payload),
          quote: '',
          question: null,
          undo: { ...base, changeId: c.id, did: 'replaced', version, position: p.old.position, placed: at, pointId }
        })
      } else {
        c = mem.insertChange(db, { ...data, ...by, position: at })
        out.added++
        lines.push({
          action: 'added',
          what: 'change',
          entryId: p.entryId,
          factId: c.id,
          entryName: name,
          text: 'Starting description, drafted by AI',
          before: '',
          after: startWords(p.payload),
          quote: '',
          question: null,
          undo: { ...base, changeId: c.id, did: 'added', pointId }
        })
      }
      out.entryIds.push(...mem.entriesTouched(c), ...(p.old ? mem.entriesTouched(p.old) : []))
    }
    return lines
  })
  return { ...out, runId: written.runId, lines: written.lines }
}

// ---------- When did these happen? ----------

/** Changes at the book's start already sorted against this new story (by a line that wasn't undone). */
export function alreadySorted(db: DB, storyId: ID, bookId: ID, changes: Change[]): Set<ID> {
  const log = linesByChange(db)
  const out = new Set<ID>()
  for (const c of changes) {
    const sorted = (log.get(c.id) ?? []).some(
      (l) => !l.undone && isFlowUndo(l.undo) && l.undo.did === 'sorted' && l.undo.storyId === storyId && l.undo.bookId === bookId
    )
    if (sorted) out.add(c.id)
  }
  return out
}

/**
 * Sorts each of the book's start-of-story changes as picked: moved to the new story's start, left on
 * the book, or removed because a scene of the new story carries it. Every one gets a line asking
 * "When did this happen?". Adam's own changes are moved too, keeping his origin, but never removed
 * automatically: for those "It happens in the new story" waits for his answer. A moved change goes
 * before the changes already at the new story's start, which say how things are there (see moveBefore).
 */
export function applyWhen(
  db: DB,
  story: Story,
  book: Story,
  changeIds: ID[],
  picks: Map<ID, { pick: WhenPick; sceneId: ID | null }>,
  totals: RunTotals
): Applied {
  const plan: { c: Change; pick: WhenPick; sceneId: ID | null }[] = []
  for (const id of changeIds) {
    let c: Change
    try {
      c = mem.getChange(db, id)
    } catch {
      continue // removed meanwhile
    }
    if (c.anchor !== 'story-start' || c.storyId !== book.id) continue
    const got = picks.get(id) ?? { pick: 'after' as const, sceneId: null }
    const pick: WhenPick = got.pick === 'in' && c.origin === 'adam' ? 'after' : got.pick
    plan.push({ c, pick, sceneId: got.sceneId })
  }
  if (!plan.length) return nothing()

  const entries = liveEntries(db, plan.flatMap((p) => mem.entriesTouched(p.c)))
  const nameOf = (id: ID): string => entries.get(id)?.name ?? repo.getEntries(db, [id])[0]?.name ?? 'someone'
  // Those moved to the new story's start from this book before, and their places on it, so the ones
  // moved now keep the book's order among them.
  const fromBook = sortedFromBook(db, story.id, book.id)
  const out = nothing()
  const written = inRun(db, totals, (runId) => {
    const lines: Line[] = []
    for (const { c, pick, sceneId } of plan) {
      if (pick === 'before') {
        moveBefore(db, c, story.id, c.position, fromBook)
        fromBook.set(c.id, c.position)
        out.moved++
      } else if (pick === 'in') {
        mem.deleteChange(db, c.id, { origin: 'ai', runId })
        out.carried++
      } else out.left++
      out.entryIds.push(...mem.entriesTouched(c))
      lines.push({
        action: 'updated',
        what: 'change',
        entryId: c.entryId,
        factId: c.id,
        entryName: nameOf(c.entryId),
        text: c.kind === 'full' ? 'Starting description' : words(c, entries.get(c.entryId)?.kind, nameOf),
        before: '',
        after: afterWords(c, entries.get(c.entryId)?.kind),
        quote: '',
        question: { ...WHEN, answer: pick },
        undo: {
          op: 'story-flow',
          flow: 'when',
          storyId: story.id,
          changeId: c.id,
          did: 'sorted',
          bookId: book.id,
          position: c.position,
          origin: c.origin,
          pick,
          removedByLine: pick === 'in',
          sceneId
        }
      })
    }
    return lines
  })
  return { ...out, runId: written.runId, lines: written.lines }
}
