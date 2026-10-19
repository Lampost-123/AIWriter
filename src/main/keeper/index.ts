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
import { setBeforeDraft, setStandAt, withStageRead, type BeforeDraft } from '../ai/gather'
import { emit } from '../events'
import * as kdb from '../db/keeper'
import { Keeper, NO_MODEL, idleStatus } from './engine'
import { setContentNote, contentNoteFor, type MemoryModel } from './model'
import { effectiveStyle } from '@shared/style'
import * as repo from '../db/repo'
import { fieldsClearedByHand, removeScenes, restoreScenes, type ScenesOutcome } from './removed'
import { fillFound } from '../builder/fill'
import { voiceLater } from '../readAloud'
import { pausedNote } from '../usage/gate'
import { setAsideWordingClashes } from './wordingClashes'
import { stateAfter, stateAtText, stateBefore, storedState, type SceneState } from '../continuity/tracker'
import { jobModel } from '../ai/jobModel'
import { dismissRefusals, modelKeyOf, onRefusal, refusalNote } from './refusals'
import { loadShapeSafe, placeWords } from './places'
import { rulesAfterDeleting, rulesAfterRead } from '../checks/ruleChecks'
import { settleByEntry } from '../db/checks'
import { fieldValue } from './facts'
import { fillProgress, indexScene, indexStories, startIndexing, stopIndexing } from './indexing'
import { refreshSceneSafely } from '../storyIndex/upkeep'

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

/** True when the memory can work now: a memory model is set up and this month's spending limit isn't holding it. */
export const memoryReady = (): boolean => !pausedNote() && !('error' in memoryModel())

const quietMs = (): number | undefined => envMs('AIWRITE_KEEPER_QUIET_MS')

/** A wait in ms from the environment (app tests make the waits short), or undefined for the usual one. */
function envMs(name: string): number | undefined {
  const v = Number(process.env[name])
  return Number.isFinite(v) && v > 0 ? v : undefined
}

/** Drafts waiting for the memory to catch up now: the story index's background work gives way meanwhile (indexing.ts). */
let draftsWaiting = 0
/** Where things stand being brought up to date after a read (standLater) now: the background work gives way to it too. */
let standingNow = 0

/** The before-draft catch-up, counted while it goes on (draftsWaiting). */
const countingDrafts =
  (fn: BeforeDraft): BeforeDraft =>
  async (db, sceneId, limitMs) => {
    draftsWaiting++
    try {
      return await fn(db, sceneId, limitMs)
    } finally {
      draftsWaiting--
    }
  }

/** The memory's status with how far "Fill in the whole story" has got (MemoryStatus.filling), when it is going on. */
function withFilling(db: Database.Database, status: MemoryStatus): MemoryStatus {
  try {
    const p = fillProgress(db)
    return p ? { ...status, filling: { storyId: p.storyId, title: p.title, done: p.done, total: p.total } } : status
  } catch (e) {
    console.warn('Could not tell how far filling in the story has got', e)
    return status
  }
}

