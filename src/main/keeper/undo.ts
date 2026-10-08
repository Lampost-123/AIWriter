// Undo and answers for the "What changed" list. Undo restores what was there before the line's
// change and records a suppression, so a later run doesn't make the same change again from the same
// words (unless they change). Answering a question-marked line applies the chosen option, and can be
// changed any time. Runs inside a transaction (the caller's). No Electron imports.

import type Database from 'better-sqlite3'
import type { Change, ChangeData, Entry, ID, Origin, Summary } from '@shared/types'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import * as hist from '../db/history'
import * as kdb from '../db/keeper'
import type { LogRow } from '../db/keeper'
import { UserError } from '../util'
import { changeInput, MAX_SAMPLE_LINES, patchFor, sampleLines, type FieldUndo, type Undo } from './apply'
import { fieldValue } from './facts'
import { suppressSummary } from './summaries'
import { findQuote, plain, sceneParagraphs } from './text'
import { spotIn, type Spot } from './track'
import { answerFlowLine, isFlowLine, undoFlowLine } from '../storyFlows/lines'
import { isWorldLine, undoWorldLine } from '../worldBuilder/lines'

type DB = Database.Database

export interface Outcome {
  sceneId: ID | null
  entryIds: ID[]
  /** A scene whose summary Adam asked to have written again (done by the keeper, after this returns). */
  writeSummary?: { sceneId: ID; logId: ID }
}

const ADAM = { origin: 'adam' as const }

function line(db: DB, id: ID): LogRow & { u: Undo | null } {
  const l = kdb.getLog(db, id)
  if (!l) throw new UserError('That change could not be found. It may belong to another world.')
  return { ...l, u: l.undo as Undo | null }
}

const live = (db: DB, id: ID): Entry | null => repo.getEntries(db, [id])[0] ?? null

function liveChange(db: DB, id: ID): Change | null {
  try {
    return mem.getChange(db, id)
  } catch {
    return null
  }
}

/** Who wrote the version before the latest one of a fact. */
function earlierOrigin(db: DB, factKind: 'entry' | 'change', id: ID): Origin {
  const v = kdb.latestVersion(db, factKind, id)
  return kdb.versionData(db, factKind, id, v - 1)?.origin ?? 'text'
}

function deleteLinks(db: DB, ids: ID[]): void {
  for (const id of ids) hist.deleteLink(db, id)
}

/**
 * Forgets a fact's links whose words were edited or deleted. A fact Undo brings back no longer rests on those words
 * (it is Adam's to keep): left 'gone' or 'changed', the writer would leave it out as unsure and a later read could take
 * it away again.
 */
function dropLostLinks(db: DB, links: { id: ID; state: string }[]): void {
  deleteLinks(
    db,
    links.filter((l) => l.state !== 'ok').map((l) => l.id)
  )
}

/** Puts a field back as it was, and who it came from. */
function restoreField(db: DB, u: FieldUndo, keepLinks = false): void {
  const e = live(db, u.entryId)
  if (!e) return
  if (fieldValue(e, u.field) !== u.before)
    repo.updateEntry(db, e.id, patchFor(e, u.field, u.before), { origin: u.beforeOrigin ?? e.origin })
  kdb.setFieldOrigins(db, e.id, { [u.field]: u.beforeOrigin })
  deleteLinks(db, u.linkIds)
  // A value brought back (a removal undone) no longer rests on words that were edited or deleted.
  if (u.before.trim() && !keepLinks) dropLostLinks(db, hist.linksForEntry(db, e.id).filter((l) => hist.isFieldLink(l, u.field)))
}

// ---------- "First seen elsewhere" ----------

type FirstSeen = Extract<Undo, { op: 'first-seen' }>

/** Where this scene mentions the entry, for a link to a new one. */
function mentionSpot(db: DB, sceneId: ID, quote: string): Spot | null {
  const s = kdb.keeperScene(db, sceneId)
  if (!s || !quote) return null
  for (const p of sceneParagraphs(s.doc, s.text)) {
    const r = findQuote(p.text, quote)
    if (r) return { ...spotIn(p, r), quote: p.text.slice(r.start, r.end) }
  }
  return null
}

/** Moves this scene's text changes (and the mention) from one entry to another. */
function moveSceneFacts(db: DB, sceneId: ID, from: ID, to: ID): void {
  for (const c of mem.changesInScene(db, sceneId)) {
    if (c.origin !== 'text') continue
    if (c.entryId === from) mem.replaceChange(db, c.id, { ...changeInput(c, c), entryId: to, origin: 'text' })
    else if (c.kind === 'relationship' && c.payload.otherId === from) {
      mem.replaceChange(db, c.id, { ...changeInput(c, { kind: 'relationship', payload: { ...c.payload, otherId: to } }), origin: 'text' })
    }
  }
}

