// The memory keeper for one open world: when runs happen, one at a time, in order.
// - A save starts a 30-second quiet timer for the scene (reset by each save); leaving the scene,
//   marking it done or restoring a version of it queues a run straight away.
// - At start, scenes left behind (waiting, or "Memory not updated") are queued in reading order.
// - Runs queue per scene and a newer trigger replaces a queued one (a run always reads the latest text).
// - Before a draft, queued or failed runs for earlier scenes on the line run first (catchUpBefore).
// - When the queue is empty, summaries whose sources changed are rolled up (chapter, story, series).
// - Closing the world stops everything cleanly: nothing is written to a closed database.
// No Electron imports: the window and settings are reached through KeeperDeps (see index.ts).

import type Database from 'better-sqlite3'
import type { ID, MemoryStatus, SceneMeta } from '@shared/types'
import * as kdb from '../db/keeper'
import * as repo from '../db/repo'
import type { MemoryModel } from './model'
import { runScene, failScene, type RunOutcome } from './run'
import { askSummaryRefresh, nextRollUp, rollUpKey, sceneSummaryDue, writeRollUp, writeSceneSummary, type SummaryOptions } from './summaries'
import { summaryRefreshed } from './undo'
import { loadShapeSafe, placeWords, scenesBefore } from './places'

/** What the keeper says when there is no model to use (none for the memory keeper, and no writer model). */
export const NO_MODEL = 'Choose a writer model in Settings › Models to keep the memory up to date.'

type DB = Database.Database

export interface KeeperDeps {
  db: DB
  /** The memory model now (settings can change any time), or why there is none, in plain words. */
  model: () => MemoryModel | { error: string }
  emitStatus: (s: MemoryStatus) => void
  emitChanged: (p: { sceneId: ID | null; entryIds: ID[] }) => void
  /** How long a scene must go without a save before it is read (30 seconds). */
  quietMs?: number
  /** How often to look again for a memory model while there is none (a minute). */
  recheckMs?: number
  /** Summaries and roll-ups (on unless switched off, for tests). */
  summaries?: boolean
  /**
   * A read found someone or something new in the text (`entryIds`): told after the run has finished, so the
   * caller can fill in their empty fields as a follow-on (builder/fill.ts) that never holds up the memory.
   */
  onNewEntries?: (entryIds: ID[], model: MemoryModel) => void
  fetchImpl?: typeof fetch
  retryDelays?: number[]
}

export const QUIET_MS = 30_000
const RECHECK_MS = 60_000

export const idleStatus = (): MemoryStatus => ({ behind: 0, failed: 0, reading: null, error: null, lastUpdate: null })

export class Keeper {
  readonly db: DB
  private readonly quietMs: number
  private readonly timers = new Map<ID, ReturnType<typeof setTimeout>>()
  private recheck: ReturnType<typeof setTimeout> | null = null
  private queue: ID[] = []
  private urgent: ID[] = []
  /** Scenes marked done: their summary is refreshed after their run. */
  private readonly done = new Set<ID>()
  private summaryAsks: { sceneId: ID; logId: ID }[] = []
  private readonly dirtyStories = new Set<ID>()
  private readonly failedRollUps = new Set<string>()
  private current: { sceneId: ID; controller: AbortController; records: Set<ID> } | null = null
  private reading: MemoryStatus['reading'] = null
  private pumping: Promise<void> | null = null
  private closed = false
  private noModel: string | null = null
  private waiters: { ids: Set<ID>; resolve: () => void }[] = []
  private lastStatus = ''

  constructor(private readonly deps: KeeperDeps) {
    this.db = deps.db
    this.quietMs = deps.quietMs ?? QUIET_MS
  }

  // ---------- Triggers ----------

  /** The world opened: runs left unfinished count as stopped, and scenes left behind are read. */
  start(): void {
    if (this.closed) return
    try {
      kdb.stopUnfinishedRuns(this.db)
      for (const s of repo.listStories(this.db)) this.dirtyStories.add(s.id)
      for (const id of kdb.scenesToRead(this.db)) this.enqueue(id)
    } catch (e) {
      console.error('The memory keeper could not start', e)
    }
    this.emitStatus()
  }