export function initKeeper(): void {
  // Every memory job is told when the story means its content to be strong (model.ts contentNoteFor), from the scene's
  // style guide as the writer has it.
  setContentNote((db, sceneId) => {
    const { story } = repo.sceneLocation(db, sceneId)
    return contentNoteFor(effectiveStyle(getWritingPrefs(), repo.getWorldStyle(db), story.style).intensity)
  })
  // A model turned a scene down (refusals.ts): the top bar's note is brought up to date at once.
  onRefusal((db) => {
    if (currentKeeper()?.db === db) emit('memory:status', memoryStatus())
  })
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
      emitStatus: (s) => emit('memory:status', withFilling(w.db, s)),
      emitChanged: (p) => {
        emit('memory:changed', { sceneId: p.sceneId, entryIds: [...new Set(p.entryIds)] })
        // A scene's read or summary changed what its index rows are built from (the story index follows, soon).
        if (p.sceneId) indexScene(w.db, p.sceneId)
      },
      onNewEntries: (entryIds, model) => fillLater(w.db, entryIds, model),
      onSceneRead: (sceneId, model) => standLater(w.db, sceneId, model),
      quietMs: quietMs()
    })
    keeper.start()
    // The story index (overhaul phase 1): built for every story once the window is up, then kept current; the last
    // chapters' physical details are worked out in the background at low priority (keeper/indexing.ts).
    const k = keeper
    startIndexing(w.db, {
      model: () => {
        const paused = pausedNote()
        return paused ? { error: paused } : memoryModel()
      },
      busy: () => draftsWaiting > 0 || standingNow > 0 || k.busy,
      live: () => w.db.open && maybeCurrentWorld()?.db === w.db && !k.isClosed,
      onProgress: () => {
        if (currentKeeper()?.db === w.db) emit('memory:status', memoryStatus())
      },
      onDone: (d) => emit('storyFill:done', d),
      openDelayMs: envMs('AIWRITE_INDEX_OPEN_MS'),
      fillWaitMs: envMs('AIWRITE_INDEX_WAIT_MS'),
      // App tests that count AI calls leave the recent chapters' details out unless they ask (AIWRITE_INDEX_FILL).
      recent: process.env.AIWRITE_INDEX_FILL !== 'off'
    })
  })
  // Closing a world stops the keeper and finishes its records first; nothing is written after.
  onWorldClosing((w) => {
    stopIndexing(w.db)
    if (keeper && keeper.db === w.db) {
      keeper.stop()
      keeper = null
      emit('memory:status', idleStatus())
    }
  })
  // Before a draft (and Continue), the memory catches up with earlier scenes on the line and reads the scene's own
  // unread words (waiting a few seconds at most), and where things stand as the previous scene ends is brought up to
  // date (continuity/tracker.ts) at the same time (gather.ts withStageRead).
  const mine = (db: Database.Database): Keeper | null => (keeper && keeper.db === db ? keeper : null)
  setBeforeDraft(
    countingDrafts(
      withStageRead(
        // The summaries a draft can't do without are waited for no longer than the draft waits at all (fix 15 review). A
        // draft that waits until the memory is done (no limit) waits for the scene's own fresh read just as long.
        async (db, sceneId, limitMs) => mine(db)?.beforeDraft(sceneId, limitMs === Infinity ? Infinity : undefined, limitMs),
        async (db, sceneId) => (mine(db) ? continuityBefore(db, sceneId) : undefined)
      )
    )
  )
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

/** Bringing where things stand up to date after the memory read a scene, one scene after another. */
let standing: Promise<void> = Promise.resolve()

/**
 * After the memory read a scene (a pause in typing, a draft, a beat, leaving the scene): where things stand as it
 * ends, read on from its last checkpoint, so only the new words are read (continuity/tracker.ts). Recall reloads when
 * it changed. Then the free rule checks run over the scene (long story memory fix 8, checks/ruleChecks.ts: no AI call),
 * with the memory and the stage as they now are, and over the later scenes whose open findings may rest on it. Never
 * holds up the memory; never throws.
 */
function standLater(db: Database.Database, sceneId: ID, model: MemoryModel): void {
  const live = (): boolean => db.open && maybeCurrentWorld()?.db === db
  standingNow++
  standing = standing
    .then(async () => {
      if (!live()) return
      if (!pausedNote()) await standUp(db, sceneId, model, live)
      if (!live()) return
      rulesAfterRead(db, sceneId, getWritingPrefs())
      // The story index takes in what the read and where things stand now say of the scene (overhaul phase 1; free).
      refreshSceneSafely(db, sceneId)
    })
    .finally(() => standingNow--)
}

