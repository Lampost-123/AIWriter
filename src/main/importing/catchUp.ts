// The import catch-up (milestone 6; spec, "Memory upkeep"): the memory keeper reads an imported story's
// unread scenes in reading order, chapter by chapter, in the background, on the memory model with the
// memory's Thinking. It drives the keeper rather than reading anything itself: each scene is marked waiting
// and handed to the keeper's own queue (two at a time, so Adam's own scenes are read in between, and the
// keeper's roll-ups wait until the story is done), then waited for. So everything the keeper does for a typed
// scene happens here too: What changed, summaries, Generate's catch-up for earlier scenes.
//
// It survives a restart: the stories still to read are kept in the world's meta key 'import_catchup', the
// keeper reads scenes left waiting at app start, and this carries on when the world opens. It pauses (and says
// why) when there is no memory model, or two scenes in a row can't be read (out of credit, say); Try again
// carries on. Stop ends it: the scene being read stops, and what hasn't been read goes back to unread.
// No Electron imports.

import type Database from 'better-sqlite3'
import type { CatchUpProgress, CatchUpState } from '@shared/contracts/importing'
import type { ID } from '@shared/types'
import * as idb from '../db/importing'
import type { MemoryModel } from '../keeper/model'

type DB = Database.Database

/** What the catch-up needs of the memory keeper (keeper/engine.ts). */
export interface KeeperLike {
  updateNow(id?: ID): void
  whenRead(id: ID): Promise<void>
  forget(ids: ID[]): void
}

export interface CatchUpDeps {
  db: DB
  /** The open world's keeper; null while there is none. */
  keeper: () => KeeperLike | null
  /** The memory model now, or why there is none, in plain words. */
  model: () => MemoryModel | { error: string }
  /** Called whenever the state changes. */
  emit: (s: CatchUpState) => void
}

/** Two scenes that can't be read in a row pause the catch-up: something is wrong beyond one scene. */
const FAILS_TO_PAUSE = 2
/** How many of the catch-up's scenes are in the keeper's queue at once. */
const AHEAD = 2

export class CatchUp {
  private loop: Promise<void> | null = null
  private closed = false
  private stopping = false
  private status: CatchUpProgress['status'] | null = null
  private error: string | null = null
  /** The story being read and its scenes handed to the keeper and not yet finished. */
  private current: { storyId: ID; sceneId: ID | null; handed: ID[] } | null = null
  private finished: CatchUpState['finished'] = null

  constructor(private readonly d: CatchUpDeps) {}

  // ---------- What it says ----------

  state(): CatchUpState {
    const { db } = this.d
    if (this.closed || !db.open) return { running: null, unread: {}, finished: this.finished }
    return { running: this.progress(), unread: idb.unreadCounts(db), finished: this.finished }
  }

  private progress(): CatchUpProgress | null {
    const rec = idb.getCatchUpRecord(this.d.db)
    if (!rec) return null
    const storyId = rec.storyIds[0]
    const story = this.d.db.prepare('SELECT title FROM stories WHERE id = ? AND deleted_at IS NULL').get(storyId) as { title: string } | undefined
    if (!story) return null
    const scenes = idb.storyScenes(this.d.db, storyId)
    const chapters = idb.storyChapters(this.d.db, storyId)
    const at = this.current?.storyId === storyId && this.current.sceneId ? scenes.find((s) => s.sceneId === this.current!.sceneId) : null
    const next = at ?? scenes.find((s) => s.unread) ?? null
    const chapter = next ? chapters.indexOf(next.chapterId) + 1 : chapters.length
    return {
      storyId,
      storyTitle: story.title,
      chapter: Math.max(1, chapter),
      chapters: chapters.length,
      read: scenes.filter((s) => !s.unread).length,
      scenes: scenes.length,
      // Kept but not going yet (the world has just opened): it is about to carry on.
      status: this.stopping ? 'stopping' : (this.status ?? (this.loop ? 'reading' : 'starting')),
      error: this.error,
      waiting: rec.storyIds.length - 1
    }
  }

  private tell(): void {
    if (this.closed || !this.d.db.open) return
    try {
      this.d.emit(this.state())
    } catch (e) {
      console.warn('Could not send how the import catch-up is going', e)
    }
  }

  // ---------- Starting and stopping ----------

  /** The world opened: a catch-up left going (or paused) carries on. */
  resume(): void {
    if (idb.getCatchUpRecord(this.d.db)) this.run()
  }

  /** Builds the memory from this story (after any story already being read); a paused catch-up carries on. */
  start(storyId: ID): void {
    if (this.closed || this.stopping) return
    const rec = idb.getCatchUpRecord(this.d.db) ?? { storyIds: [] }
    if (!rec.storyIds.includes(storyId)) idb.setCatchUpRecord(this.d.db, { storyIds: [...rec.storyIds, storyId] })
    this.error = null
    if (!this.loop) this.status = 'starting'
    this.run()
    this.tell()
  }

