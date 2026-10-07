// Story memory step 5, "recall by meaning, sticky entries, and what was said" (Adam, 2026-10-07):
//   text.ts       passages and the words keyword search counts
//   rank.ts       keyword ranking in memory, likeness of meaning, reciprocal rank fusion
//   store.ts      the search index, search-index.db beside world.db (made again whenever it is missing or damaged)
//   indexing.ts   keeping the index in step with the scenes, and reading passages for their vectors
//   vectors.ts    vectors kept between searches, each text read once
//   sticky.ts     entries of the last two scenes
//   said.ts       what was said, word for word
//   recall.ts     what one briefing gets (ContextInput.recall)
//   briefing.ts   where it meets ai/context.ts
//   world.ts      the open world's index, its background upkeep and its searches
//   model/        the search model (bge-small-en-v1.5): its download, its two engines (onnxruntime-node, and the
//                 TypeScript reader where that can't start), its worker threads, and its life in the app (manager.ts)
// This file connects them to the open world, the settings and the window. AIWRITE_RECALL=off (app tests that aren't
// about it) turns all of step 5 off; Settings › Models, "Find by meaning", turns the search model off (keyword search,
// sticky entries and what was said go on). AIWRITE_SEARCH_MODEL=stub uses a stand-in model (app tests). The model
// downloads by itself while the switch is on (model/auto.ts, Adam, 2026-10-08); AIWRITE_SEARCH_MODEL_AUTO=off (app
// tests) leaves that to the Download button.

import type Database from 'better-sqlite3'
import { net } from 'electron'
import type { ID, Settings } from '@shared/types'
import type { SearchModelStatus } from '@shared/contracts/searchModel'
import type { ContextInput } from '../ai/context'
import { getSettings, updateSettings } from '../settings'
import { userDataDir } from '../paths'
import { emit } from '../events'
import { maybeCurrentWorld, onWorldClosing, onWorldOpened, type OpenWorld } from '../world'
import { stubEmbedder } from './stub'
import type { Embedder, RecallInput } from './types'
import { INDEX_AFTER_OPEN_MS, WorldRecall } from './world'
import { modelDir, onnxShipped } from './model/files'
import { SearchModel } from './model/manager'
import { AUTO_AFTER_SWITCH_MS, AutoDownload, autoWanted, startDelay } from './model/auto'
import { startModel } from './model/start'

type DB = Database.Database

/** Step 5 at all: off only for app tests that aren't about it (AIWRITE_RECALL=off). */
export const recallWanted = (env: Record<string, string | undefined> = process.env): boolean => env.AIWRITE_RECALL !== 'off'

/** The search model: Adam's switch (on by default), unless step 5 is off. */
export const meaningWanted = (settings: Partial<Pick<Settings, 'findByMeaning'>>, env: Record<string, string | undefined> = process.env): boolean =>
  recallWanted(env) && settings.findByMeaning !== false

let world: { w: OpenWorld; recall: WorldRecall } | null = null
let stub: Embedder | null = null

const model = new SearchModel({
  dir: () => modelDir(userDataDir()),
  fetchImpl: ((url: string, init?: RequestInit) => net.fetch(url, init)) as unknown as typeof fetch,
  base: () => process.env.AIWRITE_SEARCH_MODEL_URL || undefined,
  start: (dir, onFail) => startModel(dir, onFail),
  shipped: () => onnxShipped(),
  changed: () => emitStatus(),
  ready: () => world?.recall.indexSoon(500)
})

/** The download by itself: while "Find by meaning" is on and the model isn't here. */
const auto = new AutoDownload({
  wanted: () => autoWanted(getSettings()),
  state: () => model.status().state,
  download: () => model.startDownload()
})

/** The search model to search with now, or null (switched off, not downloaded, still starting, or not working). */
function embedderNow(): Embedder | null {
  if (!meaningWanted(getSettings())) return null
  if (process.env.AIWRITE_SEARCH_MODEL === 'stub') return (stub ??= stubEmbedder())
  return model.now()
}

function worldOpened(w: OpenWorld): void {
  worldClosing()
  const recall = new WorldRecall({
    db: w.db,
    folder: w.folder,
    embedder: embedderNow,
    changed: () => emitStatus(),
    isCurrent: () => maybeCurrentWorld()?.db === w.db
  })
  world = { w, recall }
  if (recallWanted()) recall.indexSoon(INDEX_AFTER_OPEN_MS)
}

function worldClosing(w?: OpenWorld): void {
  if (!world || (w && world.w !== w)) return
  const { recall } = world
  world = null
  recall.close()
}

/**
 * What step 5 adds to a scene's briefing (ai/draftFlow.ts): null when it is off, the world isn't open, or anything
 * went wrong (the briefing is then as before). `soFar`: the words a draft carries on from; `signal`: the draft's Stop.
 */
export async function recallForBriefing(db: DB, sceneId: ID, input: ContextInput, soFar = '', signal?: AbortSignal): Promise<RecallInput | null> {
  if (!recallWanted()) return null
  const open = world
  if (!open || open.w.db !== db || maybeCurrentWorld()?.db !== db) return null
  try {
    return await open.recall.search(sceneId, input, soFar, signal)
  } catch (e) {
    console.warn('Recall could not search for this briefing; it goes without', e instanceof Error ? e.message : e)
    return null
  }
}

const currentStatus = (): SearchModelStatus => {
  const m = model.embedder
  return { ...model.status(m && world ? world.recall.counts(m.model) : null), auto: autoWanted(getSettings()) }
}

export function searchModelStatus(): SearchModelStatus {
  // Settings asking is reason enough to get a downloaded model ready.
  if (meaningWanted(getSettings())) model.now()
  return currentStatus()
}

function emitStatus(): void {
  try {
    emit('searchModel:status', currentStatus())
  } catch {
    /* no window yet */
  }
}

/** Adam's own choice about the download by itself: Download lets it, Stop and Remove end it until Download again. */
function letAuto(on: boolean): void {
  try {
    if (getSettings().searchModelAuto !== on) updateSettings({ searchModelAuto: on })
  } catch (e) {
    console.warn('The search model setting could not be saved', e instanceof Error ? e.message : e)
  }
}

export function downloadSearchModel(): SearchModelStatus {
  letAuto(true)
  void model.startDownload()
  return currentStatus()
}

export function stopSearchModelDownload(): SearchModelStatus {
  letAuto(false)
  model.stopDownload()
  return currentStatus()
}

export async function removeSearchModel(): Promise<SearchModelStatus> {
  letAuto(false)
  await model.remove()
  world?.recall.vectors.clear()
  return currentStatus()
}

/** Adam turned "Find by meaning" on or off: the model starts (when downloaded) or lets go of its memory. */
export function findByMeaningChanged(on: boolean): void {
  model.switched(on && recallWanted())
  if (on) {
    world?.recall.indexSoon(500)
    // Turned on with the model not here: it downloads by itself shortly (unless Adam stopped or removed it before).
    auto.soon(AUTO_AFTER_SWITCH_MS)
  }
}

export function initRetrieval(): void {
  onWorldOpened(worldOpened)
  onWorldClosing((w) => worldClosing(w))
  // The download by itself, a little after start-up so opening isn't slowed (and again at each start after a failure).
  auto.soon(startDelay())
}

/** Lets go of the search model's threads as the app quits. */
export function closeRetrieval(): void {
  worldClosing()
  auto.close()
  model.close()
}
