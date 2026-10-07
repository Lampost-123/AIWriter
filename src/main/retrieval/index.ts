// Story memory step 5, "recall by meaning, sticky entries, and what was said" (Adam, 2026-10-07):
//   text.ts       passages and the words keyword search counts
//   rank.ts       keyword ranking in memory, likeness of meaning, reciprocal rank fusion
//   store.ts      the search index, search-index.db beside world.db (made again whenever it is missing or damaged)
//   indexing.ts   keeping the index in step with the scenes, and reading passages for their vectors
//   sticky.ts     entries of the last two scenes
//   said.ts       what was said, word for word
//   recall.ts     what one briefing gets (ContextInput.recall)
//   briefing.ts   where it meets ai/context.ts
//   model/        the search model (bge-small-en-v1.5): its download, tokenizer, forward pass and worker threads
// This file connects them to the open world, the settings and the window. AIWRITE_RECALL=off (app tests that aren't
// about it) turns all of step 5 off; Settings › Models, "Find by meaning", turns the search model off (keyword search,
// sticky entries and what was said go on). AIWRITE_SEARCH_MODEL=stub uses a stand-in model (app tests).

import type Database from 'better-sqlite3'
import { net } from 'electron'
import type { ID, Settings } from '@shared/types'
import type { SearchModelStatus } from '@shared/contracts/searchModel'
import type { ContextInput } from '../ai/context'
import { getSettings } from '../settings'
import { userDataDir } from '../paths'
import { emit } from '../events'
import { maybeCurrentWorld, onWorldClosing, onWorldOpened, type OpenWorld } from '../world'
import { openSearchIndex, type SearchIndex } from './store'
import { readPassages, syncNow, syncSlowly } from './indexing'
import { recallFor, VectorCache } from './recall'
import { stubEmbedder } from './stub'
import type { Embedder, RecallInput } from './types'
import { checkModel, type BgeEmbedder } from './model/embedder'
import { installed, modelDir, SEARCH_MODEL_BYTES, writeManifest } from './model/files'
import { downloadModel, DownloadStopped, removeModel } from './model/download'
import { startModel } from './model/start'

type DB = Database.Database

/** Step 5 at all: off only for app tests that aren't about it (AIWRITE_RECALL=off). */
export const recallWanted = (env: Record<string, string | undefined> = process.env): boolean => env.AIWRITE_RECALL !== 'off'

/** The search model: Adam's switch (on by default), unless step 5 is off. */
export const meaningWanted = (settings: Partial<Pick<Settings, 'findByMeaning'>>, env: Record<string, string | undefined> = process.env): boolean =>
  recallWanted(env) && settings.findByMeaning !== false

// ---------- The open world's index ----------

interface WorldIndex {
  w: OpenWorld
  index: SearchIndex | null
  /** The index couldn't be made at all (no full-text search): passages aren't searched this session. */
  unavailable: boolean
  cache: VectorCache
  stop: AbortController
  timer: ReturnType<typeof setTimeout> | null
  running: boolean
  again: boolean
}

let current: WorldIndex | null = null

/** How long after a world opens its index is brought up to date (so opening is never held up). */
const INDEX_AFTER_OPEN_MS = 4000
/** How long after a search the passages it may have added are read (a short wait gathers several). */
const INDEX_AFTER_SEARCH_MS = 3000

function indexOf(wi: WorldIndex): SearchIndex | null {
  if (wi.index?.open) return wi.index
  if (wi.unavailable || !wi.w.db.open) return null
  try {
    const opened = openSearchIndex(wi.w.folder)
    wi.index = opened.index
    return wi.index
  } catch (e) {
    console.warn('No search index for this world: earlier passages are not searched this session', e instanceof Error ? e.message : e)
    wi.unavailable = true
    return null
  }
}

function indexSoon(wi: WorldIndex, ms: number): void {
  if (wi.stop.signal.aborted) return
  if (wi.timer) clearTimeout(wi.timer)
  wi.timer = setTimeout(() => {
    wi.timer = null
    void indexNow(wi)
  }, ms)
  wi.timer.unref?.()
}

