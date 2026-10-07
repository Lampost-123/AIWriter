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
import { getSettings, getWritingPrefs } from '../settings'
import { getProvider, providerTarget } from '../ai/providers'
import { isLocalUrl, providerWho } from '../ai/errors'
import { setBeforeDraft, setStandAt } from '../ai/gather'
import { emit } from '../events'
import { Keeper, NO_MODEL, idleStatus } from './engine'
import type { MemoryModel } from './model'
import { fieldsClearedByHand, removeScenes, restoreScenes, type ScenesOutcome } from './removed'
import { fillFound } from '../builder/fill'
import { voiceLater } from '../readAloud'
import { pausedNote } from '../usage/gate'
import { setAsideWordingClashes } from './wordingClashes'
import { stateAtText, stateBefore, type SceneState } from '../continuity/tracker'

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
        ? "The memory model came from a provider that has been removed. Pick another memory model in Settings › Models."
        : "The writer model's provider has been removed. Choose a writer model in Settings › Models to keep the memory up to date."
    }
  }
  const target = providerTarget(provider)
  if (!target.apiKey && !(provider.kind === 'custom' && isLocalUrl(provider.baseUrl))) {
    return { error: `${providerWho(provider)} needs an API key for the memory to keep up. Add it in Settings › Models.` }
  }
  return { target, choice, thinking: s.thinking?.memory ?? 'off' }
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
    // Once per world (0.6.2): issues raised for a scene merely wording something differently are set aside.
    try {
      setAsideWordingClashes(w.db)
    } catch (e) {
      console.warn('Could not set aside the issues that only differ in wording', e)
    }
    keeper = new Keeper({
      db: w.db,
      // Milestone 6: while this month's AI spending has reached Adam's limit, the memory waits as it does with no
      // model (scenes stay waiting, with the reason in the top bar's note) and catches up when he carries on.
      model: () => {
        const paused = pausedNote()
        return paused ? { error: paused } : memoryModel()
      },
      emitStatus: (s) => emit('memory:status', s),
      emitChanged: (p) => emit('memory:changed', { sceneId: p.sceneId, entryIds: [...new Set(p.entryIds)] }),
      onNewEntries: (entryIds, model) => fillLater(w.db, entryIds, model),
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
  // Before a draft, the memory catches up with earlier scenes on the line, and then where things stand as the
  // previous scene ends is brought up to date (continuity/tracker.ts).
  setBeforeDraft(async (db, sceneId) => {
    if (!keeper || keeper.db !== db) return
    await keeper.catchUpBefore(sceneId)
    await continuityBefore(db, sceneId)
  })
  // Add below, a later beat and Continue carry on from the scene so far: where things stand at its end.
  setStandAt(continuityAt)
}

/**
 * Where things stand as a scene begins (continuity/tracker.ts), brought up to date with the memory model: before a
 * draft, and before a check of the scene. Never throws; with no memory model, what is kept stands.
 */
export async function continuityBefore(db: Database.Database, sceneId: ID, signal?: AbortSignal): Promise<void> {
  const m = memoryModel()
  if ('error' in m || pausedNote()) return
  const live = (): boolean => db.open && maybeCurrentWorld()?.db === db
  await stateBefore({ db, model: m, signal: signal ?? new AbortController().signal, closed: () => !live() }, sceneId)
}

/**
 * Where things stand at the end of `text`, the scene so far (continuity/tracker.ts `stateAtText`), worked out with
 * the memory model. Never throws; null with no memory model (or memory paused) or when it couldn't say.
 */
export async function continuityAt(db: Database.Database, sceneId: ID, text: string, signal?: AbortSignal): Promise<SceneState | null> {
  const m = memoryModel()
  if ('error' in m || pausedNote()) return null
  const live = (): boolean => db.open && maybeCurrentWorld()?.db === db
  try {
    return await stateAtText({ db, model: m, signal: signal ?? new AbortController().signal, closed: () => !live() }, sceneId, text)
  } catch (e) {
    console.warn('Could not work out where things stand in the scene so far', e)
    return null
  }
}

/** Filling in what the memory found, one batch after another, never holding up the memory itself. */
let filling: Promise<void> = Promise.resolve()

/**
 * Someone or something new was found in a scene's text, with little more than a name and a line: the memory
 * model fills in their empty fields from what the story says (builder/fill.ts), as the AI's, and then each new
 * character gets a read-aloud voice, as Suggest would write it (readAloud/autoVoice.ts). A follow-on after the
 * run, so it never slows or breaks the memory; a failure leaves the fields empty. Stops when the world closes.
 */
function fillLater(db: Database.Database, entryIds: ID[], model: MemoryModel): void {
  const live = (): boolean => db.open && maybeCurrentWorld()?.db === db
  filling = filling
    .then(async () => {
      if (!live()) return
      const result = await fillFound(db, entryIds, model, { prefs: getWritingPrefs(), stopped: () => !live() })
      if (result.filled.length && live()) emit('memory:changed', { sceneId: null, entryIds: result.filled })
      // From the filled-in page, so the voice fits who they are; in its own queue, so the next fill isn't held up.
      if (live()) voiceLater(db, entryIds)
    })
    .catch((e) => console.warn('Could not fill in what the memory found', e))
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
const settingsListeners: (() => void)[] = []
/** Runs when the memory's model, its Thinking or the spending limit changes (the import catch-up carries on). */
export const onMemorySettingsChanged = (fn: () => void): void => void settingsListeners.push(fn)

export function memorySettingsChanged(): void {
  currentKeeper()?.updateNow()
  for (const fn of settingsListeners) {
    try {
      fn()
    } catch (e) {
      console.error('memory settings listener failed', e)
    }
  }
}

export function memoryStatus(): MemoryStatus {
  return currentKeeper()?.status() ?? idleStatus()
}

export function markSceneDone(sceneId: ID): SceneMeta | null {
  return currentKeeper()?.markDone(sceneId) ?? null
}