  /** Stop: the scene being read stops, what isn't read goes back to unread, and no story is left to read. */
  async stop(): Promise<void> {
    if (this.closed) return
    this.stopping = true
    this.tell()
    this.letGo()
    idb.setCatchUpRecord(this.d.db, null)
    await this.loop
    this.stopping = false
    this.status = null
    this.error = null
    this.current = null
    this.tell()
  }

  /** The world is closing: nothing more is written; what is kept carries on when it opens again. */
  close(): void {
    this.closed = true
  }

  /** Resolves once the catch-up has nothing left to do or has paused (for tests). */
  async whenIdle(): Promise<void> {
    while (this.loop) await this.loop
  }

  /** The scenes handed to the keeper and not finished go back to unread, and the keeper lets them go. */
  private letGo(): void {
    const ids = this.current?.handed ?? []
    if (!ids.length) return
    this.d.keeper()?.forget(ids)
    if (this.d.db.open) idb.backToUnread(this.d.db, ids)
    if (this.current) this.current.handed = []
  }

  private pause(error: string): void {
    this.letGo()
    this.status = 'paused'
    this.error = error
  }

  // ---------- Reading ----------

  private run(): void {
    if (this.loop || this.closed) return
    this.loop = this.read()
      .catch((e) => {
        console.error('The import catch-up stopped unexpectedly', e)
        if (!this.closed && this.d.db.open) this.pause('Something went wrong while building the memory. Try again.')
      })
      .finally(() => {
        this.loop = null
        if (this.status !== 'paused') this.status = null
        this.tell()
      })
  }

  private live = (): boolean => !this.closed && !this.stopping && this.d.db.open

  /** True once the keeper has read the scene (it has paragraphs read). */
  private readNow(id: ID): { read: boolean; failed: boolean } {
    const r = this.d.db.prepare("SELECT memory_paragraphs_json <> '[]' AS read, memory_status = 'failed' AS failed FROM scenes WHERE id = ?").get(id) as
      | { read: number; failed: number }
      | undefined
    return { read: !!r?.read, failed: !!r?.failed }
  }

  private storyLive(storyId: ID): boolean {
    return !!this.d.db.prepare('SELECT 1 FROM stories WHERE id = ? AND deleted_at IS NULL').get(storyId)
  }

  private async read(): Promise<void> {
    const { db } = this.d
    while (this.live()) {
      const rec = idb.getCatchUpRecord(db)
      if (!rec) return
      const storyId = rec.storyIds[0]
      const story = db.prepare('SELECT title FROM stories WHERE id = ? AND deleted_at IS NULL').get(storyId) as { title: string } | undefined
      // A story deleted meanwhile (an import undone) is simply passed over.
      if (!story) {
        idb.setCatchUpRecord(db, { storyIds: rec.storyIds.slice(1) })
        continue
      }
      const model = this.d.model()
      if ('error' in model) return this.pause(model.error)
      const keeper = this.d.keeper()
      if (!keeper) return
      const todo = idb
        .storyScenes(db, storyId)
        .filter((s) => s.unread)
        .map((s) => s.sceneId)
      this.current = { storyId, sceneId: todo[0] ?? null, handed: [] }
      this.status = 'reading'
      this.tell()
      let missed = 0
      let failsInRow = 0
      const hand = (i: number): void => {
        const id = todo[i]
        if (!id || this.current!.handed.includes(id)) return
        idb.markWaiting(db, [id])
        this.current!.handed.push(id)
        keeper.updateNow(id)
      }
      for (let i = 0; i < todo.length; i++) {
        for (let k = i; k < i + AHEAD; k++) hand(k)
        this.current.sceneId = todo[i]
        this.tell()
        await keeper.whenRead(todo[i])
        if (!this.live()) return
        this.current.handed = this.current.handed.filter((x) => x !== todo[i])
        // The story was deleted meanwhile (its import undone): nothing more to read in it.
        if (!this.storyLive(storyId)) {
          this.letGo()
          break
        }
        const now = this.readNow(todo[i])
        if (now.read) {
          failsInRow = 0
          continue
        }
        // Not read: the model went away (the keeper let it wait), or the read failed.
        const m = this.d.model()
        if ('error' in m) return this.pause(m.error)
        if (!now.failed) continue
        missed++
        if (++failsInRow >= FAILS_TO_PAUSE) {
          return this.pause(idb.failureOf(db, [todo[i]]) ?? "The memory couldn't read these scenes. Try again in a moment.")
        }
      }
      // This story is done: the next one, if any, has its turn.
      const after = idb.getCatchUpRecord(db)
      idb.setCatchUpRecord(db, after ? { storyIds: after.storyIds.filter((x) => x !== storyId) } : null)
      if (this.storyLive(storyId)) this.finished = { storyId, storyTitle: story.title, at: new Date().toISOString(), missed }
      this.current = null
      this.tell()
    }
  }
}
