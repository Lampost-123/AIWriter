// Step 5 for the open world: its search index (search-index.db, or one in memory while the file can't be used), kept
// up to date in the background a few seconds after the world opens and after searches, the vectors kept between
// searches, and the search behind each briefing. Closing the world stops all of it at once; nothing is written after.
// Everything it needs is passed in (index.ts), so it is tested without Electron.

import type Database from 'better-sqlite3'
import type { ID } from '@shared/types'
import type { ContextInput } from '../ai/context'
import { readPassages, syncNow, syncSlowly } from './indexing'
import { recallFor } from './recall'
import { openSearchIndex, type SearchIndex } from './store'
import type { Embedder, RecallInput } from './types'
import { Vectors } from './vectors'

type DB = Database.Database

/** How long after a world opens its index is brought up to date (so opening is never held up). */
export const INDEX_AFTER_OPEN_MS = 4000
/** How long after a search the passages it may have added are read (a short wait gathers several). */
export const INDEX_AFTER_SEARCH_MS = 3000

export interface WorldRecallDeps {
  db: DB
  folder: string
  /** The search model to use now, or null (keyword search only). */
  embedder: () => Embedder | null
  /** Opens the index (openSearchIndex by default; tests may pass one in memory). */
  open?: (folder: string) => SearchIndex
  /** How far the passages have been read changed (Settings shows it). */
  changed?: () => void
  /** Whether this is still the open world. */
  isCurrent?: () => boolean
  meaningWaitMs?: number
}

export class WorldRecall {
  private index: SearchIndex | null = null
  /** The index couldn't be made at all: passages aren't searched this session. */
  private unavailable = false
  readonly vectors = new Vectors()
  private readonly stop = new AbortController()
  private timer: ReturnType<typeof setTimeout> | null = null
  private running: Promise<void> | null = null
  private again = false

  constructor(private readonly deps: WorldRecallDeps) {}

  get db(): DB {
    return this.deps.db
  }

  get closed(): boolean {
    return this.stop.signal.aborted
  }

  private live(): boolean {
    return !this.closed && this.deps.db.open && (this.deps.isCurrent?.() ?? true)
  }

  /** The index, opened when first needed; null when there is none. */
  indexOf(): SearchIndex | null {
    if (this.index?.open) return this.index
    if (this.unavailable || !this.live()) return null
    try {
      this.index = (this.deps.open ?? ((f) => openSearchIndex(f).index))(this.deps.folder)
      return this.index
    } catch (e) {
      console.warn('No search index for this world: earlier passages are not searched this session', e instanceof Error ? e.message : e)
      this.unavailable = true
      return null
    }
  }

  /** Brings the index up to date in `ms` (a sooner or later call replaces it). */
  indexSoon(ms: number): void {
    if (this.closed) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      void this.indexNow()
    }, ms)
    this.timer.unref?.()
  }

  /** Brings the index up to date now: scenes first, then (with the search model) the passages' vectors. */
  indexNow(): Promise<void> {
    if (this.running) {
      this.again = true
      return this.running
    }
    this.running = this.indexing().finally(() => {
      this.running = null
    })
    return this.running
  }

  private async indexing(): Promise<void> {
    const signal = this.stop.signal
    try {
      do {
        this.again = false
        const index = this.indexOf()
        if (!index || !this.live()) return
        await syncSlowly(this.deps.db, index, signal)
        const e = this.deps.embedder()
        if (e && this.live()) {
          let last = 0
          const read = (texts: string[], s: AbortSignal): Promise<Float32Array[]> =>
            e.embedLater ? e.embedLater(texts, s) : e.embed(texts, 'passage', s)
          await readPassages(index, e, read, {
            signal,
            vectors: this.vectors,
            onProgress: () => {
              if (Date.now() - last > 3000) {
                last = Date.now()
                this.deps.changed?.()
              }
            }
          })
        }
        if (this.live() && index.open) index.tidy(e?.model ?? null)
      } while (this.again && this.live())
    } catch (e) {
      if (!this.closed) console.warn('The search index could not be brought up to date', e instanceof Error ? e.message : e)
    } finally {
      if (!this.closed) this.deps.changed?.()
    }
  }

  /**
   * What step 5 adds to a scene's briefing; null when the world closed. The index catches up with the scenes first;
   * when it can't, this search goes without earlier passages rather than search words that may be gone.
   */
  async search(sceneId: ID, input: ContextInput, soFar = '', signal?: AbortSignal): Promise<RecallInput | null> {
    if (!this.live()) return null
    let index = this.indexOf()
    if (index) {
      try {
        syncNow(this.deps.db, index)
      } catch (e) {
        console.warn('The search index could not catch up before this search; earlier passages are left out of it', e instanceof Error ? e.message : e)
        index = null
      }
    }
    const embedder = this.deps.embedder()
    const result = await recallFor(
      { db: this.deps.db, index, embedder, vectors: this.vectors, signal, background: this.stop.signal, meaningWaitMs: this.deps.meaningWaitMs },
      sceneId,
      input,
      soFar
    )
    // Passages new since the last search (a scene just written) are read for meaning shortly after.
    if (embedder) this.indexSoon(INDEX_AFTER_SEARCH_MS)
    return this.live() ? result : null
  }

  /** How many of the world's passages have been read for meaning by this model; null when that isn't known. */
  counts(model: string): { done: number; total: number } | null {
    if (!this.index?.open) return null
    try {
      const c = this.index.counts(model)
      return { done: c.withVectors, total: c.passages }
    } catch {
      return null
    }
  }

  /** Stops everything for this world and closes its index. */
  close(): void {
    this.stop.abort()
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    try {
      this.index?.close()
    } catch (e) {
      console.warn('Could not close the search index', e)
    }
  }
}
