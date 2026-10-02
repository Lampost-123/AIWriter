// The memory keeper (milestone 2) keeps the memory up to date with the text, by itself:
//   engine.ts     when runs happen (quiet timer, leaving a scene, marking it done, app start), one at a time
//   track.ts      what changed since the last read, and where each fact's words are now
//   request.ts    the memory model's reading requests, in chunks that fit its window
//   apply.ts      applying its reply under the origin rules, and the "What changed" lines
//   run.ts        one run for one scene, from plan to apply (or "Memory not updated")
//   summaries.ts  scene summaries and roll-ups
//   undo.ts       Undo and answers on the "What changed" list
// This file connects it to the open world, the settings and the window.

import type { ID, MemoryStatus, SceneMeta } from '@shared/types'
import { onWorldClosing, onWorldOpened, maybeCurrentWorld } from '../world'
import { getSettings } from '../settings'
import { getProvider, providerTarget } from '../ai/providers'
import { isLocalUrl, providerWho } from '../ai/errors'
import { setBeforeDraft } from '../ai/gather'
import { emit } from '../events'
import { Keeper, NO_MODEL, idleStatus } from './engine'
import type { MemoryModel } from './model'

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
        ? "The memory keeper's model came from a provider that has been removed. Pick another model for the memory keeper in Settings › Models."
        : "The writer model's provider has been removed. Choose a writer model in Settings › Models to keep the memory up to date."
    }
  }
  const target = providerTarget(provider)
  if (!target.apiKey && !(provider.kind === 'custom' && isLocalUrl(provider.baseUrl))) {
    return { error: `${providerWho(provider)} needs an API key for the memory to keep up. Add it in Settings › Models.` }
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
