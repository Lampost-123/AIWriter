// Tidying an existing world's memory once (World Memory Overhaul A7, 2026-10-08), the first time it opens with this
// version: every source link is checked against the scene's words as they are now, with no call to the memory model.
// Words that are gone take their text facts with them (by the usual rules, each with Undo in What changed; what Adam
// made himself is never touched); the scenes of facts whose words were edited are read again once, to ask about them; a
// scene summary the scene has outgrown is marked stale, so the writer is told it is being updated and it is refreshed
// when a draft needs it. One line in What changed says what was done. No Electron imports.

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

/** Tidies the memory against the text as it is now (call inside a transaction). */
export function tidyMemory(db: DB): TidyResult {
  const out: TidyResult = { removed: 0, recheck: 0, scenes: 0, summaries: 0 }
  let runId: ID | null = null
  const sceneIds = (db.prepare('SELECT DISTINCT scene_id AS id FROM source_links').all() as { id: string }[]).map((r) => r.id)
  for (const sceneId of sceneIds) {
    const scene = kdb.keeperScene(db, sceneId)
    if (!scene) continue // deleted scenes are seen to when they are deleted (removed.ts)
    const plan = planRead(db, scene)
    if (plan.moves.length || plan.atRisk.length) {
      runId ??= kdb.startRun(db, sceneId, scene.textVersion)
      const before = kdb.logForRun(db, runId).length
      applyRead(db, { runId, memory: null, shape: null, sideClashes: null, sweep: true }, plan, [])
      out.removed += kdb.logForRun(db, runId).slice(before).length
      out.recheck += plan.atRisk.length
    }
    // Words edited under a fact: the scene is read again, once, to ask about it. (Nothing else is queued, so the tidy
    // never sets off a read of every scene.)
    if (plan.atRisk.length) {
      kdb.noteSceneSaved(db, sceneId)
      out.scenes++
    }
  }
  const names = memoryNames(db)
  const summarised = (db.prepare("SELECT target_id AS id FROM summaries WHERE level = 'scene' AND origin <> 'adam' AND stale = 0").all() as {
    id: string
  }[]).map((r) => r.id)
  for (const id of summarised) {
    if (!summaryDue(db, id, false, names)) continue
    kdb.markTextSummaryStale(db, 'scene', id)
    out.summaries++
  }
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

/** Tidies the memory if this world's hasn't been yet. True when something changed. */
export function tidyOnce(db: DB): boolean {
  if (repo.getMeta(db, TIDY_KEY)) return false
  return db.transaction(() => {
    const r = tidyMemory(db)
    repo.setMeta(db, TIDY_KEY, new Date().toISOString())
    return r.removed > 0 || r.recheck > 0 || r.scenes > 0 || r.summaries > 0
  })()
}