/** Where things stand as a scene ends, brought up to date (standLater). Never throws. */
async function standUp(db: Database.Database, sceneId: ID, model: MemoryModel, live: () => boolean): Promise<void> {
  try {
    const o = { db, model, signal: new AbortController().signal, closed: () => !live() }
    const was = storedState(db, sceneId)
    if (was?.current) return
    await stateBefore(o, sceneId)
    await stateAfter(o, sceneId)
    // Reloaded when it changed, even when a scene far back still waits to be read again (so it isn't current).
    const now = live() ? storedState(db, sceneId) : null
    if (now && (now.current || JSON.stringify(now.state) !== JSON.stringify(was?.state))) emit('recall:changed', { sceneId })
  } catch (e) {
    console.warn('Could not bring where things stand up to date', e)
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

/**
 * Adam changed the story record by hand (long story memory fix 15 review): a change on an entry page, an undo or answer in
 * What changed, Keep or Remove in Worth a look, a scene card, a scene moved or deleted, an entry, where a story sits. The
 * end-of-chapter snapshots and roll-ups resting on it are brought up to date while the keeper is idle, as after a read:
 * of the stories of `at`'s scenes and stories, or of every story when none can be told. Never stops the edit.
 */
export function recordEdited(db: Database.Database, at: { sceneIds?: (ID | null | undefined)[]; storyIds?: (ID | null | undefined)[] } = {}): void {
  try {
    const k = currentKeeper()
    if (!k || k.db !== db) return
    const stories = new Set<ID>()
    for (const id of at.storyIds ?? []) if (id) stories.add(id)
    for (const id of at.sceneIds ?? []) {
      const story = id ? kdb.anyKeeperScene(db, id)?.storyId : null
      if (story) stories.add(story)
    }
    k.recordEdited(stories.size ? [...stories] : undefined)
    // The story index rests on the same record (a change, a card, a scene or chapter moved, an entry's names): the
    // stories it touches are brought up to date in the background (only what changed is built again).
    indexStories(db, stories.size ? [...stories] : undefined)
  } catch (e) {
    console.warn('The memory keeper missed an edit to the record', e)
  }
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
  // A deleted scene keeps none of the rule checks' findings open (long story memory fix 8).
  rulesAfterDeleting(db)
  // Nor any rows in the story index: every story is looked at (only what changed is built again), the gone dropped.
  indexStories(db)
}

/**
 * After something is brought back from the Trash: its scenes' facts come back, and anything unread in them is read. The
 * rule checks look at each again at once (long story memory fix 8: free, so they don't wait for a read).
 */
export function scenesRestored(db: Database.Database): void {
  let back: ID[] = []
  try {
    const out = db.transaction(() => restoreScenes(db))()
    back = out.sceneIds
    for (const id of out.sceneIds) currentKeeper()?.sceneRestored(id)
    told(out)
  } catch (e) {
    console.warn('The memory keeper could not bring back a restored scene', e)
  }
  rulesAfterDeleting(db, back, getWritingPrefs())
  // The story index takes the scenes back in (every story looked at; only what changed is built again).
  indexStories(db)
}

/**
 * Adam edited an entry by hand: a field he emptied isn't filled again from the same words, and a clash with one of its
 * fields that his edit settles (the field now says what the scene says) is fixed by the memory (findings that stay
 * current, 2026-10-16; db/checks.ts settleByEntry). Passes the result through.
 */
export function entryEditedByHand(db: Database.Database, before: Entry, after: Entry): Entry {
  try {
    fieldsClearedByHand(db, before, after)
  } catch (e) {
    console.warn('The memory keeper could not note a cleared field', e)
  }
  try {
    settleByEntry(db, after.id, (field) => fieldValue(after, field))
  } catch (e) {
    console.warn('Could not settle the issues an entry’s edit answers', e)
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
  const k = currentKeeper()
  const status = k ? withFilling(k.db, k.status()) : idleStatus()
  const refused = k ? refusedNow(k.db) : null
  return refused ? { ...status, refused } : status
}

/**
 * The top bar's lasting note about scenes the memory model or the consistency check model turned down (refusals.ts):
 * only what a model still in use turned down. Never throws.
 */
function refusedNow(db: Database.Database): MemoryStatus['refused'] | null {
  try {
    const m = memoryModel()
    let check: string | null = null
    try {
      check = modelKeyOf(jobModel('check', { settings: getSettings(), getProvider, providerTarget }))
    } catch {
      check = null
    }
    const shape = loadShapeSafe(db)
    const where = (sceneId: ID): string => {
      const s = kdb.keeperScene(db, sceneId)
      return s ? placeWords(db, shape, { storyId: s.storyId, chapterId: s.chapterId, sceneId }) : ''
    }
    return refusalNote(db, { memory: 'error' in m ? null : modelKeyOf(m), check }, where)
  } catch (e) {
    console.warn('Could not tell what the models turned down', e)
    return null
  }
}

/** Adam dismissed the note about scenes turned down: it comes back only with a new refusal. */
export function dismissRefusedNote(): void {
  const k = currentKeeper()
  if (!k) return
  dismissRefusals(k.db)
  emit('memory:status', memoryStatus())
}

export function markSceneDone(sceneId: ID): SceneMeta | null {
  return currentKeeper()?.markDone(sceneId) ?? null
}
