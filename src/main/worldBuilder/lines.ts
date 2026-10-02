// A build's lines in What changed: what undoing each needs (kept with the line), Undo one line at a time
// (What changed) or the whole build at once (its results page), bringing a whole build back (the Undo on
// that), and what a build made, read back from its lines for the results page. Undo takes away exactly
// what the line added. Undoing one line leaves a suppression, so building again from the same words
// doesn't add it again; undoing the whole build leaves none, so building again adds it all. Runs inside a
// transaction (the caller's). No Electron imports.

import type Database from 'better-sqlite3'
import type { EntryKind, ID } from '@shared/types'
import type { WorldBuildItem } from '@shared/contracts/worldBuilder'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import * as kdb from '../db/keeper'
import type { LogRow } from '../db/keeper'
import { anyChange } from '../db/storyFlows'
import { BUILD_RUN_SCENE, buildLines, entryNamed, entryNames, entryState, markNotUndone } from '../db/worldBuilder'
import { upperFirst } from '../keeper/text'
import { UserError } from '../util'
import { findMatch } from './names'

type DB = Database.Database

/**
 * What undoing a build's line needs. `op` comes first, so the lines can be found by it. `fingerprint` and
 * `words` are what a suppression keeps once the line is undone: what was added, and the summary's words
 * it came from (a hash of them).
 */
export type WorldUndo = { op: 'world-build'; fingerprint: string; words: string } & (
  | {
      /** A new entry, and the changes made with it: an event's people, a plot thread opened at the start. */
      did: 'entry'
      entryId: ID
      kind: EntryKind
      /** The name the summary gave it, so building again knows it when its profile named it otherwise. */
      planned: string
      /** Lore made as a rule never to break. */
      rule: boolean
      changeIds: ID[]
    }
  | {
      /** A relationship between two entries, recorded on the first. */
      did: 'relationship'
      changeId: ID
      fromId: ID
      toId: ID
      /** The two names when it was made, for when an entry is gone since. */
      names: [string, string]
      type: string
    }
  | {
      /** The world's themes or tone, filled while empty. */
      did: 'meta'
      key: 'themes' | 'tone'
      before: string
      after: string
    }
)

/** The same as Outcome in keeper/undo.ts: what the memory:changed event says. */
export interface WorldOutcome {
  sceneId: ID | null
  entryIds: ID[]
}

export const isWorldUndo = (u: unknown): u is WorldUndo => !!u && typeof u === 'object' && (u as { op?: unknown }).op === 'world-build'

/** True for a line a build wrote. */
export const isWorldLine = (row: Pick<LogRow, 'undo'>): boolean => isWorldUndo(row.undo)

const ADAM = { origin: 'adam' as const }

/** Deletes one of the build's changes. False when it was gone already. */
function removeChange(db: DB, id: ID, out: WorldOutcome): boolean {
  const at = anyChange(db, id)
  if (!at || at.deleted) return false
  const c = mem.getChange(db, id)
  mem.deleteChange(db, id, ADAM)
  out.entryIds.push(...mem.entriesTouched(c))
  return true
}

/**
 * Takes away what one line added (and, for an entry, the build's relationships with it, whose lines are
 * undone with it). False when what it added was gone already (Adam deleted or changed it since), so
 * bringing the build back doesn't bring that back either.
 */
function takeAway(db: DB, row: LogRow, u: WorldUndo, out: WorldOutcome): boolean {
  switch (u.did) {
    case 'entry': {
      const live = entryState(db, u.entryId) === 'live'
      for (const id of u.changeIds) removeChange(db, id, out)
      for (const l of kdb.logForRun(db, row.runId)) {
        const lu = l.undo
        if (l.id === row.id || l.undone || !isWorldUndo(lu) || lu.did !== 'relationship') continue
        if (lu.fromId !== u.entryId && lu.toId !== u.entryId) continue
        removeChange(db, lu.changeId, out)
        kdb.markUndone(db, l.id)
      }
      if (live) repo.deleteEntry(db, u.entryId, ADAM)
      out.entryIds.push(u.entryId)
      return live
    }
    case 'relationship':
      return removeChange(db, u.changeId, out)
    case 'meta':
      // Back to empty, unless it has been changed since.
      if ((repo.getMeta(db, u.key) ?? '') !== u.after) return false
      repo.setMeta(db, u.key, u.before)
      return true
  }
}

/** Undoes one of a build's lines (from What changed): building again from the same words won't add it again. */
export function undoWorldLine(db: DB, row: LogRow): WorldOutcome {
  const out: WorldOutcome = { sceneId: null, entryIds: row.entryId ? [row.entryId] : [] }
  const u = row.undo
  if (row.undone || !isWorldUndo(u)) return out
  takeAway(db, row, u, out)
  kdb.addSuppression(db, u.fingerprint, BUILD_RUN_SCENE, u.words)
  kdb.markUndone(db, row.id)
  return out
}

/** The lines of a build's run, or a plain-words error when it isn't one. */
function runLines(db: DB, runId: ID): (LogRow & { undo: WorldUndo })[] {
  const lines = kdb.logForRun(db, runId).filter((l): l is LogRow & { undo: WorldUndo } => isWorldUndo(l.undo))
  if (!lines.length) throw new UserError('That build could not be found. It may belong to another world.')
  return lines
}