/** Back to the default: the scene's mention is the existing entry, which first exists here. */
function backToLink(db: DB, u: FirstSeen): FirstSeen {
  const next = { ...u }
  if (u.newEntryId) {
    moveSceneFacts(db, u.sceneId, u.newEntryId, u.entryId)
    if (live(db, u.newEntryId)) repo.deleteEntry(db, u.newEntryId, ADAM)
    next.newEntryId = null
  }
  if (u.previousEnd && u.sideStoryId) {
    kdb.setSideStoryEnd(db, u.sideStoryId, (u.previousEnd.endAt as 'end' | 'chapter' | null) ?? 'end', u.previousEnd.endRefId)
    next.previousEnd = null
  }
  if (!next.pointId && live(db, u.entryId)) {
    next.pointId = mem.addExistsPoint(db, { entryId: u.entryId, kind: 'scene', storyId: u.storyId, sceneId: u.sceneId, byHand: false }).id
  }
  return next
}

function firstSeenAnswer(db: DB, row: LogRow, u: FirstSeen, to: string): FirstSeen {
  let next = backToLink(db, u)
  if (to === 'new') {
    const old = live(db, u.entryId)
    if (!old) return next
    const made = repo.createEntry(db, old.kind, { name: old.name }, { origin: 'text', originStoryId: u.storyId, originSceneId: u.sceneId })
    const spot = mentionSpot(db, u.sceneId, row.quote)
    if (spot)
      hist.addLink(db, {
        factKind: 'entry',
        factId: made.id,
        field: null,
        sceneId: u.sceneId,
        sceneVersion: kdb.keeperScene(db, u.sceneId)?.textVersion ?? 0,
        ...spot
      })
    moveSceneFacts(db, u.sceneId, u.entryId, made.id)
    if (next.pointId) kdb.deleteDefaultExistsPoint(db, next.pointId)
    next = { ...next, pointId: null, newEntryId: made.id }
  } else if (to === 'end-side' && u.sideStoryId && u.endAfterChapterId) {
    const previousEnd = kdb.setSideStoryEnd(db, u.sideStoryId, 'chapter', u.endAfterChapterId)
    if (next.pointId) kdb.deleteDefaultExistsPoint(db, next.pointId)
    next = { ...next, pointId: null, previousEnd }
  }
  return next
}

// ---------- Refreshing one of Adam's facts from the scene's words ----------

type Refresh = Extract<Undo, { op: 'refresh' }>

function refreshFrom(db: DB, u: Refresh): Refresh {
  if (u.version != null) return u
  const linkPatch = u.spot ? { ...u.spot, sceneVersion: u.sceneVersion, state: 'ok' as const } : null
  if (u.fact.kind === 'field') {
    const e = live(db, u.fact.entryId)
    if (!e) return u
    const version = kdb.latestVersion(db, 'entry', e.id)
    const value = u.proposal && 'value' in u.proposal ? u.proposal.value : ''
    repo.updateEntry(db, e.id, patchFor(e, u.fact.field, value), { origin: 'text' })
    if (linkPatch && u.linkIds[0]) hist.updateLink(db, u.linkIds[0], linkPatch)
    return { ...u, version }
  }
  const c = liveChange(db, u.fact.changeId)
  if (!c) return u
  const version = kdb.latestVersion(db, 'change', c.id)
  if (u.proposal && 'change' in u.proposal) mem.replaceChange(db, c.id, { ...changeInput(c, u.proposal.change), origin: 'text' })
  else mem.deleteChange(db, c.id, ADAM)
  if (linkPatch && u.linkIds[0]) hist.updateLink(db, u.linkIds[0], linkPatch)
  return { ...u, version }
}

function keepMine(db: DB, u: Refresh): Refresh {
  if (u.version == null) return u
  if (u.fact.kind === 'field') {
    const old = kdb.versionData(db, 'entry', u.fact.entryId, u.version)?.data as Entry | null
    const e = live(db, u.fact.entryId)
    if (old && e) {
      repo.updateEntry(db, e.id, patchFor(e, u.fact.field, fieldValue(old, u.fact.field)), ADAM)
      kdb.setFieldOrigins(db, e.id, { [u.fact.field]: old.fieldOrigins?.[u.fact.field] ?? 'adam' })
    }
  } else {
    const old = kdb.versionData(db, 'change', u.fact.changeId, u.version)
    const data = old?.data as Change | null
    if (data) {
      if (!liveChange(db, u.fact.changeId)) mem.restoreChange(db, u.fact.changeId, ADAM)
      mem.replaceChange(db, u.fact.changeId, { ...changeInput(data, data as ChangeData), origin: old!.origin })
    }
  }
  if (u.linkIds[0]) hist.updateLink(db, u.linkIds[0], { state: 'changed' })
  return { ...u, version: null }
}

