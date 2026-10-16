// The memory keeper for one open world: when runs happen, one at a time, in order.
// - A save starts a 30-second quiet timer for the scene (reset by each save); leaving the scene,
//   marking it done or restoring a version of it queues a run straight away.
// - At start, scenes left behind (waiting, or "Memory not updated") are queued in reading order.
// - Runs queue per scene and a newer trigger replaces a queued one (a run always reads the latest text).
// - Before a draft, queued or failed runs for earlier scenes on the line run first (catchUpBefore), then the scene's
//   own unread words are read, waiting a few seconds at most (beforeDraft; World Memory Overhaul A6, 2026-10-08).
// - Summaries of earlier scenes that are due (the scene changed enough since) are brought up to date after a draft
//   asks for the memory (A3), before roll-ups. The ones the briefing can't do without (the scene just before, and any
//   recent scene with no summary yet, which the timeline would leave out) are written first, and the draft waits for
//   them, within the time it waits for the memory at all (Adam, 2026-10-15: "Write the whole chapter" drafted the next
//   scene before the last one's summary was written).
// - The first time a world opens with this version, its memory is tidied once against the text (tidy.ts, A7).
// - When the queue is empty, each chapter's end-of-chapter snapshot whose record changed is worked out again from the
//   record (no AI, a few at a time: snapshots.ts), roll-ups made from sources that changed since are marked out of date,
//   and they are rolled up (chapter, story, series) from the level below and the record (long story memory fix 15).
// - A scene summary that is due is marked out of date first (the screen says it is being brought up to date), then
//   written again from the scene's words, never patched (fix 15). Nothing keeps that mark with nothing to clear it
//   (fix 15 review): a summary marked out of date when the world opens is brought up to date from a backlog, one at a
//   time and BACKLOG_GAP_MS apart while there is nothing else to do; a write that fails is tried again after a minute,
//   then two, four... and given up (its mark cleared) after RETRY_TRIES tries; one no longer needed is cleared.
// - Adam's own edits to the record (a change, an undo, a scene card, a scene moved: recordEdited) bring the snapshots
//   and roll-ups resting on them up to date too, as a read does; so does anything in a story the books after it read.
// - A draft waits for the summaries it can't do without no longer than it waits for the memory at all (beforeDraft's
//   `limitMs`); they go on being written in the background.
// - After each read, where things stand as the scene ends is brought up to date as a follow-on (onSceneRead).
// - Closing the world stops everything cleanly: nothing is written to a closed database.
// No Electron imports: the window and settings are reached through KeeperDeps (see index.ts).

import type Database from 'better-sqlite3'
import type { ID, MemoryStatus, SceneMeta } from '@shared/types'
import * as kdb from '../db/keeper'
import * as repo from '../db/repo'
import type { MemoryModel } from './model'
import { runScene, failScene, type RunOutcome } from './run'
import {
  askSummaryRefresh,
  markOutOfDate,
  nextRollUp,
  rollUpKey,
  sceneSummaryDue,
  writeRollUp,
  writeSceneSummary,
  type SummaryOptions
} from './summaries'
import { refreshSnapshots, storiesReading } from './snapshots'
import { DUE_SUMMARY_SCENES } from './sceneChange'
import { summaryRefreshed } from './undo'
import { loadShapeSafe, placeWords, scenesBefore } from './places'
import { tidyOnce } from './tidy'

/** What a draft waiting for a scene's summary waits on (beside the scene ids a read is waited for by). */
const summaryWait = (sceneId: ID): ID => `summary:${sceneId}`

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
  /**
   * A scene was read (new words or not): told after the run, so where things stand as it ends can be brought up to
   * date as a follow-on (continuity/tracker.ts) that never holds up the memory.
   */
  onSceneRead?: (sceneId: ID, model: MemoryModel) => void
  fetchImpl?: typeof fetch
  retryDelays?: number[]
  /** Between two summaries from the backlog (BACKLOG_GAP_MS), and before a failed one is tried again (RETRY_FIRST_MS): for tests. */
  backlogGapMs?: number
  retryFirstMs?: number
}

export const QUIET_MS = 30_000
const RECHECK_MS = 60_000
/** How long the AI waits for the scene's own unread words to be read before it writes (World Memory Overhaul A6). */
export const FRESH_READ_MS = 8_000
/**
 * The longest a draft waits for the summaries it can't do without, unless it says otherwise: as long as it waits for the
 * memory at all (ai/gather.ts CATCH_UP_LIMIT_MS; "Write the whole chapter" waits longer). They go on being written after.
 */