  /** A save: the scene is read once there has been no save for a while. */
  sceneSaved(id: ID): void {
    if (this.closed) return
    kdb.noteSceneSaved(this.db, id)
    this.clearTimer(id)
    this.timers.set(
      id,
      setTimeout(() => {
        this.timers.delete(id)
        if (!this.closed && kdb.needsReading(this.db, id)) this.enqueue(id)
      }, this.quietMs)
    )
    this.emitStatus()
  }

  /** Adam left the scene: read it now if it changed. */
  sceneLeft(id: ID): void {
    if (this.closed) return
    this.clearTimer(id)
    if (kdb.needsReading(this.db, id)) this.enqueue(id)
  }

  /** Marked done (Ctrl+Enter): the memory and the scene's summary catch up with it now. */
  markDone(id: ID): SceneMeta {
    const meta = kdb.markSceneDone(this.db, id)
    if (!this.closed) {
      this.clearTimer(id)
      this.done.add(id)
      this.enqueue(id)
    }
    return meta
  }

  /** A version of the scene was restored: read it now. */
  sceneRestored(id: ID): void {
    if (this.closed) return
    kdb.noteSceneSaved(this.db, id)
    this.clearTimer(id)
    this.enqueue(id)
  }

  /** "Try again" (or after settings changed): reads one scene now, or every scene left behind. */
  updateNow(id?: ID): void {
    if (this.closed) return
    this.noModel = null
    if (this.recheck) clearTimeout(this.recheck)
    this.recheck = null
    if (id) {
      this.clearTimer(id)
      this.enqueue(id)
    } else for (const s of kdb.scenesToRead(this.db)) this.enqueue(s)
    this.emitStatus()
  }

  /** Adam asked for a new summary instead of his own. */
  refreshSummary(sceneId: ID, logId: ID): void {
    if (this.closed) return
    this.summaryAsks.push({ sceneId, logId })
    this.kick()
  }

  /**
   * Before a draft: runs queued or failed runs for earlier scenes on the line first. Resolves when
   * each has been tried (or at once when there is nothing to do or no memory model).
   */
  async catchUpBefore(sceneId: ID): Promise<void> {
    if (this.closed) return
    // One query for the scenes left behind, not one per earlier scene (a long series has thousands).
    const behind = new Set(kdb.scenesToRead(this.db))
    const ids = behind.size ? scenesBefore(this.db, sceneId).filter((id) => behind.has(id)) : []
    if (!ids.length) return
    if ('error' in this.deps.model()) return
    for (const id of ids) this.clearTimer(id)
    this.urgent = [...ids, ...this.urgent.filter((x) => !ids.includes(x))]
    this.queue = this.queue.filter((x) => !ids.includes(x))
    const wait = new Promise<void>((resolve) => this.waiters.push({ ids: new Set(ids), resolve }))
    this.kick()
    await wait
  }

  /**
   * Resolves once the scene's queued or running read has been tried (at once when none is; milestone 5's
   * checks wait for it, so a clash the keeper raises isn't raised by a check as well). A scene still waiting
   * out its quiet time after a save is read now.
   */
  async whenRead(sceneId: ID): Promise<void> {
    if (this.closed) return
    if (this.timers.has(sceneId)) {
      this.clearTimer(sceneId)
      if (kdb.needsReading(this.db, sceneId)) this.enqueue(sceneId)
    }
    if (this.reading?.sceneId !== sceneId && !this.queue.includes(sceneId) && !this.urgent.includes(sceneId)) return
    if ('error' in this.deps.model()) return
    await new Promise<void>((resolve) => this.waiters.push({ ids: new Set([sceneId]), resolve }))
  }

  /** The world is closing: stop now and write nothing more. Finishes the open records first (synchronously). */
  stop(): void {
    if (this.closed) return
    this.closed = true
    for (const t of this.timers.values()) clearTimeout(t)
    this.timers.clear()
    if (this.recheck) clearTimeout(this.recheck)
    this.queue = []
    this.urgent = []
    this.summaryAsks = []
    const cur = this.current
    if (cur) {
      cur.controller.abort()
      try {
        if (this.db.open) {
          for (const g of cur.records) kdb.stopRecord(this.db, g)
          kdb.stopUnfinishedRuns(this.db)
        }
      } catch (e) {
        console.error('Could not finish the memory keeper records on close', e)
      }
    }
    this.reading = null
    for (const w of this.waiters) w.resolve()
    this.waiters = []
  }

  /** Resolves when nothing is queued or running (for tests and for quitting). */
  async whenIdle(): Promise<void> {
    while (this.pumping) await this.pumping
  }

