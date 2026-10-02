// Opening a world's history.db, the file beside world.db that holds its scenes' snapshots and drafts.
// Nothing here ever stops a world opening: a missing file is made, a damaged one is moved aside
// (never deleted) and History starts afresh, and a file that is locked by another program, or was
// written by a newer AI Write, is left as it is while History is out of reach. No Electron imports.

import Database from 'better-sqlite3'
import { closeSync, existsSync, openSync, readSync } from 'node:fs'
import { join } from 'node:path'
import { renameRetrySync } from '../util'
import { HISTORY_VERSION, migrateHistory, NewerHistoryError } from './store'

type DB = Database.Database

export const HISTORY_FILE = 'history.db'
export const historyPath = (folder: string): string => join(folder, HISTORY_FILE)

/** Why history.db can't be used right now. */
export type HistoryProblem = 'locked' | 'full' | 'newer' | 'unreachable'

export type OpenedHistory =
  | {
      ok: true
      db: DB
      /** The name a damaged history.db was moved aside to (History started afresh), or null. */
      setAside: string | null
    }
  | { ok: false; problem: HistoryProblem; error: unknown }

const codeOf = (e: unknown): string => String((e as { code?: unknown })?.code ?? '')

/** The file isn't a database AI Write can read: damaged, or something else under that name. */
export function isDamaged(e: unknown): boolean {
  const code = codeOf(e)
  return code.startsWith('SQLITE_CORRUPT') || code === 'SQLITE_NOTADB'
}

/** The file is held for a moment by another program (or another write): worth trying again soon. */
export function isBusy(e: unknown): boolean {
  const code = codeOf(e)
  return code.startsWith('SQLITE_BUSY') || code.startsWith('SQLITE_LOCKED') || ['EBUSY', 'EPERM', 'EACCES'].includes(code)
}

export function problemOf(e: unknown): HistoryProblem {
  if (e instanceof NewerHistoryError) return 'newer'
  const code = codeOf(e)
  if (code === 'SQLITE_FULL' || code === 'ENOSPC') return 'full'
  if (isBusy(e)) return 'locked'
  return 'unreachable'
}

/** Opens (or makes) the file and brings it up to this version's layout. */
function connect(file: string, nowIso: string): DB {
  const db = new Database(file)
  try {
    // A busy file is given up on quickly: History never holds up writing.
    db.pragma('busy_timeout = 250')
    // A history.db from a newer AI Write is left exactly as it is, so this is checked before anything is written.
    const version = db.pragma('user_version', { simple: true }) as number
    if (version > HISTORY_VERSION) throw new NewerHistoryError(`history.db is version ${version}`)
    // Space freed by thinning is given back bit by bit (this only takes in a new file).
    if (version === 0) db.pragma('auto_vacuum = INCREMENTAL')
    // The layout is checked (and made, in a new file) before the file is switched to WAL.
    migrateHistory(db, nowIso)
    db.pragma('journal_mode = WAL')
    db.pragma('synchronous = NORMAL')
    return db
  } catch (e) {
    if (db.open) db.close()
    throw e
  }
}

/** Every SQLite database starts with these 16 bytes. */
const SQLITE_HEADER = 'SQLite format 3\u0000'

/**
 * True when the file plainly isn't a database (so it is set aside before SQLite opens it and touches the
 * files beside it). An empty file is a new database. Throws if the file can't be read (locked, say).
 */
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

/** "20261002-143005": when a file was set aside, in a name every system accepts. */
const stampOf = (nowMs: number): string => {
  const d = new Date(nowMs)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

/** The files SQLite keeps beside a database while it is in use. */
const SIDE_FILES = ['-wal', '-shm']

/**
 * Moves history.db (and the files SQLite keeps beside it) aside as history.db.damaged-<time>, so a
 * fresh one can start. Returns the name it was given. Throws if it can't be moved.
 */
export function setAside(folder: string, nowMs: number): string {
  const base = `${HISTORY_FILE}.damaged-${stampOf(nowMs)}`
  let name = base
  for (let i = 2; existsSync(join(folder, name)) || SIDE_FILES.some((s) => existsSync(join(folder, name + s))); i++) name = `${base}-${i}`
  const file = historyPath(folder)
  if (existsSync(file)) renameRetrySync(file, join(folder, name))
  // The side files go with it: a fresh history.db must never pick up a journal that isn't its own.
  for (const side of SIDE_FILES) if (existsSync(file + side)) renameRetrySync(file + side, join(folder, name + side))
  return name
}

/** Notes in a fresh history.db that it replaced a damaged one (History says so for a while). */
function noteFreshStart(db: DB, setAsideAs: string, nowIso: string): void {
  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(
    'started_afresh',
    JSON.stringify({ at: nowIso, setAside: setAsideAs })
  )
}

/** Moves a damaged history.db aside and starts a fresh one. */
export function startAfresh(folder: string, nowMs: number): OpenedHistory {
  const nowIso = new Date(nowMs).toISOString()
  try {
    const name = setAside(folder, nowMs)
    const db = connect(historyPath(folder), nowIso)
    noteFreshStart(db, name, nowIso)
    return { ok: true, db, setAside: name }
  } catch (e) {
    return { ok: false, problem: problemOf(e), error: e }
  }
}

/** Opens the world's history.db, making it if it is missing and starting afresh if it is damaged. */
export function openHistory(folder: string, nowMs: number): OpenedHistory {
  const file = historyPath(folder)
  try {
    // A journal left behind without its database (the file was removed by hand) mustn't be read into a new one.
    if (!existsSync(file) && SIDE_FILES.some((s) => existsSync(file + s))) setAside(folder, nowMs)
    if (plainlyDamaged(file)) return startAfresh(folder, nowMs)
    return { ok: true, db: connect(file, new Date(nowMs).toISOString()), setAside: null }
  } catch (e) {
    if (isDamaged(e)) return startAfresh(folder, nowMs)
    return { ok: false, problem: problemOf(e), error: e }
  }
}

/** When History last had to start afresh in this file (and what the damaged one was named), if it did. */
export function freshStartOf(db: DB): { at: string; setAside: string } | null {
  const r = db.prepare('SELECT value FROM meta WHERE key = ?').get('started_afresh') as { value: string } | undefined
  if (!r) return null
  try {
    const v = JSON.parse(r.value) as { at?: unknown; setAside?: unknown }
    return typeof v.at === 'string' && typeof v.setAside === 'string' ? { at: v.at, setAside: v.setAside } : null
  } catch {
    return null
  }
}
