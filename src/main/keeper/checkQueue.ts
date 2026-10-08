// The memory check list (World Memory Overhaul B3): everything the memory isn't sure about, in one place, so Adam can
// look when he likes (nothing here asks to be done):
// - facts read from the story whose words were edited and that no read has confirmed since (the writer leaves them out
//   meanwhile; the next read without a verdict removes them, with Undo);
// - the memory's guesses: details the AI filled in on an entry it found in the story, with no words behind them (the
//   world builder's drafts on Adam's own entries count as his, so they never appear);
// - scene summaries being brought up to date (the scene changed enough since they were written);
// - quiet notes that one of Adam's own facts is no longer what the scene says.
// Keep is Adam confirming: a fact becomes his and no longer rests on the words (as an Undo of a removal does in part
// A), a guess becomes his, a summary counts as fitting the scene as it is now (it still follows later edits), a note is
// dismissed. Remove takes the fact out. Both hand back what Undo needs. Runs inside the caller's transaction for
// writes. No Electron imports.

import type Database from 'better-sqlite3'
import type { Change, Entry, ID, MemoryCheckFact, MemoryCheckItem, MemoryCheckUndo, Origin, SourceLink } from '@shared/types'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import * as hist from '../db/history'
import * as kdb from '../db/keeper'
import { labeler } from '../memory/line'
import { UserError } from '../util'
import { changeInput, patchFor } from './apply'
import { builderField, changeWords, fieldLabel, fieldValue, guessFields } from './facts'
import { loadShapeSafe } from './places'
import { DUE_SUMMARY_SCENES, memoryNames, sceneSourceHash, summaryDue } from './sceneChange'
import { hashText } from './text'

type DB = Database.Database

const ADAM = { origin: 'adam' as const }

const short = (s: string, max = 160): string => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t
}

function liveChange(db: DB, id: ID): Change | null {
  try {
    return mem.getChange(db, id)
  } catch {
    return null
  }
}

const liveEntry = (db: DB, id: ID): Entry | null => repo.getEntries(db, [id])[0] ?? null

/** Who a field's value comes from (missing keys follow the entry). */
const originOf = (e: Entry, field: string): Origin => e.fieldOrigins?.[field] ?? e.origin

/** The fact a "no longer says this" note is about, from its key ("no-longer:field:<entry>:<field>:…", "no-longer:change:<id>:…"). */
export function noteFact(key: string): { kind: 'field'; entryId: ID; field: string } | { kind: 'change'; changeId: ID } | null {
  const f = key.match(/^no-longer:field:([^:]+):([^:]+):/)
  if (f) return { kind: 'field', entryId: f[1], field: f[2] }
  const c = key.match(/^no-longer:change:([^:]+):/)
  return c ? { kind: 'change', changeId: c[1] } : null
}

const noteKey = (row: kdb.LogRow): string => String((row.undo as { key?: unknown } | null)?.key ?? '')

/** Per world, whether each scene's summary was due, by what that was worked out from (see dueSummaries). */
const dueSeen = new WeakMap<DB, Map<ID, { version: string; due: boolean }>>()

/**
 * Scenes whose summary is being brought up to date, in reading order: of each story, only the last DUE_SUMMARY_SCENES
 * scenes up to its last one with words (those a draft goes on to refresh, engine.ts queueDueSummaries; an older one keeps
 * its summary as it is). The list is read again after every memory change, so a scene's answer is kept until its
 * words, its summary or the memory's names change: a long series isn't hashed through each time.
 */
