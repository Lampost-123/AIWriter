import Database from 'better-sqlite3'
import { copyFile, rename } from 'node:fs/promises'
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join, posix, win32 } from 'node:path'
import type { BackupInfo } from '@shared/types'

// Backup files on disk, with no Electron imports so it can be unit-tested in plain Node.
// A backup is a complete, self-contained copy of world.db named so the files sort by time
// and say why they were made: 2026-10-01T22-15-03-123Z_timer.db

export type BackupReason = BackupInfo['reason']

export interface BackupFile {
  /** The file name, used as the backup's id. */
  id: string
  file: string
  createdAt: string
  sizeBytes: number
  reason: BackupReason
}

/** Keep the newest this many backups... */
export const KEEP_NEWEST = 20
/** ...plus the newest backup of each day for this many days. */
export const KEEP_DAILY_DAYS = 30

const DAY_MS = 24 * 60 * 60 * 1000
const PARTIAL = '.partial'
const NAME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})(?:-(\d{3}))?Z_(launch|timer|manual|before-restore|before-migration)\.db$/

export function backupFileName(date: Date, reason: BackupReason): string {
  // 2026-10-01T22:15:03.123Z -> 2026-10-01T22-15-03-123Z (no colons, so it's a valid Windows file name)
  const stamp = date.toISOString().replace(/:/g, '-').replace('.', '-')
  return `${stamp}_${reason}.db`
}

export function parseBackupFileName(name: string): { createdAt: string; reason: BackupReason } | null {
  const m = NAME_RE.exec(name)
  if (!m) return null
  const [, y, mo, d, h, mi, s, ms = '000', reason] = m
  const createdAt = `${y}-${mo}-${d}T${h}:${mi}:${s}.${ms}Z`
  if (Number.isNaN(Date.parse(createdAt))) return null
  return { createdAt, reason: reason as BackupReason }
}

const newestFirst = (a: { id: string; createdAt: string }, b: { id: string; createdAt: string }): number =>
  b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)

/** The backups in a folder, newest first. Other files in the folder are ignored. */
export function listBackupFiles(folder: string): BackupFile[] {
  if (!existsSync(folder)) return []
  const out: BackupFile[] = []
  for (const name of readdirSync(folder)) {
    const parsed = parseBackupFileName(name)
    if (!parsed) continue
    const file = join(folder, name)
    try {
      const st = statSync(file)
      if (st.isFile()) out.push({ id: name, file, sizeBytes: st.size, ...parsed })
    } catch {
      /* removed while listing */
    }
  }
  return out.sort(newestFirst)
}

const localDay = (ms: number): string => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

/** Retention: keep the newest 20, plus the newest backup of each (local) day for the last 30 days. */
export function backupsToDelete<T extends { id: string; createdAt: string }>(
  backups: T[],
  nowMs: number,
  keepNewest = KEEP_NEWEST,
  keepDays = KEEP_DAILY_DAYS
): T[] {
  const sorted = [...backups].sort(newestFirst)
  const keep = new Set(sorted.slice(0, keepNewest).map((b) => b.id))
  const cutoff = nowMs - keepDays * DAY_MS
  const days = new Set<string>()
  for (const b of sorted) {
    const t = Date.parse(b.createdAt)
    if (Number.isNaN(t) || t < cutoff) continue
    const day = localDay(t)
    if (days.has(day)) continue
    days.add(day)
    keep.add(b.id)
  }
  return sorted.filter((b) => !keep.has(b.id))
}

/** Deletes the backups retention doesn't keep, and leftovers from interrupted backups. Returns the deleted ids. */
export function pruneBackups(folder: string, nowMs: number = Date.now()): string[] {
  const doomed = backupsToDelete(listBackupFiles(folder), nowMs)
  const deleted: string[] = []
  for (const b of doomed) {
    try {
      rmSync(b.file, { force: true })
      deleted.push(b.id)
    } catch {
      /* in use (e.g. being copied); try again next time */
    }
  }
  removeStalePartials(folder, nowMs)
  return deleted
}

/** Removes half-written backups left by a crash. Recent ones may still be in progress, so they stay. */
export function removeStalePartials(folder: string, nowMs: number = Date.now()): void {
  if (!existsSync(folder)) return
  for (const name of readdirSync(folder)) {
    if (!name.endsWith(PARTIAL)) continue
    const file = join(folder, name)
    try {
      if (nowMs - statSync(file).mtimeMs > 60 * 60 * 1000) rmSync(file, { force: true })
    } catch {
      /* ignore */
    }
  }
}

// On Windows a file that was just written is often held open for a moment by antivirus or a
// cloud sync app (OneDrive, Dropbox), and renaming it fails with EPERM/EBUSY/EACCES. Try again
// briefly before giving up.
const LOCKED = new Set(['EPERM', 'EBUSY', 'EACCES'])
const RENAME_TRIES = 8
const RENAME_WAIT_MS = 125
const isLocked = (e: unknown): boolean => LOCKED.has((e as { code?: string })?.code ?? '')

