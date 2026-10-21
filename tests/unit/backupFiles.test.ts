import Database from 'better-sqlite3'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as repo from '../../src/main/db/repo'
import { migrate } from '../../src/main/db/migrations'
import {
  backupFileName,
  backupsToDelete,
  checkBackupFile,
  copyBackupTo,
  isSameOrInside,
  listBackupFiles,
  parseBackupFileName,
  pruneBackups,
  writeBackup,
  writeBackupSync
} from '../../src/main/services/backupFiles'

const DAY = 24 * 60 * 60 * 1000
const HOUR = 60 * 60 * 1000

let dir: string
// Every database a test opens, closed after it even when it fails, so Windows can delete its folder.
const opened: Database.Database[] = []
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aiwrite-backups-'))
})
afterEach(() => {
  for (const db of opened.splice(0)) if (db.open) db.close()
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
})

function worldDb(): Database.Database {
  const db = new Database(join(dir, 'world.db'))
  opened.push(db)
  db.pragma('journal_mode = WAL')
  migrate(db)
  repo.initWorld(db, 'world-1', 'Test world')
  return db
}

describe('backup file names', () => {
  it('sort by time, carry the reason and contain no colons', () => {
    const name = backupFileName(new Date('2026-10-01T22:15:03.045Z'), 'timer')
    expect(name).toBe('2026-10-01T22-15-03-045Z_timer.db')
    expect(parseBackupFileName(name)).toEqual({ createdAt: '2026-10-01T22:15:03.045Z', reason: 'timer' })
    expect(parseBackupFileName('2026-10-01T22-15-03Z_before-restore.db')).toEqual({
      createdAt: '2026-10-01T22:15:03.000Z',
      reason: 'before-restore'
    })
    const a = backupFileName(new Date('2026-09-30T23:59:59.999Z'), 'manual')
    expect([name, a].sort()).toEqual([a, name])
  })

  it('ignores anything that is not a backup', () => {
    for (const n of ['world.db', 'notes.txt', '2026-10-01T22-15-03Z_other.db', '2026-10-01T22-15-03Z_timer.db.partial', '2026-13-45T22-15-03Z_timer.db']) {
      expect(parseBackupFileName(n)).toBeNull()
    }
  })
})

describe('retention', () => {
  const at = (ms: number, i: number) => ({ id: `b${i}`, createdAt: new Date(ms).toISOString() })
  const now = Date.parse('2026-10-01T12:00:00.000Z')

  it('keeps everything while there are 20 or fewer', () => {
    const list = Array.from({ length: 20 }, (_, i) => at(now - i * 400 * DAY, i))
    expect(backupsToDelete(list, now)).toEqual([])
  })

  it('keeps the newest 20 plus the newest of each day for 30 days', () => {
    // 3 a day (at noon UTC, +1h and +2h) for 40 days: 120 backups.
    const list = []
    let i = 0
    for (let d = 0; d < 40; d++) for (let h = 0; h < 3; h++) list.push(at(now - d * DAY + h * HOUR - 3 * HOUR, i++))
    const doomed = new Set(backupsToDelete(list, now).map((b) => b.id))
    const kept = list.filter((b) => !doomed.has(b.id))
    const newest20 = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20)
    for (const b of newest20) expect(doomed.has(b.id)).toBe(false)
    // Each of the last 30 days keeps its newest backup.
    const keptDays = new Set(kept.map((b) => new Date(b.createdAt).toDateString()))
    for (let d = 0; d < 30; d++) expect(keptDays.has(new Date(now - d * DAY - HOUR).toDateString())).toBe(true)
    // Nothing older than 30 days survives unless it's in the newest 20.
    for (const b of kept) {
      if (newest20.includes(b)) continue
      expect(Date.parse(b.createdAt)).toBeGreaterThanOrEqual(now - 30 * DAY)
    }
    // Days 7-29 are past the newest 20, so they keep exactly one each.
    expect(kept.length).toBe(20 + 23)
  })
})