export const SUMMARY_WAIT_MS = 60_000
/**
 * Between two summaries brought up to date from the backlog (those marked out of date when the world opened: a world
 * from before long story memory fix 15, a write that didn't happen), so opening a world never sends a burst of calls.
 */
export const BACKLOG_GAP_MS = 20_000
/** A summary or roll-up that couldn't be written is tried again after a minute, then two, four..., RETRY_TRIES times in all. */
export const RETRY_FIRST_MS = 60_000
export const RETRY_TRIES = 6

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
  /** Scenes whose summary is due (A3), written once nothing is waiting to be read. */
  private summaryDue: ID[] = []
  /** Scenes whose summary a draft is waiting for (summariesFirst), written before any other summary. */
  private summaryNow: ID[] = []
  private readonly dirtyStories = new Set<ID>()
  /** Stories whose end-of-chapter snapshots may be out of date (fix 15), brought up to date before their roll-ups. */
  private readonly recordStories = new Set<ID>()
  /** Scene summaries marked out of date before, brought up to date one at a time when there is nothing else to do. */
  private backlog: ID[] = []
  private nextBacklogAt = 0
  /**
   * Summaries (`scene:<id>`) and roll-ups (rollUpKey) that couldn't be written: when to try again, how often they failed,
   * and the scene or stories to look at then; `given` once RETRY_TRIES have failed (until Try again, or the sources change).
   */
  private readonly retries = new Map<string, { tries: number; at: number; given?: true; sceneId?: ID; stories?: ID[] }>()
  private wakeTimer: ReturnType<typeof setTimeout> | null = null
  private wakeAt = Infinity
  private current: { sceneId: ID; controller: AbortController; records: Set<ID> } | null = null
  private reading: MemoryStatus['reading'] = null
  private pumping: Promise<void> | null = null
  /** A big world's first tidy-up (tidy.ts) is going on, a few scenes at a time: nothing is read until it is done. */
  private tidying: Promise<void> | null = null
  private closed = false
  private noModel: string | null = null
  private waiters: { ids: Set<ID>; resolve: () => void }[] = []
  private lastStatus = ''
  /** Scenes Adam asked to have read again in full (B8), until each has been read; and how many he asked for at once. */
  private readonly rereads = new Set<ID>()
  private rereadTotal = 0

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
      // Once per world (World Memory Overhaul A7): every link checked against the text as it is now, no model asked.
      // A big world is tidied a few scenes at a time (so opening it doesn't freeze); scenes are read once it is done.
      let tidy: boolean | Promise<boolean> = false
      try {
        tidy = tidyOnce(this.db, { closed: () => this.closed })
      } catch (e) {
        console.warn('Could not tidy the memory', e)
      }
      if (typeof tidy === 'boolean') {
        if (tidy) this.deps.emitChanged({ sceneId: null, entryIds: [] })
        this.queueLeftBehind()
      } else {
        this.tidying = tidy
          .then((changed) => {
            if (changed && !this.closed) this.deps.emitChanged({ sceneId: null, entryIds: [] })
          })
          .catch((e) => console.warn('Could not tidy the memory', e))
          .finally(() => {
            this.tidying = null
            if (this.closed) return
            try {
              this.queueLeftBehind()
            } catch (e) {
              console.error('The memory keeper could not start', e)
            }
            this.kick()
            this.emitStatus()
          })
      }
    } catch (e) {
      console.error('The memory keeper could not start', e)
    }
    this.emitStatus()
  }

  /**
   * At start: every story's roll-ups are looked at, and scenes left behind are queued. Its end-of-chapter snapshots
   * (fix 15) are looked at straight away, a few at a time, so a world from before them has them soon after it opens.
   */
  private queueLeftBehind(): void {
    for (const s of repo.listStories(this.db)) {
      this.dirtyStories.add(s.id)
      this.recordStories.add(s.id)
    }
    for (const id of kdb.scenesToRead(this.db)) this.enqueue(id)
    this.fillBacklog()
    if (this.recordStories.size || this.backlog.length) this.kick()
  }

  /** Every scene whose summary the memory wrote is marked out of date, to be brought up to date from the backlog. */
  private fillBacklog(): void {
    if (this.deps.summaries === false) return
    try {
      for (const id of kdb.staleSceneSummaries(this.db)) if (!this.backlog.includes(id)) this.backlog.push(id)
    } catch (e) {
      console.warn('Could not tell which summaries are out of date', e)
    }
  }

  /**
   * Adam changed the story record by hand (a change, an undo or an answer in What changed, a scene card, a scene moved or
   * deleted, an entry, where a story sits; long story memory fix 15 review): the end-of-chapter snapshots and roll-ups of
   * these stories, and of the stories that read them, are looked at again while the keeper has nothing to read, as after
   * a read. Every story when none are named.
   */
  recordEdited(storyIds?: ID[]): void {
    if (this.closed) return
    try {
      for (const id of storyIds ?? repo.listStories(this.db).map((s) => s.id)) this.storyChanged(id)
    } catch (e) {
      console.warn('Could not tell which stories an edit touches', e)
    }
    this.kick()
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
    // Whatever failed or was given up is tried again, and summaries marked out of date meanwhile (while there was no
    // model, say) go back on the backlog.
    this.retries.clear()
    this.fillBacklog()
    if (id) {
      this.clearTimer(id)
      this.enqueue(id)
    } else for (const s of [...kdb.scenesToRead(this.db), ...this.rereads]) this.enqueue(s)
    this.emitStatus()
  }

  /**
   * "Check again now" (World Memory Overhaul B2): reads this scene again soon, for facts whose words were edited and are
   * still unconfirmed, though its text hasn't changed since the last read. The read asks the model only about those
   * facts' paragraphs, and nothing at all when nothing in the scene is unsure.
   */
  checkAgain(id: ID): void {
    if (this.closed) return
    kdb.markNeedsReading(this.db, id)
    this.updateNow(id)
  }

  /**
   * "Re-read this scene" / "Re-read the whole story" (World Memory Overhaul B8): these scenes are read again in full,
   * every paragraph, though their text hasn't changed, in the order given, through the usual queue (one at a time; the
   * spending limit holds them as it holds any read). Facts already read are told to the model so they aren't added
   * twice; what it says anew is applied under the usual rules.
   */
  reread(ids: ID[]): void {
    if (this.closed || !ids.length) return
    if (!this.rereads.size) this.rereadTotal = 0
    for (const id of ids) {
      if (this.rereads.has(id)) continue
      this.rereads.add(id)
      this.rereadTotal++
      this.clearTimer(id)
      this.enqueue(id)
    }
    this.emitStatus()
  }

  /** Stop re-reading (B8): the scenes still waiting are dropped and the one being read now stops (nothing applied). */
  stopReread(): void {
    if (this.closed || !this.rereads.size) return
    const ids = [...this.rereads]
    this.rereads.clear()
    this.rereadTotal = 0
    const drop = new Set(ids)
    // A scene also waiting for its own new words stays queued for those.
    this.queue = this.queue.filter((x) => !drop.has(x) || kdb.needsReading(this.db, x))
    if (this.current && drop.has(this.current.sceneId) && !kdb.needsReading(this.db, this.current.sceneId)) this.current.controller.abort()
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
   * each has been tried (or at once when there is nothing to do or no memory model). Earlier scenes
   * whose summary is now due (World Memory Overhaul A3) are queued to be brought up to date meanwhile;
   * the writer is told the old one is being updated until then.
   */
  async catchUpBefore(sceneId: ID): Promise<void> {
    const before = await this.catchUpEarlier(sceneId)
    if (before) this.queueDueSummaries(before)
  }

  /** Runs queued or failed runs for earlier scenes on the line; the earlier scenes, or null when nothing more is to be done. */
  private async catchUpEarlier(sceneId: ID): Promise<ID[] | null> {
    if (this.closed) return null
    // One query for the scenes left behind, not one per earlier scene (a long series has thousands).
    const behind = new Set(kdb.scenesToRead(this.db))
    const before = scenesBefore(this.db, sceneId)
    const ids = behind.size ? before.filter((id) => behind.has(id)) : []
    if ('error' in this.deps.model()) return null
    if (ids.length) {
      for (const id of ids) this.clearTimer(id)
      this.urgent = [...ids, ...this.urgent.filter((x) => !ids.includes(x))]
      this.queue = this.queue.filter((x) => !ids.includes(x))
      const wait = new Promise<void>((resolve) => this.waiters.push({ ids: new Set(ids), resolve }))
      this.kick()
      await wait
    }
    return before
  }

  /**
   * Reads the scene's unread words now, rather than after the quiet time (World Memory Overhaul A6): the read that
   * would have happened anyway, only sooner. Waits up to `limitMs`, then goes ahead (the read finishes on its own).
   */
  async readNow(sceneId: ID, limitMs = FRESH_READ_MS): Promise<'read' | 'timed-out' | 'none'> {
    if (this.closed) return 'none'
    this.clearTimer(sceneId)
    const busy = this.reading?.sceneId === sceneId || this.queue.includes(sceneId) || this.urgent.includes(sceneId)
    if (!busy && !kdb.needsReading(this.db, sceneId)) return 'none'
    if ('error' in this.deps.model()) return 'none'
    if (this.reading?.sceneId !== sceneId) {
      this.queue = this.queue.filter((x) => x !== sceneId)
      this.urgent = [...this.urgent.filter((x) => x !== sceneId), sceneId]
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    const read = new Promise<'read'>((resolve) => this.waiters.push({ ids: new Set([sceneId]), resolve: () => resolve('read') }))
    const late = new Promise<'timed-out'>((resolve) => {
      timer = setTimeout(() => resolve('timed-out'), limitMs)
    })
    this.kick()
    try {
      return await Promise.race([read, late])
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * Before the AI writes in a scene (Generate, Add below, Continue, a beat): earlier scenes first (catchUpBefore), then
   * the scene's own unread words (readNow, up to `readMs`). Summaries of earlier scenes that are due are queued only
   * after that, so a summary job never holds up the scene's own fresh read.
   */
  async beforeDraft(sceneId: ID, readMs = FRESH_READ_MS, limitMs = SUMMARY_WAIT_MS): Promise<void> {
    const until = Date.now() + limitMs
    const before = await this.catchUpEarlier(sceneId)
    try {
      await this.readNow(sceneId, readMs)
      if (before) await this.summariesFirst(before, until - Date.now())
    } finally {
      if (before) this.queueDueSummaries(before)
    }
  }

  /**
   * The earlier scenes whose summary a draft can't do without (2026-10-15): the scene just before, when its summary is
   * due (none yet, or the scene changed enough since), and any of the most recent scenes with no summary at all (the
   * timeline can only say "no summary yet" of those). Adam's own summaries are never due.
   */
  private summariesNeeded(before: ID[]): ID[] {
    if (this.closed || this.deps.summaries === false) return []
    const recent = before.slice(-DUE_SUMMARY_SCENES)
    try {
      return recent.filter(
        (id, i) => sceneSummaryDue(this.db, id, false) && (i === recent.length - 1 || !kdb.summaryRow(this.db, 'scene', id))
      )
    } catch (e) {
      console.warn('Could not tell which summaries a draft needs', e)
      return []
    }
  }

  /**
   * Writes the summaries a draft can't do without (summariesNeeded) before any other, and resolves once each was tried, or
   * after `limitMs` (each is a call on a whole scene: review, 2026-10-16); they go on being written in the background.
   */
  private async summariesFirst(before: ID[], limitMs = SUMMARY_WAIT_MS): Promise<void> {
    const ids = this.summariesNeeded(before)
    if (!ids.length || 'error' in this.deps.model()) return
    for (const id of ids) this.markRebuilding(id)
    this.summaryDue = this.summaryDue.filter((x) => !ids.includes(x))
    for (const id of ids) if (!this.summaryNow.includes(id)) this.summaryNow.push(id)
    const wait = new Promise<void>((resolve) => this.waiters.push({ ids: new Set(ids.map(summaryWait)), resolve }))
    this.kick()
    let timer: ReturnType<typeof setTimeout> | undefined
    const late = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, Math.max(0, limitMs))
    })
    try {
      await Promise.race([wait, late])
    } finally {
      clearTimeout(timer)
    }
  }

  /** Earlier scenes (the most recent few) whose summary is due: written once nothing is waiting to be read. */
  private queueDueSummaries(before: ID[]): void {
    if (this.closed || this.deps.summaries === false) return
    try {
      for (const id of before.slice(-DUE_SUMMARY_SCENES)) {
        if (!this.summaryDue.includes(id) && sceneSummaryDue(this.db, id, false)) {
          this.summaryDue.push(id)
          this.markRebuilding(id)
        }
      }
    } catch (e) {
      console.warn('Could not tell which summaries are due', e)
    }
    if (this.summaryDue.length) this.kick()
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

  /**
   * Milestone 6, the import catch-up's Stop: these scenes' queued reads are dropped and one being read now is
   * stopped (its run ends as stopped, nothing applied). Anyone waiting for them is let go.
   */
  forget(ids: ID[]): void {
    if (this.closed || !ids.length) return
    const drop = new Set(ids)
    this.queue = this.queue.filter((x) => !drop.has(x))
    this.urgent = this.urgent.filter((x) => !drop.has(x))
    if (this.current && drop.has(this.current.sceneId)) this.current.controller.abort()
    for (const id of ids) this.settle(id)
    this.emitStatus()
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
    this.summaryDue = []
    this.summaryNow = []
    this.recordStories.clear()
    this.backlog = []
    this.retries.clear()
    if (this.wakeTimer) clearTimeout(this.wakeTimer)
    this.wakeTimer = null
    this.rereads.clear()
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
    while (this.tidying || this.pumping) await (this.tidying ?? this.pumping)
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
      error: (behind > 0 || this.rereads.size > 0) && this.noModel ? this.noModel : (failure?.error ?? null),
      lastUpdate: kdb.lastUpdate(this.db),
      // A re-read Adam asked for (B8): how many scenes are still to be read, of how many.
      ...(this.rereads.size ? { rereading: { left: this.rereads.size, total: Math.max(this.rereadTotal, this.rereads.size) } } : {})
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
    if (this.closed || this.pumping || this.tidying) return
    // Starts after the caller's own (synchronous) work, so it never runs inside the caller's transaction.
    this.pumping = Promise.resolve()
      .then(() => this.loop())
      .catch((e) => console.error('The memory keeper stopped unexpectedly', e))
      .finally(() => {
        this.pumping = null
        if (!this.closed && (this.queue.length || this.urgent.length || this.summaryNow.length || this.summaryAsks.length || this.summaryDue.length))
          this.kick()
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
      const first = this.summaryNow.shift()
      if (first) {
        try {
          await this.writeDueSummary(first)
        } finally {
          this.settle(summaryWait(first))
        }
        continue
      }
      const ask = this.summaryAsks.shift()
      if (ask) {
        await this.writeAskedSummary(ask.sceneId, ask.logId)
        continue
      }
      const due = this.summaryDue.shift()
      if (due) {
        await this.writeDueSummary(due)
        continue
      }
      if (await this.snapshotsOnce()) continue
      if (await this.rollUpOnce()) continue
      if (await this.backlogOnce()) continue
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
    // Read in full when Adam asked for it to be read again (B8).
    const whole = this.rereads.has(id)
    let outcome: RunOutcome
    try {
      outcome = await runScene(
        {
          db: this.db,
          model,
          whole,
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
    // A re-read is done once the scene has been read (or tried, or is gone); one waiting for a model stays asked for.
    if (whole && outcome.status !== 'no-model') this.rereads.delete(id)
    if (!this.rereads.size) this.rereadTotal = 0
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
        if (scene) this.storyChanged(scene.storyId)
        if (model && scene)
          try {
            this.deps.onSceneRead?.(id, model)
          } catch (e) {
            console.warn('Could not start bringing where things stand up to date', e)
          }
        const done = this.done.has(id)
        this.done.delete(id)
        if (this.deps.summaries === false || !model || !scene) return
        if (!sceneSummaryDue(this.db, id, done)) return
        this.markRebuilding(id)
        const logRunId = outcome.status === 'done' && outcome.lines ? outcome.runId : null
        if (await writeSceneSummary(this.summaryOptions(model, controller, records), id, logRunId, this.where(id))) {
          this.retries.delete(`scene:${id}`)
          this.deps.emitChanged({ sceneId: id, entryIds: [] })
        } else this.summaryFailed(id)
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
          const scene = kdb.keeperScene(this.db, sceneId)
          if (scene) this.storyChanged(scene.storyId)
          this.deps.emitChanged({ sceneId, entryIds: [] })
        }
      }
    } finally {
      if (!this.closed) this.current = null
    }
  }

  /** Writes a scene's summary again from its words, if it is still due (never a patch of the old one: fix 15). */
  private async writeDueSummary(sceneId: ID): Promise<void> {
    const m = this.deps.model()
    if ('error' in m || !sceneSummaryDue(this.db, sceneId, false)) return
    this.markRebuilding(sceneId)
    const controller = new AbortController()
    const records = new Set<ID>()
    this.current = { sceneId, controller, records }
    try {
      if (await writeSceneSummary(this.summaryOptions(m, controller, records), sceneId, null, this.where(sceneId))) {
        this.retries.delete(`scene:${sceneId}`)
        const scene = kdb.keeperScene(this.db, sceneId)
        if (scene) this.storyChanged(scene.storyId)
        if (!this.closed) this.deps.emitChanged({ sceneId, entryIds: [] })
      } else this.summaryFailed(sceneId)
    } finally {
      if (!this.closed) this.current = null
    }
  }

  /**
   * Something a story's summaries rest on changed: its snapshots are looked at, then its roll-ups; and those of every
   * story whose line reads it (the books after it), whose record rests on its (fix 15 review).
   */
  private storyChanged(storyId: ID): void {
    let ids = [storyId]
    try {
      const shape = loadShapeSafe(this.db)
      if (shape) ids = storiesReading(shape, storyId)
    } catch (e) {
      console.warn('Could not tell which stories read this one', e)
    }
    for (const id of ids) {
      this.dirtyStories.add(id)
      this.recordStories.add(id)
    }
  }

  /** A roll-up waiting to be tried again after it failed, or given up: not tried now. */
  private readonly waiting = (key: string): boolean => {
    const r = this.retries.get(key)
    return !!r && (!!r.given || r.at > Date.now())
  }

  /** A roll-up the keeper has stopped trying to write: not marked out of date, as nothing would bring it up to date. */
  private readonly givenUp = (key: string): boolean => !!this.retries.get(key)?.given

  /**
   * Something couldn't be written: it is tried again after a minute, then two, four... (RETRY_FIRST_MS), and given up
   * after RETRY_TRIES tries (until Try again, or what it is made from changes). True when it was given up.
   */
  private failed(key: string, about: { sceneId?: ID; stories?: ID[] }): boolean {
    const tries = (this.retries.get(key)?.tries ?? 0) + 1
    if (tries >= RETRY_TRIES) {
      this.retries.set(key, { tries, at: Infinity, given: true, ...about })
      return true
    }
    const wait = (this.deps.retryFirstMs ?? RETRY_FIRST_MS) * 2 ** (tries - 1)
    this.retries.set(key, { tries, at: Date.now() + wait, ...about })
    this.wakeIn(wait)
    return false
  }

  /**
   * A scene's summary couldn't be written: tried again later while it is still due; once given up, its mark that it is
   * being brought up to date goes, as nothing would clear it (the writer is still told it is out of date: summaryDue).
   */
  private summaryFailed(sceneId: ID): void {
    if (this.closed || !this.db.open) return
    try {
      if (!sceneSummaryDue(this.db, sceneId, false)) {
        this.retries.delete(`scene:${sceneId}`)
        return
      }
      if (this.failed(`scene:${sceneId}`, { sceneId })) {
        kdb.setTextSummaryStale(this.db, 'scene', sceneId, false)
        this.deps.emitChanged({ sceneId, entryIds: [] })
      }
    } catch (e) {
      console.warn('Could not note a summary that failed', e)
    }
  }

  /** Looks at the queues again in `ms` (a backlog summary's turn, or something failed tried again), whichever is first. */
  private wakeIn(ms: number): void {
    if (this.closed) return
    const at = Date.now() + Math.max(0, ms)
    if (this.wakeTimer && this.wakeAt <= at) return
    if (this.wakeTimer) clearTimeout(this.wakeTimer)
    this.wakeAt = at
    this.wakeTimer = setTimeout(
      () => {
        this.wakeTimer = null
        this.wakeAt = Infinity
        if (this.closed) return
        this.retryDue()
        this.kick()
      },
      Math.max(0, ms)
    )
  }

  /** What failed and is due to be tried again goes back on its queue; the next try still to come wakes the keeper then. */
  private retryDue(): void {
    const now = Date.now()
    let next = Infinity
    for (const r of this.retries.values()) {
      if (r.given) continue
      if (r.at > now) {
        next = Math.min(next, r.at)
        continue
      }
      if (r.sceneId && !this.summaryDue.includes(r.sceneId)) this.summaryDue.push(r.sceneId)
      for (const id of r.stories ?? []) this.dirtyStories.add(id)
    }
    if (next < Infinity) this.wakeIn(next - now)
  }

  /**
   * One scene from the backlog (summaries marked out of date when the world opened), written again from its words when
   * there is nothing else to do, BACKLOG_GAP_MS after the last; one no longer due just loses its mark. False when there
   * is none, its turn hasn't come (the keeper wakes for it then), or there is no model.
   */
  private async backlogOnce(): Promise<boolean> {
    if (this.closed || this.deps.summaries === false || !this.backlog.length || this.queue.length || this.urgent.length) return false
    if ('error' in this.deps.model()) return false
    const wait = this.nextBacklogAt - Date.now()
    if (wait > 0) {
      this.wakeIn(wait)
      return false
    }
    const id = this.backlog.shift()!
    this.nextBacklogAt = Date.now() + (this.deps.backlogGapMs ?? BACKLOG_GAP_MS)
    await this.writeDueSummary(id)
    return !this.closed
  }

  /**
   * A scene's summary is due: it is marked out of date until it is written again from the scene's words (fix 15), so the
   * scene card and the Context tab say it is being brought up to date. Adam's own are never marked.
   */
  private markRebuilding(sceneId: ID): void {
    try {
      const row = kdb.summaryRow(this.db, 'scene', sceneId)
      if (!row || row.origin === 'adam' || row.stale || !row.text.trim()) return
      kdb.markTextSummaryStale(this.db, 'scene', sceneId)
      this.deps.emitChanged({ sceneId, entryIds: [] })
    } catch (e) {
      console.warn('Could not mark a summary as being brought up to date', e)
    }
  }

  /**
   * Brings the end-of-chapter snapshots of one story whose record changed up to date, a few at a time (fix 15: no AI),
   * then marks which of its roll-ups are out of date. False when there is nothing to do (or scenes are waiting to be read).
   */
  private async snapshotsOnce(): Promise<boolean> {
    if (this.closed || this.deps.summaries === false || !this.recordStories.size || this.queue.length || this.urgent.length) return false
    const storyId = this.recordStories.values().next().value as ID
    let more = false
    try {
      more = refreshSnapshots(this.db, storyId).more
      if (!more && markOutOfDate(this.db, storyId, this.givenUp)) this.deps.emitChanged({ sceneId: null, entryIds: [] })
    } catch (e) {
      console.warn('Could not bring the end-of-chapter snapshots up to date', e)
      more = false
    }
    if (!more) this.recordStories.delete(storyId)
    // Lets anything waiting (a save, the window) go first before the next few.
    await new Promise<void>((resolve) => setImmediate(resolve))
    return !this.closed
  }

  /** Writes one roll-up whose sources changed; false when there is none (or no model, or scenes waiting). */
  private async rollUpOnce(): Promise<boolean> {
    if (this.deps.summaries === false || !this.dirtyStories.size || this.queue.length || this.urgent.length) return false
    const m = this.deps.model()
    if ('error' in m) return false
    const shape = loadShapeSafe(this.db)
    const label = (place: { storyId: ID; chapterId?: ID | null }): string => placeWords(this.db, shape, place)
    const r = nextRollUp(this.db, this.dirtyStories, label, m, this.waiting)
    if (!r) {
      this.dirtyStories.clear()
      return false
    }
    const controller = new AbortController()
    const records = new Set<ID>()
    this.current = { sceneId: r.targetId, controller, records }
    try {
      const stories = r.place.storyId ? [r.place.storyId] : [...this.dirtyStories]
      if (await writeRollUp(this.summaryOptions(m, controller, records), r)) {
        this.retries.delete(rollUpKey(r))
        // What rests on it (the story's roll-up, the series') is out of date now, until it is written again in turn.
        try {
          if (!this.closed) for (const id of this.dirtyStories) markOutOfDate(this.db, id, this.givenUp)
        } catch (e) {
          console.warn('Could not mark which summaries are out of date', e)
        }
        this.deps.emitChanged({ sceneId: null, entryIds: [] })
      } else if (!this.closed && this.failed(rollUpKey(r), { stories })) {
        // Given up: no longer said to be being brought up to date.
        try {
          for (const id of stories) if (markOutOfDate(this.db, id, this.givenUp)) this.deps.emitChanged({ sceneId: null, entryIds: [] })
        } catch (e) {
          console.warn('Could not mark which summaries are out of date', e)
        }
      }
    } finally {
      if (!this.closed) this.current = null
    }
    return !this.closed
  }
}
