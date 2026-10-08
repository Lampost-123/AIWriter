// Scenes deleted and brought back from the Trash. Deleting a scene (or its chapter or story) takes
// away the words of every fact read from it: a fact goes when those were its last words, and a text
// entry nothing mentions any more moves to the Trash, as a run listed in What changed ("those words
// were deleted with the scene"). Adam's own facts stay, with a question-marked line. Bringing the
// scene back undoes that run, and the links go back to their words. Hand edits that clear a field
// the keeper read stop it being read again from the same words. No Electron imports.

import type Database from 'better-sqlite3'
import type { Entry, ID } from '@shared/types'
import * as kdb from '../db/keeper'
import * as hist from '../db/history'
import * as repo from '../db/repo'
import { applyRead, type Undo } from './apply'
import { fieldOrigin, fieldValue, fingerprint } from './facts'
import { plain } from './text'
import { planRead } from './track'
import { undoItem } from './undo'

type DB = Database.Database

const NO_TOTALS: kdb.RunTotals = {
  providerId: null,
  modelId: null,
  promptTokens: null,
  completionTokens: null,
  cost: null,
  generationIds: []
}

export interface ScenesOutcome {
  /** Scenes whose facts changed. */
  sceneIds: ID[]
  /** Entries whose memory changed. */
  entryIds: ID[]
}

/**
 * After a scene, chapter or story is deleted (or emptied from the Trash): every deleted scene whose
 * words still count loses them. Runs inside the caller's transaction.
 */
export function removeScenes(db: DB): ScenesOutcome {
  const out: ScenesOutcome = { sceneIds: [], entryIds: [] }
  for (const sceneId of kdb.removedScenesWithLinks(db)) {
    const scene = kdb.anyKeeperScene(db, sceneId) ?? {
      sceneId,
      chapterId: '',
      storyId: '',
      title: '',
      status: 'planned',
      text: '',
      doc: null,
      textVersion: 0,
      memoryVersion: 0,
      read: [],
      memoryState: 'current',
      memoryError: null,
      acceptedAt: null
    }
    // Read as if it were empty: every word in it is gone.
    const plan = planRead(db, { ...scene, text: '', doc: null })
    if (!plan.moves.length) continue
    const runId = kdb.startRun(db, sceneId, scene.textVersion)
    const result = applyRead(db, { runId, memory: null, shape: null, sideClashes: null, removed: true }, plan, [])
    kdb.finishRun(db, runId, 'removed', null, NO_TOTALS)
    out.sceneIds.push(sceneId)
    out.entryIds.push(...result.entryIds)
  }
  return out
}

/** True when undoing this line would write over a field Adam has typed in since. */
function overAdam(db: DB, u: Undo | null): boolean {
  if (u?.op !== 'field-set' && u?.op !== 'voice-removed') return false
  const field = u.op === 'field-set' ? u.field : 'sampleLines'
  return repo.getEntries(db, [u.entryId])[0]?.fieldOrigins?.[field] === 'adam'
}

/**
 * After something is brought back from the Trash: each scene whose facts went with it gets them back
 * (that run is undone), and the links go back to their words. Returns the scenes, for the keeper to
 * read anything in them it hasn't read yet. Runs inside the caller's transaction.
 */
export function restoreScenes(db: DB): ScenesOutcome {
  const out: ScenesOutcome = { sceneIds: [], entryIds: [] }
  const back = kdb.scenesBackFromTrash(db)
  // Newest first, across all the scenes coming back: an entry one scene's run moved to the Trash
  // comes back before another scene's links to it are looked for.
  for (const runId of kdb.removalRuns(db, back)) {
    for (const l of kdb.logForRun(db, runId).reverse()) {
      if (l.undone || overAdam(db, l.undo as Undo | null)) continue
      out.entryIds.push(...undoItem(db, l.id, { keepLinks: true }).entryIds)
    }
    kdb.setRunStatus(db, runId, 'restored')
  }
  for (const sceneId of back) {
    const scene = kdb.keeperScene(db, sceneId)
    if (!scene) continue
    for (const m of planRead(db, scene).moves) {
      if (m.to) hist.updateLink(db, m.link.id, { ...m.to, sceneVersion: scene.textVersion, state: 'ok' })
    }
    out.sceneIds.push(sceneId)
  }
  return out
}

/**
 * Adam emptied fields the keeper had read from the text: those words don't fill them again (as after
 * an undo), and no longer count as their source. New words can. Runs inside the caller's transaction.
 */
export function fieldsClearedByHand(db: DB, before: Entry, after: Entry): void {
  for (const l of hist.linksForEntry(db, before.id)) {
    if ((l.factKind !== 'field' && l.factKind !== 'voice' && l.factKind !== 'summary') || !l.field) continue
    if (!fieldValue(before, l.field).trim() || fieldValue(after, l.field).trim()) continue
    if (fieldOrigin(before, l.field) === 'adam') continue
    const fp =
      l.factKind === 'voice'
        ? fingerprint({ type: 'voice', entryId: before.id })
        : fingerprint({ type: 'field', entryId: before.id, field: l.field })
    kdb.addSuppression(db, fp, l.sceneId, plain(l.quote))
    hist.deleteLink(db, l.id)
  }
}
