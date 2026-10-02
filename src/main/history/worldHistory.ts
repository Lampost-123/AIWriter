// One open world's history: when its scenes' snapshots are taken, their drafts, and what happens
// while its history.db can't be used. index.ts connects it to the open world, the saves and the
// window; store.ts holds the SQL. No Electron imports, so it is tested on its own.
//
// When snapshots are taken:
//   - before every AI change goes into the page (the interface calls takeSnapshot);
//   - when a scene is marked done (sceneMarkedDone);
//   - while writing: a save 10 minutes or more after the scene's latest snapshot takes one, and a
//     scene's very first save takes its first (sceneTextSaved). Nothing is taken while a draft is
//     being written into the scene: the snapshot before it came first.
// History is a convenience: none of this ever throws, and a save never waits for it.

import type Database from 'better-sqlite3'
import type { ID } from '@shared/types'
import type {
  DraftInfo,
  DraftText,
  PageNow,
  SceneDrafts,
  SceneHistory,
  Snapshot,
  SnapshotInfo,
  TakeSnapshotInput
} from '@shared/contracts/history'
import * as repo from '../db/repo'
import { anyKeeperScene } from '../db/keeper'
import { UserError } from '../util'
import { HistoryStore, type SnapshotInput, type TakeResult } from './store'
import { freshStartOf, isBusy, isDamaged, openHistory, problemOf, startAfresh, type HistoryProblem, type OpenedHistory } from './open'

type DB = Database.Database

/** Writing keeps a snapshot at most this often. */
export const WRITING_EVERY_MS = 10 * 60_000
/** A history.db that couldn't be opened is tried again after this long. */
export const RETRY_MS = 30_000
/** For this long after History had to start afresh, the History page says so. */
const NOTICE_DAYS = 30
/** A scene gone for good (emptied from the Trash) has its history forgotten once nothing of it was written for this long. */
const FORGET_GONE_DAYS = 60
const DAY_MS = 86_400_000

/** What Adam reads while History can't be used, with what happens next. */
export const PROBLEM_TEXT: Record<HistoryProblem, string> = {
  locked:
    "Earlier versions can't be reached right now because another program (often OneDrive or antivirus) is using this world's history. AI Write tries again by itself in a moment. Your writing is saved as usual.",
  full: "Earlier versions can't be kept right now because the disk is full. Free up some space and AI Write keeps them again.",
  newer:
    "This world's history was kept by a newer version of AI Write, so this version leaves it as it is. Update AI Write to see earlier versions here.",
  unreachable: "Earlier versions can't be reached right now. AI Write tries again by itself in a moment. Your writing is saved as usual."
}

export interface WorldHistoryOptions {
  /** The world's folder (history.db is made beside its world.db). */
  folder: string
  /** The world's own database: scenes are read from it, never written. */
  worldDb: DB
  /** A scene's history changed (the window is told: 'history:changed'). */
  changed: (sceneId: ID) => void
  nowMs?: () => number
  /** How often writing keeps a snapshot (10 minutes; tests make it shorter). */
  writingEveryMs?: number
  /** Runs work once the save that asked for it has returned. */
  defer?: (fn: () => void) => void
  /** True while a draft is being written into the scene. */
  drafting?: (sceneId: ID) => boolean
}

type Outcome<T> = { ok: true; value: T } | { ok: false; problem: string }

/** Labels come from the interface; they are kept short and plain. */
const cleanLabel = (label: unknown, fallback: string): string => {
  const s = typeof label === 'string' ? label.replace(/\s+/g, ' ').trim().slice(0, 80) : ''
  return s || fallback
}

/** The page sent with a draft change, checked. */
function checkPage(page: PageNow): PageNow {
  if (!page || typeof page.sceneId !== 'string' || typeof page.text !== 'string') {
    throw new UserError("The scene's text couldn't be read from the page. Try again.", 'bad-page')
  }
  return { sceneId: page.sceneId, doc: page.doc && typeof page.doc === 'object' ? page.doc : null, text: page.text }
}

export class WorldHistory {
  readonly worldDb: DB
  private store: HistoryStore | null = null
  /** Why history.db can't be used, and when to try again (only while `store` is null). */
  private outage: { problem: HistoryProblem; retryAt: number } | null = null
  /** When each scene last had a snapshot taken (or found it had nothing new to keep), to space out writing's. */
  private readonly lastAt = new Map<ID, number>()
  /** Scenes whose writing snapshot is waiting to run. */
  private readonly due = new Set<ID>()
  private closed = false
  private tidyTimer: ReturnType<typeof setTimeout> | null = null
  private readonly now: () => number
  private readonly every: number
  private readonly defer: (fn: () => void) => void

