// Keeping the story index current (overhaul phase 1, wiring): what changed is gathered for a moment and then brought
// into the index in the background, a story at a time, so nothing a change comes from ever waits for it. Free: no AI.
// - `scene(id)`: a scene's words, card, summary or where things stand changed (refreshSceneIndex: it and the next
//   scene with a stage).
// - `stories(ids)`: something a whole story's index rests on changed (scenes or chapters moved, the memory edited by
//   hand, an entry renamed): buildStoryIndex, which builds again only the scenes whose sources changed. With no ids,
//   every live story, and the stories gone (deleted) are taken out: a world opening, a scene deleted or brought back.
// Never throws into the caller: a failure is logged and the index catches up at the next change (or the next opening).
// No Electron imports; keeper/indexing.ts connects it to the open world.

import type Database from 'better-sqlite3'
import type { ID } from '@shared/types'
import * as fdb from '../db/indexFill'
import * as sidx from '../db/storyIndex'
import { buildStoryIndex, refreshSceneIndex, type IndexBuild } from '.'

type DB = Database.Database

/** How long changes are gathered before they are taken into the index (a burst of saves is one refresh). */
export const UPKEEP_DELAY_MS = 400

/** refreshSceneIndex that never throws: null when it failed (or the scene was never indexed and is gone). */
export function refreshSceneSafely(db: DB, sceneId: ID): IndexBuild | null {
  if (!db.open) return null
  try {
    return refreshSceneIndex(db, sceneId)
  } catch (e) {
    console.warn('Could not bring the story index up to date for a scene', e)
    return null
  }
}

/** buildStoryIndex that never throws: null when it failed. */
export function buildStorySafely(db: DB, storyId: ID): IndexBuild | null {
  if (!db.open) return null
  try {
    return buildStoryIndex(db, storyId)
  } catch (e) {
    console.warn('Could not bring the story index up to date for a story', e)
    return null
  }
}

/** The stories to bring up to date when every one is asked for: the live ones, and those the index holds that are gone. */
function everyStory(db: DB): ID[] {
  try {
    const live = fdb.liveStoryIds(db)
    const held = new Set(live)
    return [...live, ...fdb.indexedStoryIds(db).filter((id) => !held.has(id))]
  } catch (e) {
    console.warn('Could not list the stories for the story index', e)
    return []
  }
}

/** Every story's index brought up to date at once, and the stories gone taken out (for tests and a world's first build). */
export function syncWorldIndex(db: DB): IndexBuild[] {
  return everyStory(db)
    .map((id) => buildStorySafely(db, id))
    .filter((b): b is IndexBuild => !!b)
}

export interface UpkeepOptions {
  db: DB
  /** False once the world has closed: nothing more is done. */
  live?: () => boolean
  /** How long changes are gathered first (UPKEEP_DELAY_MS). */
  delayMs?: number
  /** Told after each story's build (for the recent chapters' details, which wait for the first build). */
  onBuilt?: (b: IndexBuild) => void
}

/** The open world's index upkeep: changes gathered, then taken in one story at a time, between other work. */
export class IndexUpkeep {
  private readonly db: DB
  private readonly delayMs: number
  private readonly scenes = new Set<ID>()
  private readonly storyIds = new Set<ID>()
  private every = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private running: Promise<void> | null = null
  private stopped = false
  private idle: (() => void)[] = []

  constructor(private readonly o: UpkeepOptions) {
    this.db = o.db
    this.delayMs = o.delayMs ?? UPKEEP_DELAY_MS
  }

  private live(): boolean {
    return !this.stopped && this.db.open && (this.o.live?.() ?? true)
  }

  /** A scene changed: its rows (and the next scene with a stage) are brought up to date soon. */
  scene(sceneId: ID | null | undefined): void {
    if (!sceneId || !this.live()) return
    this.scenes.add(sceneId)
    this.soon()
  }

  /** These stories (every story when none are given, and the stories gone) are brought up to date soon. */
  stories(storyIds?: (ID | null | undefined)[]): void {
    if (!this.live()) return
    if (!storyIds) this.every = true
    else for (const id of storyIds) if (id) this.storyIds.add(id)
    this.soon()
  }

  /** Resolves once nothing is waiting or being taken in (for tests). */
  whenIdle(): Promise<void> {
    if (!this.timer && !this.running) return Promise.resolve()
    return new Promise((resolve) => this.idle.push(resolve))
  }

  /** The world is closing: nothing more is done. */
  stop(): void {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.scenes.clear()
    this.storyIds.clear()
    this.every = false
    if (!this.running) this.settle()
  }

  private soon(): void {
    if (this.timer || this.running) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.running = this.run()
        .catch((e) => console.warn('The story index could not keep up', e))
        .finally(() => {
          this.running = null
          if (this.live() && (this.scenes.size || this.storyIds.size || this.every)) this.soon()
          else this.settle()
        })
    }, this.delayMs)
  }

  private settle(): void {
    const waiting = this.idle
    this.idle = []
    for (const resolve of waiting) resolve()
  }

  /** Takes in what was gathered: the stories first (one at a time, letting other work in between), then lone scenes. */
  private async run(): Promise<void> {
    const stories = this.every ? everyStory(this.db) : []
    for (const id of this.storyIds) if (!stories.includes(id)) stories.push(id)
    const scenes = [...this.scenes]
    this.every = false
    this.storyIds.clear()
    this.scenes.clear()
    const built = new Set<ID>()
    for (const id of stories) {
      if (!this.live()) return
      const b = buildStorySafely(this.db, id)
      built.add(id)
      if (b) this.told(b)
      await breather()
    }
    for (const id of scenes) {
      if (!this.live()) return
      // A scene whose story was just built is in step already.
      let story: ID | null = null
      try {
        story = sidx.storyOfIndexScene(this.db, id)
      } catch {
        story = null
      }
      if (story && built.has(story)) continue
      const b = refreshSceneSafely(this.db, id)
      if (b) this.told(b)
      await breather()
    }
  }

  private told(b: IndexBuild): void {
    try {
      this.o.onBuilt?.(b)
    } catch (e) {
      console.warn('Something waiting on the story index failed', e)
    }
  }
}

/** Lets anything waiting (a save, the window) go first. */
const breather = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))
