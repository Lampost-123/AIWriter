// The story index for the open world (overhaul phase 1, wiring): kept current as the world changes (storyIndex/
// upkeep.ts), and its physical details filled in by the memory model in the background (storyIndex/fill.ts):
// - when a world opens, once the window is up: every story's free part is built (a story at a time), then where things
//   stand is worked out for the last chapters of each story being written, at low priority;
// - as the world changes (keeper/index.ts and the handlers tell it): a scene read, a card saved, where things stand worked
//   out, a summary written, scenes deleted, brought back or moved, the memory edited by hand;
// - "Fill in the whole story" (Adam), with progress in the memory's status.
// Nothing here ever throws into the caller or holds it up. keeper/index.ts starts and stops it with the world.

import type Database from 'better-sqlite3'
import type { ID } from '@shared/types'
import type { StoryFillDone, StoryFillProgress } from '@shared/contracts/storyIndex'
import { onStageKept } from '../continuity/tracker'
import { IndexUpkeep } from '../storyIndex/upkeep'
import { StageFiller, recentScenesToFill } from '../storyIndex/fill'
import type { MemoryModel } from './model'

type DB = Database.Database

/** How long after a world opens its index is first brought up to date (the window comes up first). */
export const INDEX_OPEN_DELAY_MS = 3_000

export interface IndexingDeps {
  /** The memory model now (or why there is none: no model, or the spending limit). */
  model: () => MemoryModel | { error: string }
  /** True while the memory, a draft or where things stand for a read come first. */
  busy: () => boolean
  /** True while this world is the open one. */
  live: () => boolean
  /** Adam's fill moved on (or is over: null). */
  onProgress?: (p: StoryFillProgress | null) => void
  onDone?: (d: StoryFillDone) => void
  /** How long after opening the first build starts (INDEX_OPEN_DELAY_MS). */
  openDelayMs?: number
  /** How long changes are gathered before they are taken in. */
  upkeepDelayMs?: number
  /** How long the fill waits before looking again while something comes first. */
  fillWaitMs?: number
  /** Whether the recent chapters' details are worked out by themselves when the world opens (on). */
  recent?: boolean
  fetchImpl?: typeof fetch
  retryDelays?: number[]
}

interface Indexing {
  db: DB
  upkeep: IndexUpkeep
  filler: StageFiller
  opening: ReturnType<typeof setTimeout> | null
  /** Resolves once the first build after opening (and the recent chapters' queueing) is done, or the world closed first. */
  opened: Promise<void>
  done?: () => void
  off: () => void
}

let now: Indexing | null = null

const mine = (db: DB): Indexing | null => (now && now.db === db ? now : null)

/** The world opened: its index is brought up to date soon after, and kept so. */
export function startIndexing(db: DB, deps: IndexingDeps): void {
  stopIndexing()
  const live = (): boolean => db.open && deps.live()
  const upkeep = new IndexUpkeep({ db, live, delayMs: deps.upkeepDelayMs })
  const filler = new StageFiller({
    db,
    model: deps.model,
    busy: deps.busy,
    closed: () => !live(),
    waitMs: deps.fillWaitMs,
    onProgress: deps.onProgress,
    onDone: deps.onDone,
    // Taken in with the next gathering of changes.
    onSceneFilled: (sceneId) => upkeep.scene(sceneId),
    fetchImpl: deps.fetchImpl,
    retryDelays: deps.retryDelays
  })
  // Where things stand kept anew for a scene of this world (a read, a draft's catch-up, Recall, a fill): its rows follow.
  const off = onStageKept((d, sceneId) => {
    if (d === db) upkeep.scene(sceneId)
  })
  let opened: () => void = () => undefined
  const state: Indexing = { db, upkeep, filler, opening: null, opened: new Promise<void>((resolve) => (opened = resolve)), off }
  state.done = opened
  now = state
  state.opening = setTimeout(() => {
    state.opening = null
    if (!live() || now !== state) return opened()
    upkeep.stories()
    // The recent chapters' details once the free part is in, so their facts are told against it.
    void upkeep
      .whenIdle()
      .then(() => {
        if (!live() || now !== state || deps.recent === false || 'error' in deps.model()) return
        filler.queueRecent(recentScenesToFill(db))
      })
      .catch((e) => console.warn('Could not tell which recent scenes need their details', e))
      .finally(opened)
  }, deps.openDelayMs ?? INDEX_OPEN_DELAY_MS)
}

/** The world is closing (or another opening): everything stops; nothing more is written. */
export function stopIndexing(db?: DB): void {
  const s = now
  if (!s || (db && s.db !== db)) return
  now = null
  if (s.opening) clearTimeout(s.opening)
  s.done?.()
  s.off()
  s.upkeep.stop()
  s.filler.stop()
}

/** A scene changed (its words read, its card saved, its summary written): its index rows follow soon. */
export function indexScene(db: DB, sceneId: ID | null | undefined): void {
  mine(db)?.upkeep.scene(sceneId)
}

/** Something these stories' index rests on changed (every story, and the stories gone, when none are given). */
export function indexStories(db: DB, storyIds?: (ID | null | undefined)[]): void {
  mine(db)?.upkeep.stories(storyIds)
}

/** The open world's filler (null when no world is open). */
export function storyFiller(db: DB): StageFiller | null {
  return mine(db)?.filler ?? null
}

/** How far Adam's fill has got in this world; null when none is going on. */
export function fillProgress(db: DB): StoryFillProgress | null {
  return mine(db)?.filler.current() ?? null
}

/** Resolves once the index has taken in every change and the fill has nothing waiting (for tests). */
export async function whenIndexIdle(db: DB): Promise<void> {
  const s = mine(db)
  if (!s) return
  await s.opened
  await s.upkeep.whenIdle()
  await s.filler.whenIdle()
  await s.upkeep.whenIdle()
}
