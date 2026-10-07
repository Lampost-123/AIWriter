// The search index (story memory step 5): one file in each world folder, search-index.db, beside world.db and
// history.db (Adam, 2026-10-07). It holds the scenes' words cut into passages, a full-text index of them (SQLite's
// FTS5) and the search model's vectors, by the hash of the words they were made from. Everything in it can be made
// again from the world at any time, so it never stops a world opening: a missing file is made, a damaged one is moved
// aside (as history.db's is) and started afresh, and one that is locked or from a newer AI Write is left as it is
// while an index in memory, made again in the background, stands in for it. Exports, copies and backups leave it out
// (it is made again where the world lands). All of its SQL is here. No Electron imports.

import Database from 'better-sqlite3'
import { closeSync, existsSync, openSync, readSync } from 'node:fs'
import { join } from 'node:path'
import type { ID } from '@shared/types'
import { renameRetrySync } from '../util'
import { isDamaged, problemOf, type HistoryProblem } from '../history/open'
import type { Passage } from './text'

type DB = Database.Database
type Row = Record<string, unknown>

export const INDEX_FILE = 'search-index.db'
export const indexPath = (folder: string): string => join(folder, INDEX_FILE)

/** The layout this version writes (PRAGMA user_version). */
export const INDEX_VERSION = 1

const SCHEMA_V1 = `
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE scenes (scene_id TEXT PRIMARY KEY, hash TEXT NOT NULL);
  CREATE TABLE passages (
    id INTEGER PRIMARY KEY,
    scene_id TEXT NOT NULL,
    n INTEGER NOT NULL,
    text TEXT NOT NULL,
    hash TEXT NOT NULL
  );
  CREATE INDEX passages_by_scene ON passages (scene_id, n);
  CREATE INDEX passages_by_hash ON passages (hash);
  CREATE VIRTUAL TABLE passage_words USING fts5(text, tokenize = 'porter unicode61 remove_diacritics 2');
  CREATE TABLE vectors (
    hash TEXT NOT NULL,
    model TEXT NOT NULL,
    kind TEXT NOT NULL,
    vec BLOB NOT NULL,
    at INTEGER NOT NULL,
    PRIMARY KEY (hash, model)
  ) WITHOUT ROWID;
`

const COLUMNS: Record<string, string[]> = {
  meta: ['key', 'value'],
  scenes: ['scene_id', 'hash'],
  passages: ['id', 'scene_id', 'n', 'text', 'hash'],
  vectors: ['hash', 'model', 'kind', 'vec', 'at']
}

/** The file was written by a newer AI Write: it is left as it is. */
export class NewerIndexError extends Error {}
/** The file isn't AI Write's search index: treated as damaged (moved aside). */
class StrangeIndexError extends Error {
  readonly code = 'SQLITE_CORRUPT'
}

/** Makes (in a new file) or checks the layout. */
function migrate(db: DB, nowIso: string): void {
  const version = db.pragma('user_version', { simple: true }) as number
  if (version > INDEX_VERSION) throw new NewerIndexError(`${INDEX_FILE} is version ${version}`)
  if (version < 1) {
    const tables = (db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'").get() as Row).n as number
    if (tables > 0) throw new StrangeIndexError(`${INDEX_FILE} holds tables AI Write did not make`)
    db.transaction(() => {
      db.exec(SCHEMA_V1)
      db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('created_at', nowIso)
      db.pragma(`user_version = ${INDEX_VERSION}`)
    })()
  }
  for (const [table, want] of Object.entries(COLUMNS)) {
    const have = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Row[]).map((r) => r.name as string))
    if (want.some((c) => !have.has(c))) throw new StrangeIndexError(`${INDEX_FILE} has no ${table} table this version can use`)
  }
}

const SQLITE_HEADER = 'SQLite format 3\u0000'
const SIDE_FILES = ['-wal', '-shm']