// ---------- Summaries ----------

function restoreSummary(db: DB, level: Summary['level'], targetId: ID, version: number, fallbackOrigin: Origin): void {
  const old = version > 0 ? kdb.versionData(db, 'summary', `${level}:${targetId}`, version) : null
  const data = old?.data as Summary | null
  if (data && data.text) mem.putSummary(db, { level, targetId, text: data.text, origin: old?.origin ?? fallbackOrigin })
  else kdb.deleteTextSummary(db, level, targetId, 'adam')
}

// ---------- Undo ----------

/**
 * Undoes one line: puts back what was there before, and stops the same change being made again from the same words.
 * `keepLinks`: a fact brought back keeps its links whose words were edited or deleted (a scene back from the Trash: its
 * links go back to their words next, removed.ts); otherwise they are forgotten, so the fact stands for good.
 */
export function undoItem(db: DB, id: ID, opts: { keepLinks?: boolean } = {}): Outcome {
  const row = line(db, id)
  if (isFlowLine(row)) return undoFlowLine(db, row) // a story flow's line (milestone 3)
  if (isWorldLine(row)) return undoWorldLine(db, row) // a world build's line (milestone 4)
  const out: Outcome = { sceneId: row.sceneId, entryIds: row.entryId ? [row.entryId] : [] }
  if (row.undone || row.action === 'failed' || !row.u) return out
  const u = row.u
  switch (u.op) {
    case 'entry-added': {
      const e = live(db, u.entryId)
      // Its own text changes from the same run go with it, and so do relationships with it.
      const sameRun = (c: Change): boolean => c.origin === 'text' && c.runId === row.runId
      const own = [
        ...mem.changesForEntry(db, u.entryId).filter(sameRun),
        ...(row.sceneId ? mem.changesInScene(db, row.sceneId) : []).filter(
          (c) => sameRun(c) && c.kind === 'relationship' && c.payload.otherId === u.entryId
        )
      ]
      const gone = new Set([...own.map((c) => c.id), ...(u.changeIds ?? [])])
      for (const cid of gone) {
        const c = liveChange(db, cid)
        if (!c) continue
        mem.deleteChange(db, cid, ADAM)
        out.entryIds.push(c.entryId)
      }
      // The run's other lines about it are undone with it: there is nothing left for them to undo.
      for (const l of kdb.logForRun(db, row.runId)) {
        if (l.id !== id && !l.undone && ((l.factId && gone.has(l.factId)) || l.entryId === u.entryId)) kdb.markUndone(db, l.id)
      }
      if (e) repo.deleteEntry(db, e.id, ADAM)
      // A plot thread the memory made here leaves the scene card with it (only the memory's own links).
      if (e?.kind === 'thread' && row.sceneId) {
        repo.setAiThreadLink(db, row.sceneId, 'setsUp', e.id, false)
        repo.setAiThreadLink(db, row.sceneId, 'paysOff', e.id, false)
      }
      break
    }
    case 'entry-trashed': {
      kdb.untrashEntry(db, u.entryId, earlierOrigin(db, 'entry', u.entryId))
      for (const cid of u.changeIds) {
        const c = db.prepare('SELECT 1 FROM changes WHERE id = ?').get(cid)
        if (c) mem.restoreChange(db, cid, { origin: earlierOrigin(db, 'change', cid) })
      }
      break
    }
    case 'change-added': {
      if (liveChange(db, u.changeId)) mem.deleteChange(db, u.changeId, ADAM)
      // A plot thread the memory put on the scene card with it comes off too (Adam's own link stays).
      if (u.cardLink) repo.setAiThreadLink(db, u.cardLink.sceneId, u.cardLink.list, u.cardLink.threadId, false)
      deleteLinks(
        db,
        hist.linksForFact(db, 'change', u.changeId).map((l) => l.id)
      )
      break
    }
    case 'change-updated': {
      const old = kdb.versionData(db, 'change', u.changeId, u.version)
      const data = old?.data as Change | null
      if (data && liveChange(db, u.changeId))
        mem.replaceChange(db, u.changeId, { ...changeInput(data, data as ChangeData), origin: old!.origin })
      // The link stays on the words the update was read from: the old fact now rests on them, and isn't updated from
      // them again (the suppression below). Sent back to the old words, which aren't in the scene any more, it would be
      // hidden from the writer as unsure and removed two reads later.
      break
    }
    case 'change-removed': {
      if (!liveChange(db, u.changeId) && db.prepare('SELECT 1 FROM changes WHERE id = ?').get(u.changeId)) {
        mem.restoreChange(db, u.changeId, { origin: earlierOrigin(db, 'change', u.changeId) })
      }
      // Brought back, it no longer rests on the edited or deleted words (it is Adam's to keep).
      deleteLinks(db, u.linkIds ?? [])
      if (!opts.keepLinks) dropLostLinks(db, hist.linksForFact(db, 'change', u.changeId))
      break
    }
    case 'field-set':
      restoreField(db, u, opts.keepLinks)
      break
    case 'voice-added': {
      const e = live(db, u.entryId)
      if (e) {
        const lines = sampleLines(e)
        const keep = lines.filter((l) => plain(l) !== plain(u.line))
        if (keep.length !== lines.length)
          repo.updateEntry(db, e.id, { fields: { ...e.fields, sampleLines: keep.join('\n') } }, { origin: 'text' })
      }
      hist.deleteLink(db, u.linkId)
      break
    }
    case 'voice-removed': {
      const e = live(db, u.entryId)
      if (e) {
        const lines = sampleLines(e)
        if (lines.length < MAX_SAMPLE_LINES && !lines.some((l) => plain(l) === plain(u.line))) {
          repo.updateEntry(db, e.id, { fields: { ...e.fields, sampleLines: [...lines, u.line].join('\n') } }, { origin: 'text' })
        }
      }
      break
    }
    case 'first-seen': {
      const back = backToLink(db, u)
      if (back.pointId) kdb.deleteDefaultExistsPoint(db, back.pointId)
      if (u.linkId) hist.deleteLink(db, u.linkId)
      break
    }
    case 'which-last':
      mem.clearAnswer(db, 'which-last', u.key)
      break
    case 'refresh':
      keepMine(db, u)
      break
    case 'summary':
      restoreSummary(db, u.level, u.targetId, u.version, 'text')
      suppressSummary(db, u.level, u.targetId, u.sourceHash)
      break
    case 'summary-refresh':
      if (u.refreshed) restoreSummary(db, 'scene', u.sceneId, u.version, 'adam')
      break
  }
  if (u.fingerprint && u.words != null && row.sceneId) kdb.addSuppression(db, u.fingerprint, row.sceneId, u.words)
  kdb.markUndone(db, id)
  return out
}

