import Database from 'better-sqlite3'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { freshStartOf, historyPath, isDamaged, openHistory, setAside } from './open'
import { HISTORY_VERSION, migrateHistory } from './store'

const NOW = Date.parse('2026-10-02T12:00:00.000Z')
const GARBAGE = Buffer.from('This is not a database at all. '.repeat(200))

let folder: string
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'aiwrite-history-'))
})
afterEach(() => rmSync(folder, { recursive: true, force: true }))

const asideFiles = () => readdirSync(folder).filter((f) => f.includes('.damaged-'))

describe('openHistory', () => {
  it('makes history.db when it is missing', () => {
    const r = openHistory(folder, NOW)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.setAside).toBeNull()
    expect(r.db.pragma('user_version', { simple: true })).toBe(HISTORY_VERSION)
    expect(r.db.pragma('journal_mode', { simple: true })).toBe('wal')
    expect(freshStartOf(r.db)).toBeNull()
    r.db.close()
    expect(existsSync(historyPath(folder))).toBe(true)
  })

  it('opens the same file again with what it holds', () => {
    const first = openHistory(folder, NOW)
    if (!first.ok) throw new Error('should open')
    first.db.prepare("INSERT INTO meta (key, value) VALUES ('mark', 'kept')").run()
    first.db.close()
    const again = openHistory(folder, NOW)
    if (!again.ok) throw new Error('should open')
    expect(again.db.prepare("SELECT value FROM meta WHERE key = 'mark'").get()).toEqual({ value: 'kept' })
    again.db.close()
  })

  it('sets a damaged history.db aside, never deleting it, and starts afresh', () => {
    writeFileSync(historyPath(folder), GARBAGE)
    const r = openHistory(folder, NOW)
    if (!r.ok) throw new Error('should start afresh')
    expect(r.setAside).toMatch(/^history\.db\.damaged-\d{8}-\d{6}$/)
    expect(readFileSync(join(folder, r.setAside!))).toEqual(GARBAGE)
    expect(r.db.pragma('user_version', { simple: true })).toBe(HISTORY_VERSION)
    expect(freshStartOf(r.db)).toEqual({ at: new Date(NOW).toISOString(), setAside: r.setAside })
    r.db.close()
  })

  it('moves the files SQLite keeps beside a damaged one with it', () => {
    writeFileSync(historyPath(folder), GARBAGE)
    writeFileSync(`${historyPath(folder)}-wal`, 'wal')
    writeFileSync(`${historyPath(folder)}-shm`, 'shm')
    const r = openHistory(folder, NOW)
    if (!r.ok) throw new Error('should start afresh')
    expect(readFileSync(join(folder, `${r.setAside}-wal`), 'utf8')).toBe('wal')
    expect(readFileSync(join(folder, `${r.setAside}-shm`), 'utf8')).toBe('shm')
    r.db.close()
  })

  it('never overwrites a file set aside earlier', () => {
    writeFileSync(historyPath(folder), GARBAGE)
    const first = setAside(folder, NOW)
    writeFileSync(historyPath(folder), 'second')
    const second = setAside(folder, NOW)
    expect(second).toBe(`${first}-2`)
    expect(readFileSync(join(folder, first))).toEqual(GARBAGE)
    expect(readFileSync(join(folder, second), 'utf8')).toBe('second')
  })

  it('takes a database that is not AI Write history for a damaged one', () => {
    const other = new Database(historyPath(folder))
    other.exec('CREATE TABLE recipes (name TEXT)')
    other.pragma('user_version = 1')
    other.close()
    const r = openHistory(folder, NOW)
    if (!r.ok) throw new Error('should start afresh')
    expect(r.setAside).not.toBeNull()
    expect(asideFiles()).toEqual([r.setAside])
    r.db.close()
  })

  it('sets aside a journal left without its database, so a fresh one never reads it', () => {
    writeFileSync(`${historyPath(folder)}-wal`, 'stray')
    const r = openHistory(folder, NOW)
    if (!r.ok) throw new Error('should open')
    expect(asideFiles()).toHaveLength(1)
    expect(asideFiles()[0]).toMatch(/-wal$/)
    r.db.close()
  })

  it('leaves a history.db from a newer AI Write exactly as it is', () => {
    const newer = new Database(historyPath(folder))
    newer.exec('CREATE TABLE future (x)')
    newer.pragma('user_version = 9')
    newer.close()
    const before = readFileSync(historyPath(folder))
    const r = openHistory(folder, NOW)
    expect(r).toMatchObject({ ok: false, problem: 'newer' })
    expect(readFileSync(historyPath(folder))).toEqual(before)
    expect(asideFiles()).toEqual([])
  })

  it('leaves a locked history.db alone and says it is locked', () => {
    // Another program holds the file (a database kept the old way, locked for writing).
    const other = new Database(historyPath(folder))
    other.pragma('journal_mode = DELETE')
    migrateHistory(other, new Date(NOW).toISOString())
    other.exec('BEGIN EXCLUSIVE')
    other.prepare("INSERT INTO meta (key, value) VALUES ('held', 'yes')").run()
    try {
      const r = openHistory(folder, NOW)
      expect(r).toMatchObject({ ok: false, problem: 'locked' })
      expect(asideFiles()).toEqual([])
    } finally {
      other.exec('COMMIT')
      other.close()
    }
    const later = openHistory(folder, NOW)
    if (!later.ok) throw new Error('should open once the lock is gone')
    expect(later.db.prepare("SELECT value FROM meta WHERE key = 'held'").get()).toEqual({ value: 'yes' })
    later.db.close()
  })
})

describe('isDamaged', () => {
  it('knows the errors of a damaged file', () => {
    expect(isDamaged({ code: 'SQLITE_CORRUPT' })).toBe(true)
    expect(isDamaged({ code: 'SQLITE_NOTADB' })).toBe(true)
    expect(isDamaged({ code: 'SQLITE_BUSY' })).toBe(false)
    expect(isDamaged(new Error('x'))).toBe(false)
  })
})