/** True when the file plainly isn't a database. Throws if it can't be read (locked, say). */
function plainlyDamaged(file: string): boolean {
  if (!existsSync(file)) return false
  const fd = openSync(file, 'r')
  try {
    const head = Buffer.alloc(16)
    const n = readSync(fd, head, 0, 16, 0)
    return n > 0 && (n < 16 || head.toString('latin1') !== SQLITE_HEADER)
  } finally {
    closeSync(fd)
  }
}

const stampOf = (nowMs: number): string => {
  const d = new Date(nowMs)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

/** Moves the file (and SQLite's files beside it) aside as search-index.db.damaged-<time>, as history.db's are. */
export function setIndexAside(folder: string, nowMs: number): string {
  const base = `${INDEX_FILE}.damaged-${stampOf(nowMs)}`
  let name = base
  for (let i = 2; existsSync(join(folder, name)) || SIDE_FILES.some((s) => existsSync(join(folder, name + s))); i++) name = `${base}-${i}`
  const file = indexPath(folder)
  if (existsSync(file)) renameRetrySync(file, join(folder, name))
  for (const side of SIDE_FILES) if (existsSync(file + side)) renameRetrySync(file + side, join(folder, name + side))
  return name
}

function connect(file: string, nowIso: string): DB {
  const db = new Database(file)
  try {
    // A busy file is given up on quickly: searching never holds up writing.
    db.pragma('busy_timeout = 250')
    const version = db.pragma('user_version', { simple: true }) as number
    if (version > INDEX_VERSION) throw new NewerIndexError(`${INDEX_FILE} is version ${version}`)
    migrate(db, nowIso)
    if (file !== ':memory:') {
      db.pragma('journal_mode = WAL')
      db.pragma('synchronous = NORMAL')
    }
    return db
  } catch (e) {
    if (db.open) db.close()
    throw e
  }
}

export type IndexProblem = HistoryProblem

export interface OpenedIndex {
  index: SearchIndex
  /** Why the file couldn't be used (the index is in memory for now), or null when it is the file. */
  problem: IndexProblem | null
  /** The name a damaged file was moved aside to, or null. */
  setAside: string | null
}

/**
 * Opens the world's search index: the file beside world.db, made when missing and started afresh when damaged; or,
 * when the file is locked or from a newer AI Write, an index in memory (made again from the world in the background).
 * Never throws for a problem with the file. Throws only when no index can be made at all (no full-text search here).
 */
export function openSearchIndex(folder: string, nowMs = Date.now()): OpenedIndex {
  const file = indexPath(folder)
  const nowIso = new Date(nowMs).toISOString()
  const inMemory = (problem: IndexProblem, error: unknown): OpenedIndex => {
    console.warn(`The search index is kept in memory for now (${problem})`, error instanceof Error ? error.message : error)
    return { index: memorySearchIndex(nowMs), problem, setAside: null }
  }
  const afresh = (): OpenedIndex => {
    try {
      const name = setIndexAside(folder, nowMs)
      console.warn(`The search index was damaged and starts afresh; the old file was set aside as ${name}`)
      return { index: new SearchIndex(connect(file, nowIso), true), problem: null, setAside: name }
    } catch (e) {
      return inMemory(problemOf(e), e)
    }
  }
  try {
    // A journal left behind without its database mustn't be read into a new one.
    if (!existsSync(file) && SIDE_FILES.some((s) => existsSync(file + s))) setIndexAside(folder, nowMs)
    if (plainlyDamaged(file)) return afresh()
    return { index: new SearchIndex(connect(file, nowIso), true), problem: null, setAside: null }
  } catch (e) {
    if (e instanceof NewerIndexError) return inMemory('newer', e)
    if (isDamaged(e)) return afresh()
    return inMemory(problemOf(e), e)
  }
}

/** An index in memory only (while the file can't be used; tests). */
export const memorySearchIndex = (nowMs = Date.now()): SearchIndex => new SearchIndex(connect(':memory:', new Date(nowMs).toISOString()), false)

/** A passage as the index holds it. */
export interface StoredPassage {
  id: number
  sceneId: ID
  n: number
  text: string
  hash: string
}

const toPassage = (r: Row): StoredPassage => ({
  id: r.id as number,
  sceneId: r.scene_id as string,
  n: r.n as number,
  text: r.text as string,
  hash: r.hash as string
})

const toVec = (b: Buffer): Float32Array => {
  const copy = new Uint8Array(b.byteLength)
  copy.set(b)
  return new Float32Array(copy.buffer)
}
const fromVec = (v: Float32Array): Buffer => Buffer.from(v.buffer, v.byteOffset, v.byteLength)

/** How many vectors of texts other than passages (facts, summaries, searches) are kept, newest first. */
export const OTHER_VECTORS_KEPT = 20_000

/** One open search index: the file, or one in memory. */
export class SearchIndex {
  constructor(
    readonly db: DB,
    /** True when this is the file beside world.db (it outlasts the session). */
    readonly inFile: boolean
  ) {}

  get open(): boolean {
    return this.db.open
  }

  close(): void {
    if (this.db.open) this.db.close()
  }

  getMeta(key: string): string | null {
    const r = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as Row | undefined
    return r ? (r.value as string) : null
  }

  setMeta(key: string, value: string): void {
    this.db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, value)
  }

  /** Each indexed scene's hash (of the words its passages were cut from). */
  sceneHashes(): Map<ID, string> {
    return new Map((this.db.prepare('SELECT scene_id, hash FROM scenes').all() as Row[]).map((r) => [r.scene_id as string, r.hash as string]))
  }

  /** Puts a scene's passages in place of what the index had for it. */
  putScene(sceneId: ID, hash: string, passages: Passage[]): void {
    const db = this.db
    db.transaction(() => {
      this.dropScene(sceneId)
      const add = db.prepare('INSERT INTO passages (scene_id, n, text, hash) VALUES (?, ?, ?, ?)')
      const words = db.prepare('INSERT INTO passage_words (rowid, text) VALUES (?, ?)')
      for (const p of passages) {
        const id = add.run(sceneId, p.n, p.text, p.hash).lastInsertRowid
        words.run(id, p.text)
      }
      db.prepare('INSERT OR REPLACE INTO scenes (scene_id, hash) VALUES (?, ?)').run(sceneId, hash)
    })()
  }

  private dropScene(sceneId: ID): void {
    const ids = (this.db.prepare('SELECT id FROM passages WHERE scene_id = ?').all(sceneId) as Row[]).map((r) => r.id as number)
    if (ids.length) {
      this.db.prepare('DELETE FROM passage_words WHERE rowid IN (SELECT value FROM json_each(?))').run(JSON.stringify(ids))
      this.db.prepare('DELETE FROM passages WHERE scene_id = ?').run(sceneId)
    }
    this.db.prepare('DELETE FROM scenes WHERE scene_id = ?').run(sceneId)
  }

  /** Forgets scenes that are gone from the world (deleted, or emptied from Recently deleted). */
  removeScenes(ids: ID[]): void {
    if (!ids.length) return
    this.db.transaction(() => {
      for (const id of ids) this.dropScene(id)
    })()
  }

  /**
   * Keyword search over the passages of these scenes: any of `words` (SQLite stems them, so "promised" finds
   * "promise"), best first, each with its BM25 score (higher is better here).
   */
  keyword(words: string[], sceneIds: ID[], limit = 12): { passage: StoredPassage; score: number }[] {
    if (!words.length || !sceneIds.length) return []
    const match = words.map((w) => `"${w.replace(/"/g, '""')}"`).join(' OR ')
    const rows = this.db
      .prepare(
        `SELECT p.*, bm25(passage_words) AS score FROM passage_words JOIN passages p ON p.id = passage_words.rowid
         WHERE passage_words MATCH ? AND p.scene_id IN (SELECT value FROM json_each(?))
         ORDER BY score LIMIT ?`
      )
      .all(match, JSON.stringify(sceneIds), limit) as Row[]
    // SQLite's bm25() is lower for a better match.
    return rows.map((r) => ({ passage: toPassage(r), score: -(r.score as number) }))
  }

  /** Every passage of these scenes. */
  passagesIn(sceneIds: ID[]): StoredPassage[] {
    if (!sceneIds.length) return []
    return (
      this.db.prepare('SELECT * FROM passages WHERE scene_id IN (SELECT value FROM json_each(?)) ORDER BY scene_id, n').all(JSON.stringify(sceneIds)) as Row[]
    ).map(toPassage)
  }

  /** How many passages the index holds, and how many have a vector from this model. */
  counts(model: string | null): { passages: number; withVectors: number } {
    const passages = (this.db.prepare('SELECT COUNT(DISTINCT hash) AS n FROM passages').get() as Row).n as number
    const withVectors = model
      ? ((this.db.prepare('SELECT COUNT(DISTINCT p.hash) AS n FROM passages p JOIN vectors v ON v.hash = p.hash AND v.model = ?').get(model) as Row)
          .n as number)
      : 0
    return { passages, withVectors }
  }

  /** Passages with no vector from this model yet (one per distinct text), at most `limit`. */
  withoutVectors(model: string, limit: number): { hash: string; text: string }[] {
    return this.db
      .prepare(
        `SELECT p.hash, MIN(p.text) AS text FROM passages p
         WHERE NOT EXISTS (SELECT 1 FROM vectors v WHERE v.hash = p.hash AND v.model = ?)
         GROUP BY p.hash LIMIT ?`
      )
      .all(model, limit) as { hash: string; text: string }[]
  }

  /** The vectors this model made for these texts (by hash), those there are. */
  vectors(model: string, hashes: string[]): Map<string, Float32Array> {
    const out = new Map<string, Float32Array>()
    if (!hashes.length) return out
    const rows = this.db
      .prepare('SELECT hash, vec FROM vectors WHERE model = ? AND hash IN (SELECT value FROM json_each(?))')
      .all(model, JSON.stringify([...new Set(hashes)])) as Row[]
    for (const r of rows) out.set(r.hash as string, toVec(r.vec as Buffer))
    return out
  }

  /** Keeps vectors this model made. `kind`: a passage's, or another text's (a fact, a summary, a search). */
  putVectors(model: string, kind: 'passage' | 'other', items: { hash: string; vec: Float32Array }[], nowMs = Date.now()): void {
    if (!items.length) return
    const put = this.db.prepare('INSERT OR REPLACE INTO vectors (hash, model, kind, vec, at) VALUES (?, ?, ?, ?, ?)')
    this.db.transaction(() => {
      for (const x of items) put.run(x.hash, model, kind, fromVec(x.vec), nowMs)
    })()
  }

  /**
   * Tidies the vectors: those of another model go (the model changed), passages' vectors whose words are gone go,
   * and only the newest OTHER_VECTORS_KEPT of the rest are kept.
   */
  tidy(model: string | null): void {
    const db = this.db
    db.transaction(() => {
      if (model) db.prepare('DELETE FROM vectors WHERE model <> ?').run(model)
      db.prepare("DELETE FROM vectors WHERE kind = 'passage' AND NOT EXISTS (SELECT 1 FROM passages p WHERE p.hash = vectors.hash)").run()
      db.prepare(
        `DELETE FROM vectors WHERE kind = 'other' AND hash IN (
           SELECT hash FROM vectors WHERE kind = 'other' ORDER BY at DESC LIMIT -1 OFFSET ?)`
      ).run(OTHER_VECTORS_KEPT)
    })()
  }
}