  constructor(private readonly o: WorldHistoryOptions) {
    this.worldDb = o.worldDb
    this.now = o.nowMs ?? Date.now
    this.every = o.writingEveryMs ?? WRITING_EVERY_MS
    this.defer = o.defer ?? ((fn) => void setImmediate(fn))
  }

  /** Opens history.db as the world opens (a damaged one is set aside here), and tidies it a little later. */
  start(tidyAfterMs = 20_000): void {
    try {
      this.open()
    } catch (e) {
      console.warn('History could not be opened', e)
    }
    if (tidyAfterMs >= 0) {
      this.tidyTimer = setTimeout(() => this.tidy(), tidyAfterMs)
      this.tidyTimer.unref?.()
    }
  }

  /** The world is closing: nothing is written after this. */
  close(): void {
    this.closed = true
    if (this.tidyTimer) clearTimeout(this.tidyTimer)
    this.tidyTimer = null
    this.due.clear()
    try {
      this.store?.close()
    } catch (e) {
      console.warn('History could not close its file', e)
    }
    this.store = null
  }

  // ---------- history.db, and what happens when it can't be used ----------

  private wrap(r: OpenedHistory): HistoryStore | null {
    if (!r.ok) {
      console.warn(`History can't use this world's history.db for now (${r.problem})`, r.error)
      this.outage = { problem: r.problem, retryAt: r.problem === 'newer' ? Infinity : this.now() + RETRY_MS }
      return null
    }
    if (r.setAside) console.warn(`History started afresh: the damaged history.db was set aside as ${r.setAside}`)
    this.outage = null
    this.store = new HistoryStore(r.db, this.now)
    return this.store
  }

  /** The store, opened when first needed; null while history.db can't be used. */
  private open(): HistoryStore | null {
    if (this.closed) return null
    if (this.store) return this.store
    if (this.outage && this.now() < this.outage.retryAt) return null
    return this.wrap(openHistory(this.o.folder, this.now()))
  }

  /** history.db turned out damaged while in use: it is set aside and a fresh one started. */
  private restartAfresh(e: unknown): void {
    console.warn('History found its file damaged', e)
    try {
      this.store?.close()
    } catch {
      /* it is being set aside anyway */
    }
    this.store = null
    this.lastAt.clear()
    this.wrap(startAfresh(this.o.folder, this.now()))
  }

  private problemText(): string {
    return PROBLEM_TEXT[this.outage?.problem ?? 'unreachable']
  }

  /**
   * Runs `fn` on the store. A damaged file found on the way is set aside and `fn` runs once more on a
   * fresh one; a file that is busy or out of reach gives a plain-words problem instead. Plain-words
   * errors (UserError) pass through.
   */
  private attempt<T>(fn: (s: HistoryStore) => T): Outcome<T> {
    for (let tries = 0; ; tries++) {
      const store = this.open()
      if (!store) return { ok: false, problem: this.problemText() }
      try {
        return { ok: true, value: fn(store) }
      } catch (e) {
        if (e instanceof UserError) throw e
        if (isDamaged(e) && tries === 0) {
          this.restartAfresh(e)
          continue
        }
        if (isBusy(e)) return { ok: false, problem: PROBLEM_TEXT.locked }
        if (problemOf(e) === 'full') return { ok: false, problem: PROBLEM_TEXT.full }
        throw e
      }
    }
  }

  /** Like attempt, for what Adam asked for: a problem is said in plain words. */
  private must<T>(fn: (s: HistoryStore) => T): T {
    const r = this.attempt(fn)
    if (!r.ok) throw new UserError(r.problem, 'history-unavailable')
    return r.value
  }

  // ---------- The world's scenes (read, never written) ----------

  /** The scene's saved text, or null if it is gone. */
  private sceneNow(sceneId: ID): { doc: unknown; text: string } | null {
    try {
      const s = repo.getScene(this.worldDb, sceneId)
      return { doc: s.doc, text: s.text }
    } catch {
      return null
    }
  }

  /** The scene's words as last saved. Throws a plain-words error if the scene is gone. */
  private wordsNow(sceneId: ID): number {
    return repo.getSceneMeta(this.worldDb, sceneId).wordCount
  }

