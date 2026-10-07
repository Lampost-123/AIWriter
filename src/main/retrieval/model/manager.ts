// The search model's life in the app (Settings › Models, "Find by meaning"): its download, Stop and Remove, starting it
// in the background once it is here, its check, and what Settings shows. Everything it uses is passed in (index.ts), so
// it is tested without Electron, threads or the internet. Races are settled by keeping only the newest of each: a
// download's end counts only while it is still the download under way, and a start only while nothing (Remove, the
// switch turned off) came after it.

import type { SearchModelStatus } from '@shared/contracts/searchModel'
import type { Embedder } from '../types'
import { checkModel } from './embedder'
import { DownloadStopped, downloadModel, removeModel } from './download'
import { engineToDownload, filesFor, installed, readManifest, SEARCH_MODEL_BYTES, writeManifest, type Engine } from './files'
import { OtherFormNeeded } from './start'

export interface ModelDeps {
  dir: () => string
  fetchImpl: typeof fetch
  /** Another server for the files (app tests), or undefined for Hugging Face. */
  base?: () => string | undefined
  /** Starts the model (start.ts startModel): null when it isn't downloaded. */
  start: (dir: string, onFail: (e: Error) => void) => Promise<{ embedder: Embedder; engine: Engine } | null>
  /** Something Settings shows changed. */
  changed: () => void
  /** The model is ready (the open world's passages can be read now). */
  ready?: () => void
  /** Whether the fast engine is here (files.ts onnxShipped). */
  shipped?: () => boolean
  check?: (e: Embedder) => Promise<{ ok: boolean; why?: string }>
}

/** How many times the model is started again after its threads stop, before it is marked as not working. */
export const RESTARTS = 1

export class SearchModel {
  embedder: Embedder | null = null
  engine: Engine | null = null
  private starting = false
  /** Bumped by everything that makes a start under way out of date (Remove, the switch off, a new start). */
  private gen = 0
  private broken: string | null = null
  private download: AbortController | null = null
  private downloading: Promise<void> | null = null
  private progress: number | null = null
  private problem: string | null = null
  private restarts = 0

  constructor(private readonly deps: ModelDeps) {}

  /** The model to search with now, or null (not downloaded, still starting, not working); starts it when it is here. */
  now(): Embedder | null {
    if (this.embedder) return this.embedder
    if (!this.starting && !this.broken && !this.download && this.usable()) void this.startSoon()
    return null
  }

  /** A downloaded form of the model that can run on this computer is here. */
  private usable(): boolean {
    const m = installed(this.deps.dir())
    return !!m && m.engines.some((e) => e === 'ts' || ((this.deps.shipped?.() ?? true) && !m.onnxFailed))
  }

  get isStarting(): boolean {
    return this.starting
  }

  /** Reads the downloaded model and checks it, in the background; finding by meaning starts once it passes. */
  async startSoon(): Promise<void> {
    if (this.starting || this.embedder) return
    const gen = ++this.gen
    this.starting = true
    this.deps.changed()
    let made: { embedder: Embedder; engine: Engine } | null = null
    // The model this start put in use, once it is (its threads stopping later is told with it).
    let mine: Embedder | null = null
    try {
      made = await this.deps.start(this.deps.dir(), (e) => this.lost(mine, e))
      if (!made || gen !== this.gen) return
      const dir = this.deps.dir()
      const m = readManifest(dir)
      const checked = m?.checked?.[made.engine]
      // The check runs once per download and engine: a model that tells related sentences from unrelated ones is used.
      if (!checked) {
        const check = await (this.deps.check ?? checkModel)(made.embedder)
        if (m) writeManifest(dir, { ...m, checked: { ...m.checked, [made.engine]: { at: new Date().toISOString(), ok: check.ok, ...(check.why ? { why: check.why } : {}) } } })
        if (!check.ok) throw new Error(`it didn't pass its check: ${check.why}`)
      } else if (!checked.ok) throw new Error(`it didn't pass its check: ${checked.why ?? ''}`)
      if (gen !== this.gen) return
      this.embedder = made.embedder
      this.engine = made.engine
      mine = made.embedder
      this.broken = null
      this.problem = null
      made = null
      this.deps.ready?.()
    } catch (err) {
      if (gen !== this.gen) return
      if (err instanceof OtherFormNeeded) {
        // The fast engine can't start here and the other form isn't downloaded: Settings offers the download again.
        this.problem = 'The search model needs downloading again in a form this computer can run.'
      } else {
        this.broken = err instanceof Error ? err.message : String(err)
        console.warn('Finding by meaning is off: the search model could not start', this.broken)
      }
    } finally {
      // A start that came out of date (or failed) lets go of what it made.
      made?.embedder.close?.()
      if (gen === this.gen) this.starting = false
      this.deps.changed()
    }
  }