/** Brings the index up to date in the background: scenes first, then (with the search model) the passages' vectors. */
async function indexNow(wi: WorldIndex): Promise<void> {
  if (wi.running) {
    wi.again = true
    return
  }
  wi.running = true
  try {
    do {
      wi.again = false
      const index = indexOf(wi)
      if (!index) return
      await syncSlowly(wi.w.db, index, wi.stop.signal)
      const e = embedderNow()
      if (e && !wi.stop.signal.aborted) {
        const read =
          'embedLater' in e
            ? (texts: string[], signal: AbortSignal) => (e as BgeEmbedder).embedLater(texts, signal)
            : (texts: string[], signal: AbortSignal) => e.embed(texts, 'passage', signal)
        let last = 0
        await readPassages(index, e, read, {
          signal: wi.stop.signal,
          cache: wi.cache,
          // The Settings line saying how far it has got, at most every few seconds.
          onProgress: () => {
            if (Date.now() - last > 3000) {
              last = Date.now()
              emitStatus()
            }
          }
        })
      }
      if (!wi.stop.signal.aborted && index.open) index.tidy(e?.model ?? null)
    } while (wi.again && !wi.stop.signal.aborted)
  } catch (e) {
    if (!wi.stop.signal.aborted) console.warn('The search index could not be brought up to date', e instanceof Error ? e.message : e)
  } finally {
    wi.running = false
    emitStatus()
  }
}

function worldOpened(w: OpenWorld): void {
  worldClosing()
  current = { w, index: null, unavailable: false, cache: new VectorCache(), stop: new AbortController(), timer: null, running: false, again: false }
  if (recallWanted()) indexSoon(current, INDEX_AFTER_OPEN_MS)
}

function worldClosing(w?: OpenWorld): void {
  if (!current || (w && current.w !== w)) return
  const wi = current
  current = null
  wi.stop.abort()
  if (wi.timer) clearTimeout(wi.timer)
  try {
    wi.index?.close()
  } catch (e) {
    console.warn('Could not close the search index', e)
  }
}

/**
 * What step 5 adds to a scene's briefing (ai/draftFlow.ts): null when it is off, the world isn't open, or anything
 * went wrong (the briefing is then as before). `soFar`: the words a draft carries on from.
 */
export async function recallForBriefing(db: DB, sceneId: ID, input: ContextInput, soFar = '', signal?: AbortSignal): Promise<RecallInput | null> {
  if (!recallWanted()) return null
  const wi = current
  if (!wi || wi.w.db !== db || maybeCurrentWorld()?.db !== db) return null
  try {
    const index = indexOf(wi)
    if (index) {
      try {
        syncNow(db, index)
      } catch (e) {
        console.warn('The search index could not catch up before this search', e instanceof Error ? e.message : e)
      }
    }
    const embedder = embedderNow()
    const result = await recallFor({ db, index, embedder, cache: wi.cache, signal }, sceneId, input, soFar)
    // Passages new since the last search (a scene just written) are read for meaning shortly after.
    if (embedder) indexSoon(wi, INDEX_AFTER_SEARCH_MS)
    return result
  } catch (e) {
    console.warn('Recall could not search for this briefing; it goes without', e instanceof Error ? e.message : e)
    return null
  }
}

// ---------- The search model ----------

const model: {
  embedder: Embedder | null
  starting: boolean
  broken: string | null
  download: AbortController | null
  progress: number | null
  problem: string | null
} = { embedder: null, starting: false, broken: null, download: null, progress: null, problem: null }

let stub: Embedder | null = null
const dir = (): string => modelDir(userDataDir())

/** The search model to search with now, or null (switched off, not downloaded, still starting, or not working). */
function embedderNow(): Embedder | null {
  if (!meaningWanted(getSettings())) return null
  if (process.env.AIWRITE_SEARCH_MODEL === 'stub') return (stub ??= stubEmbedder())
  if (model.embedder) return model.embedder
  if (!model.starting && !model.broken && !model.download && installed(dir())) void startSoon()
  return null
}

