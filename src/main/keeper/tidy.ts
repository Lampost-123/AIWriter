// Tidying an existing world's memory once (World Memory Overhaul A7, 2026-10-08), the first time it opens with this
// version: every source link is checked against the scene's words as they are now, with no call to the memory model.
// Words that are gone take their text facts with them (by the usual rules, each with Undo in What changed; what Adam
// made himself is never touched); the scenes of facts whose words were edited are read again once, to ask about them; a
// scene summary the scene has outgrown is marked stale, so the writer is told it is being updated and it is refreshed
// when a draft needs it. One line in What changed says what was done. A big world is tidied a few scenes at a time
// (tidyOnce), letting the app get on with other work in between, so opening it doesn't freeze. No Electron imports.

import type Database from 'better-sqlite3'
import type { ID } from '@shared/types'
import * as kdb from '../db/keeper'
import * as repo from '../db/repo'
import { applyRead } from './apply'
import { planRead } from './track'
import { memoryNames, summaryDue } from './sceneChange'

type DB = Database.Database

/** Set in the world's meta table once its memory has been tidied. */
export const TIDY_KEY = 'memory_tidy'

/** How many scenes (or scene summaries) tidyOnce looks at in one go before letting other work in. */
export const TIDY_BATCH = 25

const NO_TOTALS: kdb.RunTotals = { providerId: null, modelId: null, promptTokens: null, completionTokens: null, cost: null, generationIds: [] }

export interface TidyResult {
  /** Facts and entries taken away (each a line with Undo). */
  removed: number
  /** Facts whose words were edited: asked about again when their scene is next read. */
  recheck: number
  /** Scenes queued to be read again. */
  scenes: number
  /** Scene summaries marked stale. */
  summaries: number
}

/** A tidy-up under way: what is left to look at, and what it has done so far. */
interface Tidy {
  out: TidyResult
  runId: ID | null
  sceneIds: ID[]
  summaryIds: ID[]
  names: string[] | null
}

function beginTidy(db: DB): Tidy {
  const sceneIds = (db.prepare('SELECT DISTINCT scene_id AS id FROM source_links').all() as { id: string }[]).map((r) => r.id)
  return { out: { removed: 0, recheck: 0, scenes: 0, summaries: 0 }, runId: null, sceneIds, summaryIds: [], names: null }
}

/** Checks one scene's links against its words. */
function tidyScene(db: DB, t: Tidy, sceneId: ID): void {
  const scene = kdb.keeperScene(db, sceneId)
  if (!scene) return // deleted scenes are seen to when they are deleted (removed.ts)
  const plan = planRead(db, scene)
  if (plan.moves.length || plan.atRisk.length) {
    t.runId ??= kdb.startRun(db, sceneId, scene.textVersion)
    const before = kdb.logForRun(db, t.runId).length
    applyRead(db, { runId: t.runId, memory: null, shape: null, sideClashes: null, sweep: true }, plan, [])
    t.out.removed += kdb.logForRun(db, t.runId).slice(before).length
    t.out.recheck += plan.atRisk.length
  }
  // Words edited under a fact: the scene is read again, once, to ask about it. (Nothing else is queued, so the tidy
  // never sets off a read of every scene.)
  if (plan.atRisk.length) {
    kdb.noteSceneSaved(db, sceneId)
    t.out.scenes++
  }
}

/** The scene summaries to look at, once the facts are tidied (their scenes' words as they are now). */
function listSummaries(db: DB, t: Tidy): void {
  t.names = memoryNames(db)
  t.summaryIds = (db.prepare("SELECT target_id AS id FROM summaries WHERE level = 'scene' AND origin <> 'adam' AND stale = 0").all() as {
    id: string
  }[]).map((r) => r.id)
}

function tidySummary(db: DB, t: Tidy, id: ID): void {
  if (!summaryDue(db, id, false, t.names ?? undefined)) return
  kdb.markTextSummaryStale(db, 'scene', id)
  t.out.summaries++
}

/** The one line in What changed, and the run finished. */
function finishTidy(db: DB, t: Tidy): TidyResult {
  const { out, runId } = t
  if (runId) {
    if (out.removed || out.recheck) {
      kdb.insertLog(db, {
        runId,
        sceneId: null,
        entryName: '',
        text: `Memory tidy-up: ${out.removed} removed, ${out.recheck} to check again`,
        before: '',
        after: '',
        action: 'updated',
        what: 'scene',
        entryId: null,
        factId: null,
        quote: '',
        question: null,
        // Dismissed rather than undone: each removal above has its own Undo.
        undo: { op: 'note', key: `tidy:${runId}` }
      })
    }
    kdb.finishRun(db, runId, 'done', null, NO_TOTALS)
  }
  return out
}

/** Tidies the memory against the text as it is now, all at once (call inside a transaction). */
export function tidyMemory(db: DB): TidyResult {
  const t = beginTidy(db)
  for (const id of t.sceneIds) tidyScene(db, t, id)
  listSummaries(db, t)
  for (const id of t.summaryIds) tidySummary(db, t, id)
  return finishTidy(db, t)
}

const changedSomething = (r: TidyResult): boolean => r.removed > 0 || r.recheck > 0 || r.scenes > 0 || r.summaries > 0

/**
 * Tidies the memory if this world's hasn't been yet. True when something changed. A world with up to `batch` scenes
 * (and summaries) is tidied at once, in one transaction, and the answer is given straight away. A bigger one is tidied
 * `batch` at a time, each in its own transaction, letting other work in between: the answer comes as a promise then
 * (false if `closed` says the world closed first; it is tidied again, from the start, the next time it opens).
 */
export function tidyOnce(db: DB, o: { batch?: number; closed?: () => boolean } = {}): boolean | Promise<boolean> {
  if (repo.getMeta(db, TIDY_KEY)) return false
  const batch = Math.max(1, o.batch ?? TIDY_BATCH)
  const done = (t: Tidy): boolean => {
    const r = finishTidy(db, t)
    repo.setMeta(db, TIDY_KEY, new Date().toISOString())
    return changedSomething(r)
  }
  const t = beginTidy(db)
  const summaryCount = (db.prepare("SELECT COUNT(*) AS n FROM summaries WHERE level = 'scene'").get() as { n: number }).n
  if (t.sceneIds.length <= batch && summaryCount <= batch) {
    return db.transaction(() => {
      for (const id of t.sceneIds) tidyScene(db, t, id)
      listSummaries(db, t)
      for (const id of t.summaryIds) tidySummary(db, t, id)
      return done(t)
    })()
  }
  const gone = (): boolean => !!o.closed?.() || !db.open
  const pause = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))
  return (async () => {
    for (let i = 0; i < t.sceneIds.length; i += batch) {
      if (gone()) return false
      db.transaction(() => {
        for (const id of t.sceneIds.slice(i, i + batch)) tidyScene(db, t, id)
      })()
      await pause()
    }
    if (gone()) return false
    listSummaries(db, t)
    for (let i = 0; i < t.summaryIds.length; i += batch) {
      if (gone()) return false
      db.transaction(() => {
        for (const id of t.summaryIds.slice(i, i + batch)) tidySummary(db, t, id)
      })()
      await pause()
    }
    if (gone()) return false
    return db.transaction(() => done(t))()
  })()
}