  private sceneExists(sceneId: ID): boolean {
    try {
      this.wordsNow(sceneId)
      return true
    } catch {
      return false
    }
  }

  // ---------- Snapshots ----------

  /** Keeps a snapshot and says so. Never throws: null when nothing could be kept. */
  private keep(input: SnapshotInput): TakeResult | null {
    try {
      const r = this.attempt((s) => s.take(input))
      if (!r.ok) return null
      this.lastAt.set(input.sceneId, this.now())
      if (r.value?.changed) this.o.changed(input.sceneId)
      return r.value
    } catch (e) {
      console.warn('History could not keep a snapshot', e)
      return null
    }
  }

  /** Before an AI change (or a restore) goes into the page: keeps the page as it is. Never throws. */
  take(input: TakeSnapshotInput): SnapshotInfo | null {
    try {
      if (this.closed || !input || typeof input.sceneId !== 'string' || typeof input.text !== 'string') return null
      if (!this.sceneExists(input.sceneId)) return null
      const kind = input.kind === 'restore' ? 'restore' : 'ai'
      const label = cleanLabel(input.label, kind === 'restore' ? 'Before restoring' : 'Before an AI change')
      const generationId = typeof input.generationId === 'string' ? input.generationId : null
      return this.keep({ sceneId: input.sceneId, kind, label, generationId, doc: input.doc, text: input.text })?.info ?? null
    } catch (e) {
      console.warn('History could not keep a snapshot', e)
      return null
    }
  }

  /** A scene's text was saved: writing keeps a snapshot every 10 minutes. Never throws, and returns at once. */
  textSaved(sceneId: ID): void {
    try {
      if (this.closed || this.due.has(sceneId) || this.o.drafting?.(sceneId)) return
      const last = this.lastAt.get(sceneId)
      if (last !== undefined && this.now() - last < this.every) return
      this.due.add(sceneId)
      this.defer(() => {
        this.due.delete(sceneId)
        this.writingSnapshot(sceneId)
      })
    } catch (e) {
      console.warn('History missed a save', e)
    }
  }

  private writingSnapshot(sceneId: ID): void {
    if (this.closed) return
    try {
      const r = this.attempt((s) => s.latestAt(sceneId))
      if (!r.ok) return
      const latest = r.value
      if (latest !== null && this.now() - latest < this.every) {
        this.lastAt.set(sceneId, latest)
        return
      }
      const scene = this.sceneNow(sceneId)
      if (!scene) return
      // An empty page keeps nothing, and isn't looked at again for a while either.
      if (!this.keep({ sceneId, kind: 'editing', label: 'While writing', doc: scene.doc, text: scene.text }))
        this.lastAt.set(sceneId, this.now())
    } catch (e) {
      console.warn('History could not keep a snapshot while writing', e)
    }
  }

  /** A scene was marked done: it keeps a snapshot. Never throws, and returns at once. */
  markedDone(sceneId: ID): void {
    try {
      if (this.closed) return
      this.defer(() => {
        if (this.closed) return
        const scene = this.sceneNow(sceneId)
        if (scene) this.keep({ sceneId, kind: 'done', label: 'Marked done', doc: scene.doc, text: scene.text })
      })
    } catch (e) {
      console.warn('History missed a scene marked done', e)
    }
  }

  /** The scene's snapshots, newest first, or why they can't be shown. */
  listSnapshots(sceneId: ID): SceneHistory {
    const r = this.attempt((s) => ({ snapshots: s.list(sceneId), notice: this.noticeOf(s) }))
    if (!r.ok) return { available: false, problem: r.problem, notice: null, snapshots: [] }
    return { available: true, problem: null, notice: r.value.notice, snapshots: r.value.snapshots }
  }

  /** One snapshot with its text. */
  getSnapshot(id: ID): Snapshot {
    const snap = this.must((s) => s.get(id))
    if (!snap) throw new UserError("That earlier version can't be found any more. The list shows the ones this scene has.", 'snapshot-gone')
    return snap
  }

  /** What the History page says for a while after History had to start afresh. */
  private noticeOf(s: HistoryStore): string | null {
    const fresh = freshStartOf(s.db)
    if (!fresh) return null
    const at = Date.parse(fresh.at)
    if (Number.isNaN(at) || this.now() - at > NOTICE_DAYS * DAY_MS) return null
    return `History had to start afresh because its file was damaged, so earlier versions from before then aren't listed. The damaged file was kept in the world's folder as ${fresh.setAside}.`
  }