  /** The model's threads stopped after it started: started again once, then marked as not working. */
  private lost(which: Embedder | null, e: Error): void {
    if (!which || which !== this.embedder) return
    console.warn('The search model stopped', e.message)
    this.stop()
    if (this.restarts < RESTARTS) {
      this.restarts++
      void this.startSoon()
    } else {
      this.broken = `it stopped working (${e.message})`
      this.deps.changed()
    }
  }

  /** Lets go of the model and makes any start under way out of date. */
  stop(): void {
    this.gen++
    this.starting = false
    this.embedder?.close?.()
    this.embedder = null
    this.engine = null
  }

  status(indexed: SearchModelStatus['indexed'] = null): SearchModelStatus {
    const sizeMb = Math.round(SEARCH_MODEL_BYTES / 1_000_000)
    const ready = !!this.embedder
    const usable = this.usable()
    const state: SearchModelStatus['state'] = this.download
      ? 'downloading'
      : ready
        ? 'ready'
        : this.broken
          ? 'broken'
          : usable
            ? 'starting'
            : 'none'
    return {
      state,
      sizeMb,
      progress: this.download ? this.progress : null,
      problem: state === 'broken' ? `The search model isn't working (${this.broken}). Remove it and download it again.` : state === 'none' ? this.problem : null,
      indexed: ready ? indexed : null,
      engine: ready ? this.engine : null
    }
  }

  /** Starts the download (or Try again). */
  startDownload(): void {
    if (this.download || this.embedder) return
    const stop = new AbortController()
    this.download = stop
    this.progress = 0
    this.problem = null
    this.broken = null
    this.deps.changed()
    let last = 0
    const dir = this.deps.dir()
    const engine = engineToDownload(dir, this.deps.shipped?.())
    this.downloading = downloadModel(dir, {
      fetchImpl: this.deps.fetchImpl,
      signal: stop.signal,
      base: this.deps.base?.(),
      files: filesFor(engine),
      onProgress: (p) => {
        if (this.download !== stop) return
        this.progress = p.total ? p.done / p.total : null
        if (Date.now() - last > 250) {
          last = Date.now()
          this.deps.changed()
        }
      }
    }).then(
      () => {
        if (this.download !== stop) return
        this.download = null
        this.progress = null
        this.restarts = 0
        void this.startSoon()
      },
      (e: unknown) => {
        // Only the download under way says how it ended: one stopped or replaced since says nothing.
        if (this.download !== stop) return
        this.download = null
        this.progress = null
        this.problem = e instanceof DownloadStopped ? null : e instanceof Error ? e.message : String(e)
        this.deps.changed()
      }
    )
  }

  stopDownload(): void {
    this.download?.abort()
    this.download = null
    this.progress = null
    this.deps.changed()
  }

  /** Removes the downloaded model, once a download under way has let go of its files. */
  async remove(): Promise<void> {
    this.download?.abort()
    this.download = null
    this.progress = null
    const pending = this.downloading
    this.stop()
    this.broken = null
    this.problem = null
    this.restarts = 0
    await pending?.catch(() => undefined)
    try {
      removeModel(this.deps.dir())
    } catch (e) {
      this.problem = `The search model couldn't be removed (${e instanceof Error ? e.message : String(e)}). Close AI Write and try again.`
    }
    this.deps.changed()
  }

  /** "Find by meaning" turned on (start it when downloaded) or off (let go of its memory). */
  switched(on: boolean): void {
    if (!on) {
      this.stop()
      this.deps.changed()
      return
    }
    this.broken = null
    if (this.usable()) void this.startSoon()
  }

  close(): void {
    this.download?.abort()
    this.download = null
    this.stop()
  }
}
