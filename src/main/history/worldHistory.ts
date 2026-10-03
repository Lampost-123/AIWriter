// One open world's history: when its scenes' snapshots are taken, their drafts, and what happens
// while its history.db can't be used. index.ts connects it to the open world, the saves and the
// window; store.ts holds the SQL. No Electron imports, so it is tested on its own.
//
// When snapshots are taken:
//   - before every AI change goes into the page (the interface calls takeSnapshot);
//   - when a scene is marked done (sceneMarkedDone);
//   - while writing: a save 10 minutes or more after the scene's latest snapshot takes one, and a
//     scene's very first save takes its first (sceneTextSaved). Nothing is taken while a draft is
//     being written into the scene: the snapshot before it came first;
//   - when a new draft is started (the text the copy starts from).
// History is a convenience: none of this ever throws, and a save never waits for it.
//
// While history.db can't be used (held by another program, a full disk, a disk or sync problem), nothing
// touches it for RETRY_MS, so saves and AI changes never wait on it; a History page or Drafts tab that said
// so loads again by itself once it answers, and Try again tries it at once.

import type Database from 'better-sqlite3'
import type { ID } from '@shared/types'
import type {
  DraftInfo,
  DraftText,
  HistoryLoadOptions,
  PageNow,
  SceneDrafts,
  SceneHistory,
  Snapshot,
  SnapshotInfo,
  TakeSnapshotInput,
  UndoNewDraftInput
} from '@shared/contracts/history'
import * as repo from '../db/repo'
import { anyKeeperScene } from '../db/keeper'
import { UserError } from '../util'
import { HistoryStore, type SnapshotInput, type TakeResult } from './store'
import {
  freshStartOf,
  isDamaged,
  isFileProblem,
  openHistory,
  problemOf,
  startAfresh,
  type HistoryProblem,
  type OpenedHistory
} from './open'

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
  /** Why history.db can't be used right now, and when it is tried again (one from a newer AI Write: not by itself). */
  private outage: { problem: HistoryProblem; retryAt: number } | null = null
  /** Scenes whose History page or Drafts tab was told History can't be reached: told again once it can. */
  private readonly waiting = new Set<ID>()
  private retryTimer: ReturnType<typeof setTimeout> | null = null
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
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
    this.due.clear()
    this.waiting.clear()
    try {
      this.store?.close()
    } catch (e) {
      console.warn('History could not close its file', e)
    }
    this.store = null
  }

  // ---------- history.db, and what happens when it can't be used ----------

  /** history.db can't be used: it is left alone for a while (one from a newer AI Write, for good). */
  private down(problem: HistoryProblem, e: unknown): void {
    console.warn(`History can't use this world's history.db for now (${problem})`, e)
    this.outage = { problem, retryAt: problem === 'newer' ? Infinity : this.now() + RETRY_MS }
  }

  /** history.db answered: a History page or Drafts tab that said it couldn't be reached loads again. */
  private up(): void {
    if (!this.outage) return
    this.outage = null
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
    if (!this.waiting.size) return
    // After the call that found it working has returned.
    this.defer(() => {
      const scenes = [...this.waiting]
      this.waiting.clear()
      if (!this.closed) for (const id of scenes) this.o.changed(id)
    })
  }

  private wrap(r: OpenedHistory): HistoryStore | null {
    if (!r.ok) {
      this.down(r.problem, r.error)
      return null
    }
    if (r.setAside) console.warn(`History started afresh: the damaged history.db was set aside as ${r.setAside}`)
    this.store = new HistoryStore(r.db, this.now)
    return this.store
  }

  /**
   * The store, opened when first needed. Null while history.db can't be used and isn't due to be tried
   * again, even with the file open (it was busy a moment ago); `now` (Adam asked) tries it at once.
   */
  private open(now = false): HistoryStore | null {
    if (this.closed) return null
    if (this.outage && !now && this.now() < this.outage.retryAt) return null
    return this.store ?? this.wrap(openHistory(this.o.folder, this.now()))
  }

  /** A History page or Drafts tab for this scene says History can't be reached: it is told once it can be. */
  private waitFor(sceneId: ID): void {
    if (this.closed || !this.outage || this.outage.retryAt === Infinity) return
    this.waiting.add(sceneId)
    this.retryLater()
  }

  /** While anything waits for history.db, it is tried again each time it is due. */
  private retryLater(): void {
    if (this.retryTimer || this.closed || !this.waiting.size || !this.outage || this.outage.retryAt === Infinity) return
    this.retryTimer = setTimeout(
      () => {
        this.retryTimer = null
        if (this.closed) return
        try {
          // Once it answers, `up` tells the scenes waiting.
          this.attempt((s) => s.ping(), true)
        } catch (e) {
          console.warn('History could not try its file again', e)
        }
        this.retryLater()
      },
      Math.max(0, this.outage.retryAt - this.now())
    )
    this.retryTimer.unref?.()
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
   * fresh one. A file that is busy, full or out of reach (any SQLite or file error) gives a plain-words
   * problem instead, and is left alone for a while. Plain-words errors (UserError) pass through. `now`:
   * Adam asked (Try again), so a file that couldn't be used a moment ago is tried at once.
   */
  private attempt<T>(fn: (s: HistoryStore) => T, now = false): Outcome<T> {
    for (let tries = 0; ; tries++) {
      const store = this.open(now)
      if (!store) return { ok: false, problem: this.problemText() }
      try {
        const value = fn(store)
        this.up()
        return { ok: true, value }
      } catch (e) {
        if (e instanceof UserError) throw e
        if (isDamaged(e) && tries === 0) {
          this.restartAfresh(e)
          continue
        }
        if (!isFileProblem(e)) throw e
        this.down(problemOf(e), e)
        return { ok: false, problem: this.problemText() }
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

  /** The scene's snapshots, newest first, with the ones the same as the scene now; or why they can't be shown. */
  listSnapshots(sceneId: ID, o?: HistoryLoadOptions | null): SceneHistory {
    // The scene now: the page as the History page sent it, or the scene as last saved.
    const page = o?.page && o.page.sceneId === sceneId && typeof o.page.text === 'string' ? o.page : null
    const scene = page ?? this.sceneNow(sceneId)
    const r = this.attempt(
      (s) => ({ snapshots: s.list(sceneId), sameAsNow: scene ? s.sameAs(sceneId, scene.doc, scene.text) : [], notice: this.noticeOf(s) }),
      !!o?.tryAgain
    )
    if (!r.ok) {
      this.waitFor(sceneId)
      return { available: false, problem: r.problem, notice: null, snapshots: [], sameAsNow: [] }
    }
    return { available: true, problem: null, ...r.value }
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
  listDrafts(sceneId: ID, o?: HistoryLoadOptions | null): SceneDrafts {
    const words = this.wordsNow(sceneId)
    const r = this.attempt((s) => s.drafts(sceneId, words), !!o?.tryAgain)
    if (!r.ok) {
      this.waitFor(sceneId)
      return { available: false, problem: r.problem, drafts: [] }
    }
    return { available: true, problem: null, drafts: r.value }
  }

  private listed(drafts: DraftInfo[]): SceneDrafts {
    return { available: true, problem: null, drafts }
  }

  /**
   * A new draft, a copy of the page; the draft that was current keeps the page's text as it is, and so
   * does History ("New draft started"), whatever later becomes of either draft.
   */
  newDraft(page: PageNow): { drafts: SceneDrafts; created: DraftInfo; kept: DraftInfo } {
    const p = checkPage(page)
    this.wordsNow(p.sceneId)
    if (!p.text.trim()) {
      throw new UserError("A new draft starts as a copy of the scene's text, so write something in the scene first.", 'draft-empty')
    }
    const out = this.must((s) => {
      s.take({ sceneId: p.sceneId, kind: 'editing', label: 'New draft started', doc: p.doc, text: p.text })
      const made = s.newDraft(p)
      // The new draft is the page as it is (perhaps a moment ahead of its last save).
      return { ...made, drafts: s.drafts(p.sceneId, made.created.words) }
    })
    this.lastAt.set(p.sceneId, this.now())
    this.o.changed(p.sceneId)
    return { drafts: this.listed(out.drafts), created: out.created, kept: out.kept }
  }

  /**
   * Takes a new draft back while it is still as it started (see HistoryStore.undoNewDraft). A copy with
   * changes since is kept (`undone` false), so nothing typed in it is ever lost.
   */
  undoNewDraft(input: UndoNewDraftInput): { drafts: SceneDrafts; undone: boolean } {
    const { sceneId, draftId, keptId } = input ?? ({} as Partial<UndoNewDraftInput>)
    if (typeof sceneId !== 'string' || typeof draftId !== 'string' || typeof keptId !== 'string') {
      throw new UserError(
        "That draft can't be found. It may have been deleted; the Drafts tab shows the ones this scene has.",
        'draft-gone'
      )
    }
    this.wordsNow(sceneId)
    // The scene's text now: the page's when it shows this scene (perhaps a moment ahead of its last save), or as last saved.
    const page = input.page && input.page.sceneId === sceneId ? checkPage(input.page) : null
    const sceneNow = page ?? this.sceneNow(sceneId)
    const out = this.must((s) => {
      const undone = s.undoNewDraft(sceneId, draftId, keptId, sceneNow)
      return { undone, drafts: this.draftsOf(s, sceneId) }
    })
    this.o.changed(sceneId)
    return { drafts: this.listed(out.drafts), undone: out.undone }
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
