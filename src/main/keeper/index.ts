// The memory keeper (milestone 2) keeps the memory up to date with the text, by itself:
//   engine.ts     when runs happen (quiet timer, leaving a scene, marking it done, app start), one at a time
//   track.ts      what changed since the last read, and where each fact's words are now
//   request.ts    the memory model's reading requests, in chunks that fit its window
//   apply.ts      applying its reply under the origin rules, and the "What changed" lines
//   run.ts        one run for one scene, from plan to apply (or "Memory not updated")
//   summaries.ts  scene summaries and roll-ups
//   undo.ts       Undo and answers on the "What changed" list
// This file connects it to the open world, the settings and the window.

import type Database from 'better-sqlite3'
import type { Entry, ID, MemoryStatus, SceneMeta } from '@shared/types'
import { onWorldClosing, onWorldOpened, maybeCurrentWorld } from '../world'
import { getSettings } from '../settings'
import { getProvider, providerTarget } from '../ai/providers'
import { isLocalUrl, providerWho } from '../ai/errors'
import { setBeforeDraft } from '../ai/gather'
import { emit } from '../events'
import { Keeper, NO_MODEL, idleStatus } from './engine'
import type { MemoryModel } from './model'
import { fieldsClearedByHand, removeScenes, restoreScenes, type ScenesOutcome } from './removed'

let keeper: Keeper | null = null

/** The memory model from Settings (the writer model when none is chosen), or why there is none, in plain words. */
export function memoryModel(): MemoryModel | { error: string } {
  const s = getSettings()
  const choice = s.models.memory ?? s.models.writer
  if (!choice) return { error: NO_MODEL }
  const provider = getProvider(choice.providerId)
  if (!provider) {
    return {
      error: s.models.memory
        ? "The memory keeper's model came from a provider that has been removed. Pick another model for the memory keeper in Settings > Models."
        : "The writer model's provider has been removed. Choose a writer model in Settings > Models to keep the memory up to date."
    }
  }
  const target = providerTarget(provider)
  if (!target.apiKey && !(provider.kind === 'custom' && isLocalUrl(provider.baseUrl))) {
    return { error: `${providerWho(provider)} needs an API key for the memory to keep up. Add it in Settings > Models.` }
  }
  return { target, choice }
}

const quietMs = (): number | undefined => {
  const v = Number(process.env.AIWRITE_KEEPER_QUIET_MS)
  return Number.isFinite(v) && v > 0 ? v : undefined
}

export function initKeeper(): void {
  onWorldOpened((w) => {
    keeper?.stop()
    // Scenes deleted while the keeper wasn't told (or emptied from the Trash) stop counting first.
    scenesDeleted(w.db)
    keeper = new Keeper({
      db: w.db,
      model: memoryModel,
      emitStatus: (s) => emit('memory:status', s),
      emitChanged: (p) => emit('memory:changed', { sceneId: p.sceneId, entryIds: [...new Set(p.entryIds)] }),
      quietMs: quietMs()
    })
    keeper.start()
  })
  // Closing a world stops the keeper and finishes its records first; nothing is written after.
  onWorldClosing((w) => {
    if (keeper && keeper.db === w.db) {
      keeper.stop()
      keeper = null
      emit('memory:status', idleStatus())
    }
  })
  // Before a draft, the memory catches up with earlier scenes on the line.
  setBeforeDraft((db, sceneId) => (keeper && keeper.db === db ? keeper.catchUpBefore(sceneId) : undefined))
}

/** The keeper of the open world (null when none is open). */
export const currentKeeper = (): Keeper | null => (keeper && maybeCurrentWorld()?.db === keeper.db ? keeper : null)

/** Called by saveSceneText after each save; passes the save's result through. */
export function sceneSaved<T>(sceneId: ID, result: T): T {
  try {
    currentKeeper()?.sceneSaved(sceneId)
  } catch (e) {
    console.warn('The memory keeper missed a save', e)
  }
  return result
}

/** After a version of a scene is restored (its text replaced): the memory reads it now. */
export function sceneRestored(sceneId: ID): void {
  currentKeeper()?.sceneRestored(sceneId)
}

function told(out: ScenesOutcome): void {
  if (!out.sceneIds.length) return
  emit('memory:changed', { sceneId: out.sceneIds.length === 1 ? out.sceneIds[0] : null, entryIds: [...new Set(out.entryIds)] })
  emit('memory:status', memoryStatus())
}

/**
 * After a scene, chapter or story is deleted: facts read only from its words go, and text entries
 * nothing mentions any more move to the Trash (listed in What changed). Never stops the delete.
 */
export function scenesDeleted(db: Database.Database): void {
  try {
    told(db.transaction(() => removeScenes(db))())
  } catch (e) {
    console.warn('The memory keeper could not take a deleted scene out of the memory', e)
  }
}

/** After something is brought back from the Trash: its scenes' facts come back, and anything unread in them is read. */
export function scenesRestored(db: Database.Database): void {
  try {
    const out = db.transaction(() => restoreScenes(db))()
    for (const id of out.sceneIds) currentKeeper()?.sceneRestored(id)
    told(out)
  } catch (e) {
    console.warn('The memory keeper could not bring back a restored scene', e)
  }
}

/** Adam edited an entry by hand: a field he emptied isn't filled again from the same words. Passes the result through. */
export function entryEditedByHand(db: Database.Database, before: Entry, after: Entry): Entry {
  try {
    fieldsClearedByHand(db, before, after)
  } catch (e) {
    console.warn('The memory keeper could not note a cleared field', e)
  }
  return after
}

/** Settings changed (a memory model was chosen, a key added): try again now. */
export function memorySettingsChanged(): void {
  currentKeeper()?.updateNow()
}

export function memoryStatus(): MemoryStatus {
  return currentKeeper()?.status() ?? idleStatus()
}

export function markSceneDone(sceneId: ID): SceneMeta | null {
  return currentKeeper()?.markDone(sceneId) ?? null
}