function dueSummaries(db: DB): ID[] {
  const byStory = new Map<ID, kdb.SceneSummaryState[]>()
  for (const s of kdb.sceneSummaryStates(db)) {
    const list = byStory.get(s.storyId)
    if (list) list.push(s)
    else byStory.set(s.storyId, [s])
  }
  const window: kdb.SceneSummaryState[] = []
  for (const list of byStory.values()) {
    let last = list.length - 1
    while (last >= 0 && list[last].words <= 0) last--
    window.push(...list.slice(Math.max(0, last + 1 - DUE_SUMMARY_SCENES), last + 1).filter((s) => s.textSummary))
  }
  if (!window.length) return []
  const names = memoryNames(db)
  const namesKey = hashText(names.join('\n'))
  const before = dueSeen.get(db)
  const now = new Map<ID, { version: string; due: boolean }>()
  const out: ID[] = []
  for (const s of window) {
    const version = `${s.version}|${namesKey}`
    const known = before?.get(s.sceneId)
    const due = known && known.version === version ? known.due : summaryDue(db, s.sceneId, false, names)
    now.set(s.sceneId, { version, due })
    if (due) out.push(s.sceneId)
  }
  dueSeen.set(db, now)
  return out
}

/** Everything the memory isn't sure about, by group (unconfirmed, guesses, summaries, notes). */
export function listMemoryChecks(db: DB): MemoryCheckItem[] {
  const shape = loadShapeSafe(db)
  const label = shape ? labeler(shape) : null
  const where = (sceneId: ID | null): string => (sceneId && label ? label({ storyId: null, sceneId }) : '')
  const entries = new Map(repo.listEntries(db).map((e) => [e.id, e]))
  const nameOf = (id: ID): string => entries.get(id)?.name ?? 'someone'
  const out: MemoryCheckItem[] = []

  // Facts whose words were edited, not confirmed since: one row per fact, with its first edited words.
  const seen = new Set<string>()
  for (const l of hist.unconfirmedLinks(db)) {
    if (l.factKind === 'change') {
      const key = `change:${l.factId}`
      if (seen.has(key)) continue
      seen.add(key)
      const c = liveChange(db, l.factId)
      const e = c ? entries.get(c.entryId) : undefined
      if (!c || !e || c.origin === 'adam') continue
      out.push({
        key,
        group: 'unconfirmed',
        fact: { kind: 'change', changeId: c.id },
        entryId: e.id,
        entryName: e.name,
        entryKind: e.kind,
        text: short(changeWords(c, nameOf)),
        sceneId: l.sceneId,
        where: where(l.sceneId),
        quote: l.quote,
        paragraphId: l.paragraphId,
        canRemove: true
      })
      continue
    }
    const field = l.field ?? ''
    const key = `field:${l.factId}:${field}`
    if (!field || seen.has(key)) continue
    seen.add(key)
    const e = entries.get(l.factId)
    if (!e || !fieldValue(e, field).trim() || originOf(e, field) === 'adam' || builderField(e, field)) continue
    out.push({
      key,
      group: 'unconfirmed',
      fact: { kind: 'field', entryId: e.id, field },
      entryId: e.id,
      entryName: e.name,
      entryKind: e.kind,
      text: short(`${fieldLabel(e, field)}: ${fieldValue(e, field)}`),
      sceneId: l.sceneId,
      where: where(l.sceneId),
      quote: l.quote,
      paragraphId: l.paragraphId,
      canRemove: true
    })
  }

  // The memory's guesses on entries it found in the story (A4): AI-filled fields with no words behind them.
  const health = hist.factHealth(db)
  for (const e of entries.values()) {
    const guesses = guessFields(e).filter((k) => health.field(e.id, k) === 'unlinked' && fieldValue(e, k).trim())
    if (!guesses.length) continue
    // "Show me" shows where the entry is in the story (the guess itself has no words).
    const found = hist.linksForEntry(db, e.id).find((l) => l.factKind === 'entry' && l.state === 'ok')
    for (const field of guesses) {
      out.push({
        key: `guess:${e.id}:${field}`,
        group: 'guess',
        fact: { kind: 'field', entryId: e.id, field },
        entryId: e.id,
        entryName: e.name,
        entryKind: e.kind,
        text: short(`${fieldLabel(e, field)}: ${fieldValue(e, field)}`),
        sceneId: found?.sceneId ?? e.originSceneId ?? null,
        where: where(found?.sceneId ?? e.originSceneId ?? null),
        quote: found?.quote ?? '',
        paragraphId: found?.paragraphId ?? null,
        canRemove: true
      })
    }
  }

  // Scene summaries being brought up to date (A3): only those a draft would bring up to date.
  for (const sceneId of dueSummaries(db)) {
    const row = kdb.summaryRow(db, 'scene', sceneId)
    if (!row?.text.trim()) continue
    out.push({
      key: `summary:${sceneId}`,
      group: 'summary',
      fact: { kind: 'summary', sceneId },
      entryId: null,
      entryName: '',
      entryKind: null,
      text: short(row.text, 240),
      sceneId,
      where: where(sceneId),
      quote: '',
      paragraphId: null,
      canRemove: false
    })
  }

  // Quiet notes about Adam's own facts, while their fact is still there.
  for (const row of kdb.openNoLongerNotes(db)) {
    const fact = noteFact(noteKey(row))
    if (!fact) continue
    const e = fact.kind === 'field' ? entries.get(fact.entryId) : entries.get(liveChange(db, fact.changeId)?.entryId ?? '')
    if (!e) continue
    out.push({
      key: `note:${row.id}`,
      group: 'note',
      fact: { kind: 'note', logId: row.id },
      entryId: e.id,
      entryName: e.name,
      entryKind: e.kind,
      text: row.text,
      sceneId: row.sceneId,
      where: where(row.sceneId),
      quote: row.quote,
      paragraphId: null,
      canRemove: true
    })
  }
  return out
}