  get isClosed(): boolean {
    return this.closed
  }

  // ---------- Status ----------

  status(): MemoryStatus {
    if (this.closed || !this.db.open) return idleStatus()
    const { behind, failed } = kdb.memoryCounts(this.db)
    const failure = kdb.latestFailure(this.db)
    return {
      behind,
      failed,
      reading: this.reading,
      error: behind > 0 && this.noModel ? this.noModel : (failure?.error ?? null),
      lastUpdate: kdb.lastUpdate(this.db)
    }
  }

  private emitStatus(): void {
    if (this.closed) return
    try {
      const s = this.status()
      const key = JSON.stringify(s)
      if (key === this.lastStatus) return
      this.lastStatus = key
      this.deps.emitStatus(s)
    } catch (e) {
      console.warn('Could not send the memory status', e)
    }
  }

  // ---------- The queue ----------

  private clearTimer(id: ID): void {
    const t = this.timers.get(id)
    if (t) clearTimeout(t)
    this.timers.delete(id)
  }

  private enqueue(id: ID): void {
    if (this.closed) return
    if (!this.queue.includes(id) && !this.urgent.includes(id)) this.queue.push(id)
    this.kick()
  }

  private kick(): void {
    if (this.closed || this.pumping) return
    // Starts after the caller's own (synchronous) work, so it never runs inside the caller's transaction.
    this.pumping = Promise.resolve()
      .then(() => this.loop())
      .catch((e) => console.error('The memory keeper stopped unexpectedly', e))
      .finally(() => {
        this.pumping = null
        if (!this.closed && (this.queue.length || this.urgent.length || this.summaryAsks.length)) this.kick()
        else this.emitStatus()
      })
  }

  private async loop(): Promise<void> {
    while (!this.closed) {
      const id = this.urgent.shift() ?? this.queue.shift()
      if (id) {
        await this.runOne(id)
        continue
      }
      const ask = this.summaryAsks.shift()
      if (ask) {
        await this.writeAskedSummary(ask.sceneId, ask.logId)
        continue
      }
      if (await this.rollUpOnce()) continue
      break
    }
  }

  private settle(id: ID): void {
    for (const w of this.waiters) w.ids.delete(id)
    const ready = this.waiters.filter((w) => !w.ids.size)
    this.waiters = this.waiters.filter((w) => w.ids.size)
    for (const w of ready) w.resolve()
  }

  private giveUpWaiting(): void {
    for (const w of this.waiters) w.resolve()
    this.waiters = []
  }

  private summaryOptions(model: MemoryModel, controller: AbortController, records: Set<ID>): SummaryOptions {
    return {
      db: this.db,
      model,
      signal: controller.signal,
      closed: () => this.closed,
      onRecord: (g) => records.add(g),
      fetchImpl: this.deps.fetchImpl,
      retryDelays: this.deps.retryDelays
    }
  }

  private where(sceneId: ID): string {
    const s = kdb.keeperScene(this.db, sceneId)
    return s ? placeWords(this.db, loadShapeSafe(this.db), { storyId: s.storyId, chapterId: s.chapterId, sceneId }) : ''
  }

  private async runOne(id: ID): Promise<void> {
    const m = this.deps.model()
    const model = 'error' in m ? null : m
    const controller = new AbortController()
    const records = new Set<ID>()
    this.current = { sceneId: id, controller, records }
    const scene = kdb.keeperScene(this.db, id)
    let outcome: RunOutcome
    try {
      outcome = await runScene(
        {
          db: this.db,
          model,
          signal: controller.signal,
          closed: () => this.closed,
          onReading: () => {
            this.reading = { sceneId: id, title: scene?.title ?? '' }
            this.emitStatus()
          },
          onRecord: (g) => records.add(g),
          fetchImpl: this.deps.fetchImpl,
          retryDelays: this.deps.retryDelays
        },
        id
      )
    } catch (e) {
      console.error('The memory keeper could not read a scene', e)
      if (this.closed || !this.db.open) outcome = { status: 'stopped' }
      else {
        const reason = `Something went wrong (${String((e as Error)?.message ?? e).replace(/[.!?]+$/, '')}), so it will try again`
        outcome = failScene(this.db, id, null, this.where(id), reason, null)
      }
    }
    this.reading = null
    if (this.closed) return
    // Milestone 6: a read stopped part way because the model can no longer be used (this month's AI spending
    // reached Adam's limit) waits as with no model, with the reason in the note, rather than without a word.
    let asNow = m
    if (outcome.status === 'stopped' && this.db.open) {
      const now = this.deps.model()
      if ('error' in now) {
        outcome = { status: 'no-model' }
        asNow = now
      }
    }
    try {
      await this.after(id, outcome, model, controller, records, asNow)
    } catch (e) {
      console.error('The memory keeper could not finish after reading a scene', e)
    }
    this.current = null
    this.settle(id)
    this.emitStatus()
  }