/** Undoes everything a build made that is still there, newest first. Returns the lines it undid, and the entries touched. */
export function undoBuild(db: DB, runId: ID): WorldOutcome & { lineIds: ID[] } {
  const out = { sceneId: null, entryIds: [] as ID[], lineIds: [] as ID[] }
  for (const l of runLines(db, runId).reverse()) {
    // An entry's line undoes the build's relationships with it, so each line is read as it is now.
    const now = kdb.getLog(db, l.id)
    if (!now || now.undone) continue
    const took = takeAway(db, now, l.undo, out)
    kdb.markUndone(db, l.id)
    // Only what this Undo took away comes back with the Undo on it: never a page Adam had deleted himself.
    if (took) out.lineIds.push(l.id)
  }
  return out
}

/**
 * Brings back what undoBuild took away (only those lines, and only what is still as the undo left it),
 * oldest first. Never a second of anything: an entry the world has again since (made by a newer build, or
 * by Adam) stays undone, and so do the world's themes or tone once something else fills them.
 */
export function redoBuild(db: DB, runId: ID, lineIds: ID[]): WorldOutcome {
  const out: WorldOutcome = { sceneId: null, entryIds: [] }
  const want = new Set(lineIds)
  const restore = (id: ID): void => {
    const at = anyChange(db, id)
    if (!at?.deleted) return
    mem.restoreChange(db, id, { origin: 'ai' })
    out.entryIds.push(...mem.entriesTouched(mem.getChange(db, id)))
  }
  for (const l of runLines(db, runId)) {
    if (!want.has(l.id) || !l.undone) continue
    const u = l.undo
    if (u.did === 'entry') {
      if (entryState(db, u.entryId) === 'deleted') {
        const self = entryNamed(db, u.entryId)
        if (self && findMatch(self, entryNames(db))) continue
        kdb.untrashEntry(db, u.entryId, 'adam')
      }
      if (entryState(db, u.entryId) !== 'live') continue
      for (const id of u.changeIds) restore(id)
      out.entryIds.push(u.entryId)
    } else if (u.did === 'relationship') {
      if (entryState(db, u.fromId) !== 'live' || entryState(db, u.toId) !== 'live') continue
      restore(u.changeId)
    } else {
      if ((repo.getMeta(db, u.key) ?? '') !== u.before) continue
      repo.setMeta(db, u.key, u.after)
    }
    markNotUndone(db, l.id)
  }
  return out
}

// ---------- What a build made, for its results page ----------

/** "Younger brother: Mara Venn", as What changed words a relationship. */
export const relationshipWords = (type: string, other: string): string => `${upperFirst(type.trim() || 'linked')}: ${other}`

/** Everything a build made, in the order it was made, as it is now: undone (or deleted since) or not. */
export function madeItems(db: DB, runId: ID): WorldBuildItem[] {
  const names = new Map<ID, string>()
  const nameOf = (id: ID, fallback: string): string => {
    if (!names.has(id)) names.set(id, repo.getEntries(db, [id])[0]?.name ?? fallback)
    return names.get(id) ?? fallback
  }
  return kdb.logForRun(db, runId).flatMap((l): WorldBuildItem[] => {
    const u = l.undo
    if (!isWorldUndo(u)) return []
    const base = { lineId: l.id, otherId: null, hardRule: false }
    if (u.did === 'entry') {
      const e = repo.getEntries(db, [u.entryId])[0] ?? null
      return [
        {
          ...base,
          what: 'entry',
          entryId: u.entryId,
          kind: u.kind,
          name: e?.name ?? l.entryName,
          detail: e ? e.summary : l.after,
          hardRule: u.rule,
          undone: l.undone || !e
        }
      ]
    }
    if (u.did === 'relationship') {
      const at = anyChange(db, u.changeId)
      return [
        {
          ...base,
          what: 'relationship',
          entryId: u.fromId,
          kind: null,
          name: nameOf(u.fromId, u.names[0]),
          detail: relationshipWords(u.type, nameOf(u.toId, u.names[1])),
          otherId: u.toId,
          undone: l.undone || !at || at.deleted
        }
      ]
    }
    return [
      { ...base, what: u.key, entryId: null, kind: null, name: u.key === 'themes' ? 'Themes' : 'Tone', detail: u.after, undone: l.undone }
    ]
  })
}

/**
 * What earlier builds tell a new one. `blocked`: what not to add again, each as its fingerprint and the
 * summary's words it came from: lines undone one at a time (in What changed), which leave a suppression,
 * and entries a build made that Adam has deleted since. Lines undone with their whole build leave none, so
 * building again adds them back. `planned`: the live entries builds made, under the names the summary
 * gave them, so building again finds them even when their profiles named them otherwise.
 */
export function earlierBuilds(db: DB): { blocked: Set<string>; planned: { id: ID; kind: EntryKind; name: string; aliases: string[] }[] } {
  const blocked = new Set(kdb.suppressionsInScene(db, BUILD_RUN_SCENE).map((s) => `${s.fingerprint}\n${s.words}`))
  const planned: { id: ID; kind: EntryKind; name: string; aliases: string[] }[] = []
  for (const l of buildLines(db)) {
    const u = l.undo
    if (!isWorldUndo(u) || u.did !== 'entry') continue
    const state = entryState(db, u.entryId)
    if (state === 'live') planned.push({ id: u.entryId, kind: u.kind, name: u.planned ?? '', aliases: [] })
    else if (!l.undone) blocked.add(`${u.fingerprint}\n${u.words}`)
  }
  return { blocked, planned }
}
