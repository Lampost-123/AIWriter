// Under suggestion: reading scenes for commands in the background, one at a time and in story order (each reading starts
// from the commands the scenes before left), giving way while a draft waits for the memory or the memory is busy. A
// scene is read after the memory keeper reads it (keeper/index.ts standLater); turning tracking on for a story reads
// every scene of it with words that isn't read yet, with progress for the page. Stops when the world closes.
import type Database from 'better-sqlite3'
import type { ID } from '@shared/types'
import * as repo from '../db/repo'
import { loadShape } from '../memory/scene'
import type { MemoryModel } from '../keeper/model'
import { emit } from '../events'
import { lineOrder } from '.'
import { readSceneCommands } from './read'

type DB = Database.Database

export interface ReaderDeps {
  model: () => MemoryModel | { error: string }
  /** The memory or a draft is busy: wait a moment. */
  busy: () => boolean
  live: () => boolean
  /** Waits between looks while busy (app tests make it short). */
  waitMs?: number
}

interface Reader {
  deps: ReaderDeps
  chain: Promise<void>
  /** A story being read whole: scenes done of how many. */
  progress: Map<ID, { done: number; total: number }>
  stopped: boolean
}

const readers = new WeakMap<DB, Reader>()

export function startCommandReading(db: DB, deps: ReaderDeps): void {
  readers.set(db, { deps, chain: Promise.resolve(), progress: new Map(), stopped: false })
}

export function stopCommandReading(db: DB): void {
  const r = readers.get(db)
  if (r) r.stopped = true
  readers.delete(db)
}

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function readOne(db: DB, r: Reader, sceneId: ID): Promise<boolean> {
  const alive = (): boolean => !r.stopped && r.deps.live()
  while (alive() && r.deps.busy()) await pause(r.deps.waitMs ?? 1_000)
  if (!alive()) return false
  const model = r.deps.model()
  if ('error' in model) return false
  const out = await readSceneCommands(db, sceneId, model, { closed: () => !alive() })
  if (out === 'read' && alive()) {
    const { story } = repo.sceneLocation(db, sceneId)
    emit('commands:changed', { storyId: story.id })
  }
  return out !== 'stopped'
}

/** After the memory keeper reads a scene: read it for commands too, when its story is tracked. Never throws. */
export function commandsAfterRead(db: DB, sceneId: ID): void {
  const r = readers.get(db)
  if (!r) return
  r.chain = r.chain.then(() => readOne(db, r, sceneId).then(() => undefined)).catch((e) => console.warn('Could not read the scene for commands', e))
}

/** Reads every scene of a story with words, in order (scenes read before and unchanged cost nothing). */
export function readStoryCommands(db: DB, storyId: ID): void {
  const r = readers.get(db)
  if (!r || r.progress.has(storyId)) return
  const shape = loadShape(db)
  const own = new Set(shape.stories.find((s) => s.id === storyId)?.chapters.flatMap((c) => c.scenes.map((s) => s.id)) ?? [])
  const ids = lineOrder(shape, storyId).filter((id) => own.has(id) && repo.getScene(db, id).text.trim())
  if (!ids.length) return
  const p = { done: 0, total: ids.length }
  r.progress.set(storyId, p)
  emit('commands:changed', { storyId })
  r.chain = r.chain
    .then(async () => {
      for (const id of ids) {
        if (!(await readOne(db, r, id))) break
        p.done++
        emit('commands:changed', { storyId })
      }
    })
    .catch((e) => console.warn('Could not read the story for commands', e))
    .finally(() => {
      r.progress.delete(storyId)
      if (!r.stopped) emit('commands:changed', { storyId })
    })
}

/** How far reading a whole story has got, or null. */
export function readingProgress(db: DB, storyId: ID): { done: number; total: number } | null {
  const p = readers.get(db)?.progress.get(storyId)
  return p ? { ...p } : null
}

/** Waits for the reading queued so far (tests). */
export function commandReadingDone(db: DB): Promise<void> {
  return readers.get(db)?.chain ?? Promise.resolve()
}