/** Reads the downloaded model and checks it, in the background; finding by meaning starts once it passes. */
async function startSoon(): Promise<void> {
  if (model.starting || model.embedder) return
  model.starting = true
  emitStatus()
  let e: BgeEmbedder | null = null
  try {
    e = await startModel(dir())
    if (!e) return
    const m = installed(dir())
    // The check runs once per download: a model that tells related sentences from unrelated ones is used.
    if (!m?.checked) {
      const check = await checkModel(e)
      if (m) writeManifest(dir(), { ...m, checked: { at: new Date().toISOString(), ok: check.ok, ...(check.why ? { why: check.why } : {}) } })
      if (!check.ok) throw new Error(`the search model didn't pass its check: ${check.why}`)
    } else if (!m.checked.ok) throw new Error(`the search model didn't pass its check: ${m.checked.why ?? ''}`)
    model.embedder = e
    model.broken = null
    if (current) indexSoon(current, 500)
  } catch (err) {
    e?.close()
    model.broken = err instanceof Error ? err.message : String(err)
    console.warn('Finding by meaning is off: the search model could not start', model.broken)
  } finally {
    model.starting = false
    emitStatus()
  }
}

function stopModel(): void {
  model.embedder?.close?.()
  model.embedder = null
}

export function searchModelStatus(): SearchModelStatus {
  const sizeMb = Math.round(SEARCH_MODEL_BYTES / 1_000_000)
  const ready = !!model.embedder
  let indexed: SearchModelStatus['indexed'] = null
  const wi = current
  if (ready && wi?.index?.open) {
    try {
      const c = wi.index.counts(model.embedder!.model)
      indexed = { done: c.withVectors, total: c.passages }
    } catch {
      indexed = null
    }
  }
  const state: SearchModelStatus['state'] = model.download
    ? 'downloading'
    : ready
      ? 'ready'
      : model.broken
        ? 'broken'
        : installed(dir())
          ? 'starting'
          : 'none'
  return {
    state,
    sizeMb,
    progress: model.download ? model.progress : null,
    problem: state === 'broken' ? `The search model isn't working (${model.broken}). Remove it and download it again.` : model.problem,
    indexed
  }
}

function emitStatus(): void {
  try {
    emit('searchModel:status', searchModelStatus())
  } catch {
    /* no window yet */
  }
}

export function downloadSearchModel(): SearchModelStatus {
  if (model.download || model.embedder) return searchModelStatus()
  const stop = new AbortController()
  model.download = stop
  model.progress = 0
  model.problem = null
  model.broken = null
  emitStatus()
  let last = 0
  void downloadModel(dir(), {
    fetchImpl: ((url: string, init?: RequestInit) => net.fetch(url, init)) as unknown as typeof fetch,
    signal: stop.signal,
    base: process.env.AIWRITE_SEARCH_MODEL_URL || undefined,
    onProgress: (p) => {
      model.progress = p.total ? p.done / p.total : null
      if (Date.now() - last > 250) {
        last = Date.now()
        emitStatus()
      }
    }
  })
    .then(() => {
      model.download = null
      model.progress = null
      void startSoon()
    })
    .catch((e: unknown) => {
      model.download = null
      model.progress = null
      model.problem = e instanceof DownloadStopped ? null : e instanceof Error ? e.message : String(e)
      emitStatus()
    })
  return searchModelStatus()
}

export function stopSearchModelDownload(): SearchModelStatus {
  model.download?.abort()
  model.download = null
  model.progress = null
  return searchModelStatus()
}

export function removeSearchModel(): SearchModelStatus {
  model.download?.abort()
  model.download = null
  stopModel()
  model.broken = null
  model.problem = null
  try {
    removeModel(dir())
  } catch (e) {
    model.problem = `The search model couldn't be removed (${e instanceof Error ? e.message : String(e)}). Close AI Write and try again.`
  }
  current?.cache.clear()
  emitStatus()
  return searchModelStatus()
}

/** Adam turned "Find by meaning" on or off: the model starts (when downloaded) or lets go of its memory. */
export function findByMeaningChanged(on: boolean): void {
  if (!on) {
    stopModel()
    emitStatus()
    return
  }
  if (installed(dir())) void startSoon()
  if (current) indexSoon(current, 500)
}

export function initRetrieval(): void {
  onWorldOpened(worldOpened)
  onWorldClosing((w) => worldClosing(w))
}

/** Lets go of the search model's threads as the app quits. */
export function closeRetrieval(): void {
  worldClosing()
  model.download?.abort()
  stopModel()
}