/** renameSync, retried for up to about a second while the file is locked by another program. */
export function renameRetrySync(from: string, to: string, tries = RENAME_TRIES, waitMs = RENAME_WAIT_MS): void {
  for (let i = 1; ; i++) {
    try {
      renameSync(from, to)
      return
    } catch (e) {
      if (i >= tries || !isLocked(e)) throw e
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, waitMs)
    }
  }
}

/** The same without blocking: used for backups made while Adam writes. */
export async function renameRetry(from: string, to: string, tries = RENAME_TRIES, waitMs = RENAME_WAIT_MS): Promise<void> {
  for (let i = 1; ; i++) {
    try {
      await rename(from, to)
      return
    } catch (e) {
      if (i >= tries || !isLocked(e)) throw e
      await new Promise((r) => setTimeout(r, waitMs))
    }
  }
}

function freeName(folder: string, date: Date, reason: BackupReason): string {
  let t = date.getTime()
  let name = backupFileName(new Date(t), reason)
  while (existsSync(join(folder, name)) || existsSync(join(folder, name + PARTIAL))) {
    t += 1
    name = backupFileName(new Date(t), reason)
  }
  return name
}

function toBackupFile(folder: string, name: string): BackupFile {
  const file = join(folder, name)
  const parsed = parseBackupFileName(name)!
  return { id: name, file, sizeBytes: statSync(file).size, ...parsed }
}

/** Makes the copy a plain single-file database (no -wal/-shm companions), so it can be copied or opened anywhere. */
function makeSelfContained(file: string): void {
  const d = new Database(file)
  try {
    d.pragma('journal_mode = DELETE')
  } finally {
    d.close()
  }
}

/**
 * Backs up an open database with SQLite's online backup, which stays consistent while the
 * world is in use and copies in small steps so the app never stalls. The file only gets its
 * final name once it is complete.
 */
export async function writeBackup(db: Database.Database, folder: string, reason: BackupReason, date: Date = new Date()): Promise<BackupFile> {
  mkdirSync(folder, { recursive: true })
  const name = freeName(folder, date, reason)
  const final = join(folder, name)
  const tmp = final + PARTIAL
  try {
    await db.backup(tmp)
    makeSelfContained(tmp)
    await renameRetry(tmp, final)
  } catch (e) {
    rmSync(tmp, { force: true })
    throw e
  }
  return toBackupFile(folder, name)
}

/** The same, synchronously (used just before a database layout change, while nothing else runs). */
export function writeBackupSync(db: Database.Database, folder: string, reason: BackupReason, date: Date = new Date()): BackupFile {
  mkdirSync(folder, { recursive: true })
  const name = freeName(folder, date, reason)
  const final = join(folder, name)
  const tmp = final + PARTIAL
  try {
    rmSync(tmp, { force: true })
    db.prepare('VACUUM INTO ?').run(tmp)
    renameRetrySync(tmp, final)
  } catch (e) {
    rmSync(tmp, { force: true })
    throw e
  }
  return toBackupFile(folder, name)
}

/** Copies a finished backup into another folder (the optional second backup folder). */
export async function copyBackupTo(backup: BackupFile, folder: string): Promise<string> {
  mkdirSync(folder, { recursive: true })
  const final = join(folder, backup.id)
  if (existsSync(final)) return final
  const tmp = final + PARTIAL
  try {
    await copyFile(backup.file, tmp)
    await renameRetry(tmp, final)
  } catch (e) {
    rmSync(tmp, { force: true })
    throw e
  }
  return final
}

export type BackupCheck = { ok: true } | { ok: false; problem: 'damaged' | 'other-world' }

/** Checks a backup can be restored into the world with this id. */
export function checkBackupFile(file: string, worldId: string): BackupCheck {
  let d: Database.Database | null = null
  try {
    d = new Database(file, { readonly: true, fileMustExist: true })
    if (d.pragma('quick_check', { simple: true }) !== 'ok') return { ok: false, problem: 'damaged' }
    const row = d.prepare("SELECT value FROM meta WHERE key = 'id'").get() as { value: string } | undefined
    if (!row) return { ok: false, problem: 'damaged' }
    return row.value === worldId ? { ok: true } : { ok: false, problem: 'other-world' }
  } catch {
    return { ok: false, problem: 'damaged' }
  } finally {
    d?.close()
  }
}

/** True when `child` is `parent` or somewhere inside it. */
export function isSameOrInside(child: string, parent: string, platform: string = process.platform): boolean {
  const p = platform === 'win32' ? win32 : posix
  const norm = (x: string): string => (platform === 'win32' ? p.resolve(x).toLowerCase() : p.resolve(x))
  const rel = p.relative(norm(parent), norm(child))
  return rel === '' || (rel.split(/[\\/]/)[0] !== '..' && !p.isAbsolute(rel))
}