describe('writing, listing and pruning backups', () => {
  it('makes a complete, single-file copy of an open world', async () => {
    const db = worldDb()
    const folder = join(dir, 'backups')
    const b = await writeBackup(db, folder, 'launch', new Date('2026-10-01T10:00:00.000Z'))
    expect(b.id).toBe('2026-10-01T10-00-00-000Z_launch.db')
    expect(b.sizeBytes).toBeGreaterThan(0)
    expect(readdirSync(folder)).toEqual([b.id]) // no -wal, -shm or .partial left behind
    const header = readFileSync(b.file).subarray(18, 20)
    expect([...header]).toEqual([1, 1]) // not in WAL mode: a plain database file
    expect(checkBackupFile(b.file, 'world-1')).toEqual({ ok: true })
    const copy = new Database(b.file, { readonly: true })
    expect((copy.prepare("SELECT value FROM meta WHERE key = 'name'").get() as { value: string }).value).toBe('Test world')
    copy.close()
    db.close()
  })

  it('never overwrites a backup made in the same millisecond', async () => {
    const db = worldDb()
    const folder = join(dir, 'backups')
    const when = new Date('2026-10-01T10:00:00.000Z')
    const a = await writeBackup(db, folder, 'manual', when)
    const b = await writeBackup(db, folder, 'manual', when)
    expect(a.id).not.toBe(b.id)
    expect(listBackupFiles(folder).map((x) => x.id)).toEqual([b.id, a.id])
    db.close()
  })

  it('makes a synchronous copy before a layout change', () => {
    const db = worldDb()
    const b = writeBackupSync(db, join(dir, 'backups'), 'before-migration')
    expect(b.reason).toBe('before-migration')
    expect(checkBackupFile(b.file, 'world-1')).toEqual({ ok: true })
    db.close()
  })

  it('lists newest first and prunes by the retention rule', async () => {
    const db = worldDb()
    const folder = join(dir, 'backups')
    const now = Date.parse('2026-10-01T12:00:00.000Z')
    const first = await writeBackup(db, folder, 'launch', new Date(now - 60 * DAY))
    for (let i = 0; i < 22; i++) await writeBackup(db, folder, 'timer', new Date(now - i * 30 * 60 * 1000))
    mkdirSync(join(folder, 'not-a-backup'))
    writeFileSync(join(folder, 'notes.txt'), 'hello')
    expect(listBackupFiles(folder)).toHaveLength(23)
    expect(listBackupFiles(folder)[0].createdAt).toBe(new Date(now).toISOString())

    const deleted = pruneBackups(folder, now)
    expect(deleted).toContain(first.id) // 60 days old and not among the newest 20
    const left = listBackupFiles(folder)
    // The newest 20 stay. The two oldest timer backups go too, unless the time zone puts
    // them on an earlier local day, where each would be that day's newest.
    expect(left.length).toBeGreaterThanOrEqual(20)
    expect(left.length).toBeLessThan(23)
    expect(existsSync(join(folder, 'notes.txt'))).toBe(true)
    db.close()
  }, 30_000)

  it('removes half-written backups left by a crash, but not ones still being written', () => {
    const folder = join(dir, 'backups')
    mkdirSync(folder)
    const stale = join(folder, '2026-10-01T10-00-00-000Z_timer.db.partial')
    const fresh = join(folder, '2026-10-01T11-00-00-000Z_timer.db.partial')
    writeFileSync(stale, 'x')
    writeFileSync(fresh, 'x')
    const old = (Date.now() - 2 * HOUR) / 1000
    utimesSync(stale, old, old)
    pruneBackups(folder)
    expect(existsSync(stale)).toBe(false)
    expect(existsSync(fresh)).toBe(true)
  })

  it('copies a backup to a second folder', async () => {
    const db = worldDb()
    const b = await writeBackup(db, join(dir, 'backups'), 'manual')
    const dest = join(dir, 'Dropbox', 'Test world')
    const copied = await copyBackupTo(b, dest)
    expect(copied).toBe(join(dest, b.id))
    expect(readFileSync(copied).equals(readFileSync(b.file))).toBe(true)
    expect(readdirSync(dest)).toEqual([b.id])
    db.close()
  })
})

describe('checkBackupFile', () => {
  it('refuses a damaged file or another world', async () => {
    const db = worldDb()
    const b = await writeBackup(db, join(dir, 'backups'), 'manual')
    expect(checkBackupFile(b.file, 'another-world')).toEqual({ ok: false, problem: 'other-world' })
    const junk = join(dir, 'junk.db')
    writeFileSync(junk, 'this is not a database')
    expect(checkBackupFile(junk, 'world-1')).toEqual({ ok: false, problem: 'damaged' })
    expect(checkBackupFile(join(dir, 'missing.db'), 'world-1')).toEqual({ ok: false, problem: 'damaged' })
    db.close()
  })
})

describe('isSameOrInside', () => {
  it('works with POSIX paths', () => {
    expect(isSameOrInside('/home/a/lib', '/home/a/lib', 'linux')).toBe(true)
    expect(isSameOrInside('/home/a/lib/world/backups', '/home/a/lib', 'linux')).toBe(true)
    expect(isSameOrInside('/home/a/library2', '/home/a/lib', 'linux')).toBe(false)
    expect(isSameOrInside('/home/a', '/home/a/lib', 'linux')).toBe(false)
    expect(isSameOrInside('/home/a/lib/..data', '/home/a/lib', 'linux')).toBe(true)
  })

  it('ignores case on Windows', () => {
    expect(isSameOrInside('C:\\Users\\Adam\\Documents\\AI Write\\World', 'c:\\users\\adam\\documents\\ai write', 'win32')).toBe(true)
    expect(isSameOrInside('C:\\Users\\Adam\\Dropbox', 'C:\\Users\\Adam\\Documents\\AI Write', 'win32')).toBe(false)
    expect(isSameOrInside('D:\\AI Write', 'C:\\AI Write', 'win32')).toBe(false)
  })
})