  // ---------- Drafts ----------

  private draftsOf(s: HistoryStore, sceneId: ID): DraftInfo[] {
    return s.drafts(sceneId, this.wordsNow(sceneId))
  }

  /** The scene's drafts, Draft 1 first, or why they can't be shown. */
  listDrafts(sceneId: ID): SceneDrafts {
    const words = this.wordsNow(sceneId)
    const r = this.attempt((s) => s.drafts(sceneId, words))
    if (!r.ok) return { available: false, problem: r.problem, drafts: [] }
    return { available: true, problem: null, drafts: r.value }
  }

  private listed(drafts: DraftInfo[]): SceneDrafts {
    return { available: true, problem: null, drafts }
  }

  /** A new draft, a copy of the page; the draft that was current keeps the page's text as it is. */
  newDraft(page: PageNow): { drafts: SceneDrafts; created: DraftInfo; kept: DraftInfo } {
    const p = checkPage(page)
    this.wordsNow(p.sceneId)
    const out = this.must((s) => {
      const made = s.newDraft(p)
      // The new draft is the page as it is (perhaps a moment ahead of its last save).
      return { ...made, drafts: s.drafts(p.sceneId, made.created.words) }
    })
    this.o.changed(p.sceneId)
    return { drafts: this.listed(out.drafts), created: out.created, kept: out.kept }
  }

  undoNewDraft(sceneId: ID, draftId: ID, keptId: ID): SceneDrafts {
    this.wordsNow(sceneId)
    const drafts = this.must((s) => {
      s.undoNewDraft(sceneId, draftId, keptId)
      return this.draftsOf(s, sceneId)
    })
    this.o.changed(sceneId)
    return this.listed(drafts)
  }

  /** Another draft becomes current: the page is kept as the draft it was, and the chosen one's text comes back. */
  switchDraft(page: PageNow, draftId: ID): { drafts: SceneDrafts; to: DraftText; from: DraftInfo } {
    const p = checkPage(page)
    this.wordsNow(p.sceneId)
    const out = this.must((s) => {
      s.take({ sceneId: p.sceneId, kind: 'restore', label: 'Before switching drafts', doc: p.doc, text: p.text })
      const switched = s.switchDraft(p, draftId)
      return { ...switched, drafts: s.drafts(p.sceneId, switched.to.words) }
    })
    this.lastAt.set(p.sceneId, this.now())
    this.o.changed(p.sceneId)
    return { drafts: this.listed(out.drafts), to: out.to, from: out.from }
  }

  setCurrentDraft(sceneId: ID, draftId: ID): SceneDrafts {
    this.wordsNow(sceneId)
    const drafts = this.must((s) => {
      s.setCurrent(sceneId, draftId)
      return this.draftsOf(s, sceneId)
    })
    this.o.changed(sceneId)
    return this.listed(drafts)
  }

  renameDraft(draftId: ID, name: string): DraftInfo {
    const d = this.must((s) => s.rename(draftId, typeof name === 'string' ? name : ''))
    this.o.changed(d.sceneId)
    return d.current && this.sceneExists(d.sceneId) ? { ...d, words: this.wordsNow(d.sceneId) } : d
  }

  deleteDraft(draftId: ID): void {
    const sceneId = this.must((s) => s.remove(draftId))
    this.o.changed(sceneId)
  }

  restoreDraft(draftId: ID): void {
    const sceneId = this.must((s) => s.unremove(draftId))
    this.o.changed(sceneId)
  }

  // ---------- Tidying up ----------

  /**
   * Keeps history.db from growing without end: every scene's snapshots are thinned (store.ts says how),
   * drafts deleted 30 days ago are forgotten, and so is the history of scenes gone for good from the
   * world for a while. Runs a little after the world opens; never throws.
   */
  tidy(): void {
    if (this.closed) return
    try {
      this.attempt((s) => {
        const cutoff = this.now() - FORGET_GONE_DAYS * DAY_MS
        for (const { sceneId, lastAt } of s.scenes()) {
          const gone = Date.parse(lastAt) < cutoff && anyKeeperScene(this.worldDb, sceneId) === null
          if (gone) s.forgetScene(sceneId)
          else s.thinSnapshots(sceneId)
        }
        s.purgeDeletedDrafts(30)
        s.giveBackSpace()
      })
    } catch (e) {
      console.warn('History could not tidy up', e)
    }
  }
}
