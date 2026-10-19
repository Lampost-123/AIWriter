// Keeping the search index in step with the world (story memory step 5): each scene's words cut into passages again
// when they change (found by a hash of the words, so a backup brought back or a world copied in is caught too), scenes
// gone from the world forgotten, the scenes' and chapters' summaries put in as they now read (2026-10-19, so a search
// can find the scene a summary sums up when no one passage says it in the search's words), and, once the search model
// is here, each summary and passage read for its vector, a few at a time in the background. All of it can stop at any
// point and pick up where it left off. No Electron imports.

import type Database from 'better-sqlite3'
import type { ID } from '@shared/types'
import { liveSceneTexts, liveSummaryTexts, sceneTextsOf } from '../db/retrieval'
import type { SearchIndex } from './store'
import { scenePassages, textHash } from './text'
import type { Embedder } from './types'
import type { Vectors } from './vectors'

type DB = Database.Database

/** What has to change in the index for it to match the world's scenes. */
export interface SceneSync {
  /** Scenes whose words changed (or are new): their id, words and the words' hash. */
  changed: { id: ID; text: string; hash: string }[]
  /** Scenes the index has that are gone from the world. */
  removed: ID[]
}

export function scenesToSync(db: DB, index: SearchIndex): SceneSync {
  const texts = liveSceneTexts(db)
  const have = index.sceneHashes()
  const changed: SceneSync['changed'] = []
  for (const [id, text] of texts) {
    const hash = textHash(text)
    if (have.get(id) !== hash) changed.push({ id, text, hash })
  }
  return { changed, removed: [...have.keys()].filter((id) => !texts.has(id)) }
}

/** Puts these scenes' passages in the index. */
export function applySync(index: SearchIndex, sync: SceneSync): void {
  index.removeScenes(sync.removed)
  for (const s of sync.changed) index.putScene(s.id, s.hash, scenePassages(s.text))
}

/**
 * Brings the index's summaries in step with the world's: each scene's and chapter's summary as it now reads (a new or
 * rewritten one put in, by the hash of its words), those gone forgotten. Quick: a summary a scene at most.
 */
export function syncSummaries(db: DB, index: SearchIndex): { changed: number; removed: number } {
  const now = liveSummaryTexts(db)
  const have = index.summaryHashes()
  const changed = now.map((x) => ({ ...x, hash: textHash(x.text) })).filter((x) => have.get(x.key) !== x.hash)
  const live = new Set(now.map((x) => x.key))
  const removed = [...have.keys()].filter((k) => !live.has(k))
  index.removeSummaries(removed)
  index.putSummaries(changed)
  return { changed: changed.length, removed: removed.length }
}

/** Brings the index in step with the world's scenes and summaries at once (before a search: quick once it is built). */
export function syncNow(db: DB, index: SearchIndex): SceneSync {
  const sync = scenesToSync(db, index)
  applySync(index, sync)
  syncSummaries(db, index)
  return sync
}

const breathe = (): Promise<void> => new Promise((r) => setImmediate(r))

/**
 * The same, a few scenes at a time, letting the app get on between them (the background indexing). Each batch's words
 * are read again just before they go in, so words written meanwhile are never covered by older ones.
 */
export async function syncSlowly(db: DB, index: SearchIndex, signal: AbortSignal, scenesAtOnce = 20): Promise<SceneSync> {
  const sync = scenesToSync(db, index)
  index.removeScenes(sync.removed)
  const done: SceneSync['changed'] = []
  for (let i = 0; i < sync.changed.length; i += scenesAtOnce) {
    if (signal.aborted || !index.open || !db.open) break
    const ids = sync.changed.slice(i, i + scenesAtOnce).map((c) => c.id)
    const now = sceneTextsOf(db, ids)
    const batch = ids.flatMap((id) => {
      const text = now.get(id)
      return text === undefined ? [] : [{ id, text, hash: textHash(text) }]
    })
    applySync(index, { changed: batch, removed: ids.filter((id) => !now.has(id)) })
    done.push(...batch)
    await breathe()
  }
  if (!signal.aborted && index.open && db.open) syncSummaries(db, index)
  return { changed: done, removed: sync.removed }
}

/** How many passages to read for their vectors at once (a few per worker thread). */
export const READ_AT_ONCE = 16

/**
 * Reads every summary and passage that has no vector from this model yet (summaries first), READ_AT_ONCE at a time,
 * until there are none, it is stopped, or the index closes. `read` is the model's background reading. Returns how many
 * were read.
 */
export async function readPassages(
  index: SearchIndex,
  embedder: Pick<Embedder, 'model'>,
  read: (texts: string[], signal: AbortSignal) => Promise<Float32Array[]>,
  o: { signal: AbortSignal; vectors?: Vectors; onProgress?: () => void }
): Promise<number> {
  let count = 0
  while (!o.signal.aborted && index.open) {
    const todo = index.withoutVectors(embedder.model, READ_AT_ONCE)
    if (!todo.length) break
    const vecs = await read(
      todo.map((t) => t.text),
      o.signal
    )
    if (o.signal.aborted || !index.open) break
    const made = todo.map((t, i) => ({ hash: t.hash, kind: t.kind, vec: vecs[i] })).filter((x) => x.vec)
    for (const kind of ['summary', 'passage'] as const) index.putVectors(embedder.model, kind, made.filter((x) => x.kind === kind))
    for (const x of made) o.vectors?.set(embedder.model, x.hash, x.vec)
    count += made.length
    o.onProgress?.()
    if (made.length < todo.length) break
  }
  return count
}
