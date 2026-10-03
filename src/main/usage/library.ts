// Every world's spending in the library (milestone 6, Usage and cost), kept up to date cheaply:
// - The open world is read through its own connection (never a second one), only what is new each time.
// - Every other world is looked at by its files' sizes and times (world.db and its -wal file); one that changed
//   is opened read-only for a moment, read from where it was left, and closed at once. Nothing is ever written
//   to another world.
// - The tallies are kept in a small file in the app's data folder (`usage-cache.json`), so after the first
//   time even a fresh start reads only what changed. A tally made in another time zone is read afresh.
// A world that can't be read (damaged, locked) keeps the tally it had, or is counted as unreadable.
// No Electron: the caller passes the paths.

import Database from 'better-sqlite3'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { readJson, writeFileAtomic } from '../util'
import { emptyTally, localDay, monthCost, tallyWorld, type WorldTally } from './aggregate'

type DB = Database.Database

/** A closed world's files as last read: when they change, it is read again. */
type Marker = string

interface WorldEntry {
  name: string
  /** Null while it is the open world (read through its own connection). */
  marker: Marker | null
  tally: WorldTally
}

interface CacheFile {
  version: 1
  /** The time zone the days were counted in. */
  zone: string
  worlds: Record<string, WorldEntry>
}

const VERSION = 1

/** This computer's time zone (days are Adam's local days). */
export const timeZone = (): string => `${Intl.DateTimeFormat().resolvedOptions().timeZone ?? ''} ${new Date().getTimezoneOffset()}`

function markerOf(folder: string): Marker | null {
  try {
    const db = statSync(join(folder, 'world.db'))
    let wal = ''
    try {
      const w = statSync(join(folder, 'world.db-wal'))
      wal = `${w.size}:${w.mtimeMs}`
    } catch {
      /* no -wal file: the world was closed cleanly */
    }
    return `${db.size}:${db.mtimeMs}|${wal}`
  } catch {
    return null
  }
}

/** The world folders in the library (each holds world.db), as full paths. */
export function worldFolders(libraryPath: string): string[] {
  if (!libraryPath || !existsSync(libraryPath)) return []
  try {
    return readdirSync(libraryPath, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(libraryPath, d.name, 'world.db')))
      .map((d) => resolve(libraryPath, d.name))
  } catch {
    return []
  }
}

export interface OpenWorldRef {
  folder: string
  db: DB
  name: string
}

export class UsageLibrary {
  private worlds = new Map<string, WorldEntry>()
  private loaded = false
  private dirty = false
  private unreadable = new Set<string>()
  /** The folders found when the library was last looked through. */
  private folders: string[] | null = null

  constructor(
    private readonly o: {
      /** Where the tallies are kept between runs (null: not kept, for tests). */
      cacheFile: string | null
      zone?: string
      dayOf?: (iso: string) => string
    }
  ) {}

  private get zone(): string {
    return this.o.zone ?? timeZone()
  }

  private load(): void {
    if (this.loaded) return
    this.loaded = true
    if (!this.o.cacheFile) return
    const file = readJson<Partial<CacheFile>>(this.o.cacheFile, {})
    if (file.version !== VERSION || file.zone !== this.zone || !file.worlds || typeof file.worlds !== 'object') return
    for (const [folder, w] of Object.entries(file.worlds)) {
      if (w && typeof w === 'object' && w.tally?.seen && w.tally.buckets) this.worlds.set(folder, w)
    }
  }

  /** Writes the tallies to the cache file when they changed. Never throws. */
  save(): void {
    if (!this.dirty || !this.o.cacheFile) return
    try {
      const worlds: Record<string, WorldEntry> = {}
      for (const [k, v] of this.worlds) worlds[k] = v
      const file: CacheFile = { version: VERSION, zone: this.zone, worlds }
      writeFileAtomic(this.o.cacheFile, JSON.stringify(file))
      this.dirty = false
    } catch (e) {
      console.warn('Could not keep the usage figures', e)
    }
  }

  /** The open world's tally, brought up to date through its own connection. */
  refreshOpen(open: OpenWorldRef): WorldTally {
    this.load()
    const key = resolve(open.folder)
    const was = this.worlds.get(key)
    const tally = tallyWorld(open.db, was?.tally ?? null, this.o.dayOf ?? localDay)
    if (!was || was.marker !== null || was.name !== open.name || JSON.stringify(was.tally.seen) !== JSON.stringify(tally.seen) || was.tally.pending.length !== tally.pending.length) {
      this.dirty = true
    }
    this.worlds.set(key, { name: open.name, marker: null, tally })
    this.unreadable.delete(key)
    return tally
  }

  /** Every world in the library brought up to date (the open one through `open`). */
  refreshAll(libraryPath: string, open: OpenWorldRef | null): void {
    this.load()
    const folders = worldFolders(libraryPath)
    const openKey = open ? resolve(open.folder) : null
    if (open && !folders.includes(openKey!)) folders.push(openKey!)
    for (const folder of folders) {
      if (folder === openKey) {
        try {
          this.refreshOpen(open!)
        } catch (e) {
          console.warn('Could not add up the open world’s spending', e)
        }
        continue
      }
      this.refreshClosed(folder)
    }
    this.folders = folders
    // Worlds no longer in the library (moved, deleted, another library chosen) aren't kept.
    for (const k of [...this.worlds.keys()]) {
      if (!folders.includes(k)) {
        this.worlds.delete(k)
        this.dirty = true
      }
    }
    for (const k of [...this.unreadable]) if (!folders.includes(k)) this.unreadable.delete(k)
  }

  private refreshClosed(folder: string): void {
    const was = this.worlds.get(folder)
    const marker = markerOf(folder)
    if (was && marker && was.marker === marker) return
    let db: DB | null = null
    try {
      db = new Database(join(folder, 'world.db'), { readonly: true, fileMustExist: true })
      db.pragma('busy_timeout = 1000')
      const name = (db.prepare("SELECT value FROM meta WHERE key = 'name'").get() as { value: string } | undefined)?.value ?? 'Untitled world'
      const hasTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'generations'").get()
      const tally = hasTable ? tallyWorld(db, was?.tally ?? null, this.o.dayOf ?? localDay) : emptyTally()
      this.worlds.set(folder, { name, marker, tally })
      this.unreadable.delete(folder)
      this.dirty = true
    } catch (e) {
      console.warn('Could not read the spending of a world', folder, e)
      if (!was) this.unreadable.add(folder)
    } finally {
      try {
        db?.close()
      } catch {
        /* closing a read-only handle can't lose anything */
      }
    }
  }

  /** True once the library has been looked through this session. */
  get looked(): boolean {
    return this.folders !== null
  }

  /** The tallies of every world found (the open one included). */
  tallies(): { folder: string; name: string; tally: WorldTally }[] {
    this.load()
    const keys = this.folders ?? [...this.worlds.keys()]
    return keys.flatMap((k) => {
      const w = this.worlds.get(k)
      return w ? [{ folder: k, name: w.name, tally: w.tally }] : []
    })
  }

  tallyOf(folder: string): WorldTally | null {
    this.load()
    return this.worlds.get(resolve(folder))?.tally ?? null
  }

  /** Worlds that couldn't be read and have nothing kept from before. */
  get unreadableCount(): number {
    return this.unreadable.size
  }

  /** Dollars spent in a month ("2026-10") across the library. */
  monthSpend(month: string): number {
    return this.tallies().reduce((n, w) => n + monthCost(w.tally, month), 0)
  }

  /** For tests. */
  forget(): void {
    this.worlds.clear()
    this.unreadable.clear()
    this.folders = null
    this.loaded = false
  }
}