// ---------- Answers ----------

/** Applies the option Adam picked on a question-marked line (he can change it any time). */
export function answerItem(db: DB, id: ID, optionId: string): Outcome {
  const row = line(db, id)
  if (isFlowLine(row)) return answerFlowLine(db, row, optionId) // a story flow's line (milestone 3)
  const out: Outcome = { sceneId: row.sceneId, entryIds: row.entryId ? [row.entryId] : [] }
  if (!row.question) throw new UserError("That line doesn't ask anything.")
  if (!row.question.options.some((o) => o.id === optionId)) throw new UserError("That answer isn't one of the choices.")
  if (row.undone) throw new UserError('That change was undone, so there is nothing to answer.')
  const u = row.u
  let next: Undo | null = u
  if (u?.op === 'first-seen') {
    next = firstSeenAnswer(db, row, u, optionId)
    if (next.op === 'first-seen' && next.newEntryId) out.entryIds.push(next.newEntryId)
  } else if (u?.op === 'which-last') {
    mem.setAnswer(db, 'which-last', u.key, optionId === 'side' ? 'side' : 'host')
    out.sceneId = null // what counts changes across the story
  } else if (u?.op === 'refresh') {
    next = optionId === 'refresh' ? refreshFrom(db, u) : keepMine(db, u)
  } else if (u?.op === 'summary-refresh') {
    if (optionId === 'refresh' && !u.refreshed) out.writeSummary = { sceneId: u.sceneId, logId: id }
    else if (optionId === 'keep' && u.refreshed) {
      restoreSummary(db, 'scene', u.sceneId, u.version, 'adam')
      next = { ...u, refreshed: false }
    }
  }
  kdb.setLogQuestion(db, id, { ...row.question, answer: optionId }, next as unknown as Record<string, unknown> | null)
  return out
}

/** After "Write a new one": the new summary is written, so "Keep mine" can bring Adam's back. */
export function summaryRefreshed(db: DB, logId: ID): void {
  const row = kdb.getLog(db, logId)
  const u = row?.undo as Undo | null
  if (!row || u?.op !== 'summary-refresh') return
  kdb.setLogQuestion(db, logId, row.question, { ...u, refreshed: true } as unknown as Record<string, unknown>)
}