// ---------- Keep, Remove and Undo ----------

type Step =
  | { op: 'change-origin'; changeId: ID; origin: Origin; links: SourceLink[] }
  | { op: 'field-origin'; entryId: ID; field: string; origin: Origin | null; links: SourceLink[] }
  | { op: 'summary'; sceneId: ID; sourceHash: string; stale: boolean }
  | { op: 'note'; logId: ID }
  | { op: 'change-removed'; changeId: ID }
  | { op: 'field-removed'; entryId: ID; field: string; value: string; origin: Origin | null; links: SourceLink[] }

const fieldLinks = (db: DB, entryId: ID, field: string): SourceLink[] =>
  hist.linksForEntry(db, entryId).filter((l) => hist.isFieldLink(l, field))

function keepOne(db: DB, fact: MemoryCheckFact): Step[] {
  switch (fact.kind) {
    case 'change': {
      const c = liveChange(db, fact.changeId)
      if (!c) return []
      const links = hist.linksForFact(db, 'change', c.id)
      if (c.origin !== 'adam') mem.replaceChange(db, c.id, { ...changeInput(c, c), origin: 'adam' })
      for (const l of links) hist.deleteLink(db, l.id)
      return [{ op: 'change-origin', changeId: c.id, origin: c.origin, links }]
    }
    case 'field': {
      const e = liveEntry(db, fact.entryId)
      if (!e) return []
      const links = fieldLinks(db, e.id, fact.field)
      const before = e.fieldOrigins?.[fact.field] ?? null
      kdb.setFieldOrigins(db, e.id, { [fact.field]: 'adam' })
      for (const l of links) hist.deleteLink(db, l.id)
      hist.recordVersion(db, { factKind: 'entry', factId: e.id, entryId: e.id, data: repo.getEntry(db, e.id), origin: 'adam' })
      return [{ op: 'field-origin', entryId: e.id, field: fact.field, origin: before, links }]
    }
    case 'summary': {
      const row = kdb.summaryRow(db, 'scene', fact.sceneId)
      const scene = kdb.keeperScene(db, fact.sceneId)
      if (!row || !scene || row.origin === 'adam') return []
      kdb.setSummarySourceHash(db, 'scene', fact.sceneId, sceneSourceHash(scene.text, scene.doc))
      return [{ op: 'summary', sceneId: fact.sceneId, sourceHash: row.sourceHash, stale: row.stale }]
    }
    case 'note': {
      const row = kdb.getLog(db, fact.logId)
      if (!row || row.undone) return []
      kdb.markUndone(db, row.id)
      return [{ op: 'note', logId: row.id }]
    }
  }
}