  private async after(
    id: ID,
    outcome: RunOutcome,
    model: MemoryModel | null,
    controller: AbortController,
    records: Set<ID>,
    m: MemoryModel | { error: string }
  ): Promise<void> {
    switch (outcome.status) {
      case 'no-model':
        // Everything waits until there is a memory model; scenes stay "waiting" (not failed).
        this.noModel = 'error' in m ? m.error : NO_MODEL
        this.queue = []
        this.urgent = []
        this.giveUpWaiting()
        if (!this.recheck) {
          this.recheck = setTimeout(() => {
            this.recheck = null
            if (!this.closed && !('error' in this.deps.model())) this.updateNow()
          }, this.deps.recheckMs ?? RECHECK_MS)
        }
        return
      case 'failed':
        this.deps.emitChanged({ sceneId: id, entryIds: [] })
        return
      case 'done':
      case 'nothing': {
        if (outcome.status === 'done') {
          this.noModel = null
          if (outcome.lines || outcome.entryIds.length) this.deps.emitChanged({ sceneId: id, entryIds: outcome.entryIds })
          if (model && outcome.newEntryIds?.length) {
            try {
              this.deps.onNewEntries?.(outcome.newEntryIds, model)
            } catch (e) {
              console.warn('Could not start filling in what the memory found', e)
            }
          }
          if (outcome.runId && outcome.readParagraphs > 0 && askSummaryRefresh(this.db, outcome.runId, id))
            this.deps.emitChanged({ sceneId: id, entryIds: [] })
        }
        const scene = kdb.keeperScene(this.db, id)
        if (scene) this.dirtyStories.add(scene.storyId)
        const done = this.done.has(id)
        this.done.delete(id)
        if (this.deps.summaries === false || !model || !scene) return
        if (!sceneSummaryDue(this.db, id, done)) return
        const logRunId = outcome.status === 'done' && outcome.lines ? outcome.runId : null
        if (await writeSceneSummary(this.summaryOptions(model, controller, records), id, logRunId, this.where(id))) {
          this.deps.emitChanged({ sceneId: id, entryIds: [] })
        }
        return
      }
      default:
        return
    }
  }

  private async writeAskedSummary(sceneId: ID, logId: ID): Promise<void> {
    const m = this.deps.model()
    if ('error' in m) return
    const controller = new AbortController()
    const records = new Set<ID>()
    this.current = { sceneId, controller, records }
    try {
      if (await writeSceneSummary(this.summaryOptions(m, controller, records), sceneId, null, this.where(sceneId), true)) {
        if (!this.closed) {
          this.db.transaction(() => summaryRefreshed(this.db, logId))()
          this.deps.emitChanged({ sceneId, entryIds: [] })
        }
      }
    } finally {
      if (!this.closed) this.current = null
    }
  }

  /** Writes one roll-up whose sources changed; false when there is none (or no model, or scenes waiting). */
  private async rollUpOnce(): Promise<boolean> {
    if (this.deps.summaries === false || !this.dirtyStories.size || this.queue.length || this.urgent.length) return false
    const m = this.deps.model()
    if ('error' in m) return false
    const shape = loadShapeSafe(this.db)
    const label = (place: { storyId: ID; chapterId?: ID | null }): string => placeWords(this.db, shape, place)
    const r = nextRollUp(this.db, this.dirtyStories, label, m, (key) => this.failedRollUps.has(key))
    if (!r) {
      this.dirtyStories.clear()
      return false
    }
    const controller = new AbortController()
    const records = new Set<ID>()
    this.current = { sceneId: r.targetId, controller, records }
    try {
      if (await writeRollUp(this.summaryOptions(m, controller, records), r)) this.deps.emitChanged({ sceneId: null, entryIds: [] })
      else this.failedRollUps.add(rollUpKey(r))
    } finally {
      if (!this.closed) this.current = null
    }
    return !this.closed
  }
}