/** Keep: Adam confirms what the memory wasn't sure of (see the top of this file). */
export function keepMemoryCheck(db: DB, fact: MemoryCheckFact): MemoryCheckUndo {
  return { steps: keepOne(db, fact) }
}

/** "Keep all" for a group. */
export function keepMemoryChecks(db: DB, facts: MemoryCheckFact[]): MemoryCheckUndo {
  return { steps: facts.flatMap((f) => keepOne(db, f)) }
}

function removeFact(db: DB, fact: { kind: 'field'; entryId: ID; field: string } | { kind: 'change'; changeId: ID }): Step[] {
  if (fact.kind === 'change') {
    if (!liveChange(db, fact.changeId)) return []
    mem.deleteChange(db, fact.changeId, ADAM)
    return [{ op: 'change-removed', changeId: fact.changeId }]
  }
  const e = liveEntry(db, fact.entryId)
  if (!e) return []
  const value = fieldValue(e, fact.field)
  const origin = e.fieldOrigins?.[fact.field] ?? null
  const links = fieldLinks(db, e.id, fact.field)
  // Cleared by Adam: the memory won't fill it in again by itself.
  repo.updateEntry(db, e.id, patchFor(e, fact.field, ''), ADAM)
  for (const l of links) hist.deleteLink(db, l.id)
  return [{ op: 'field-removed', entryId: e.id, field: fact.field, value, origin, links }]
}

/** Remove: takes the fact out of the memory (for a note, Adam's own fact, and the note goes too). */
export function removeMemoryCheck(db: DB, fact: MemoryCheckFact): MemoryCheckUndo {
  if (fact.kind === 'summary') throw new UserError("A scene's summary can't be removed here. Keep it, or edit it on the scene card.")
  if (fact.kind !== 'note') return { steps: removeFact(db, fact) }
  const row = kdb.getLog(db, fact.logId)
  const about = row ? noteFact(noteKey(row)) : null
  if (!row || !about) return { steps: [] }
  return { steps: [...keepOne(db, fact), ...removeFact(db, about)] }
}

function undoStep(db: DB, s: Step): void {
  switch (s.op) {
    case 'change-origin': {
      const c = liveChange(db, s.changeId)
      if (c && c.origin !== s.origin) mem.replaceChange(db, c.id, { ...changeInput(c, c), origin: s.origin })
      for (const l of s.links) hist.putLinkBack(db, l)
      return
    }
    case 'field-origin':
      if (!liveEntry(db, s.entryId)) return
      kdb.setFieldOrigins(db, s.entryId, { [s.field]: s.origin })
      for (const l of s.links) hist.putLinkBack(db, l)
      return
    case 'summary':
      if (!kdb.summaryRow(db, 'scene', s.sceneId)) return
      kdb.setSummarySourceHash(db, 'scene', s.sceneId, s.sourceHash)
      if (s.stale) kdb.markTextSummaryStale(db, 'scene', s.sceneId)
      return
    case 'note':
      kdb.markNotUndone(db, s.logId)
      return
    case 'change-removed':
      if (liveChange(db, s.changeId)) return
      try {
        mem.restoreChange(db, s.changeId, ADAM)
      } catch {
        /* deleted for good since: nothing to bring back */
      }
      return
    case 'field-removed': {
      const e = liveEntry(db, s.entryId)
      if (!e) return
      repo.updateEntry(db, e.id, patchFor(e, s.field, s.value), { origin: s.origin ?? e.origin })
      kdb.setFieldOrigins(db, e.id, { [s.field]: s.origin })
      for (const l of s.links) hist.putLinkBack(db, l)
      return
    }
  }
}

/** Undoes a Keep or a Remove, last step first. */
export function undoMemoryCheck(db: DB, undo: MemoryCheckUndo): void {
  const steps = (Array.isArray(undo?.steps) ? undo.steps : []) as Step[]
  for (const s of [...steps].reverse()) undoStep(db, s)
}
