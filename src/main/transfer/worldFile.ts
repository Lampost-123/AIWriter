// A whole world as one file, and copies of worlds. No Electron imports, so it is unit-tested.
//
// A .aiwrite file is a zip (fflate) holding, in this order:
//   manifest.json   what it is: the format and its version, the AI Write that made it, the world's name, when
//   world.db        a consistent copy of the world (SQLite's online backup, never a raw copy of a live file),
//                   made a single self-contained file
//   history.db      the same for the world's history, when it has one that can be read (left out otherwise)
//   images/...      the world folder's images
// Never backups/, never a key (keys are never in a world), never the speech server's files or audio.
//
// Importing unpacks into a hidden folder in the library first (".aiwrite-import-<id>"); world.db goes in
// under another name until it has its new id, so the library never lists a half-made world, or two worlds
// with one id (world.ts would then "separate" them). Only then does the folder take its own name. Making a
// copy works the same way. An older world is brought up to date by the normal open path (world.ts).

import Database from 'better-sqlite3'
import { closeSync, createReadStream, existsSync, mkdirSync, openSync, readdirSync, readSync, rmSync, statSync, writeSync } from 'node:fs'
import { cp, mkdir, open, readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { strToU8, strFromU8, Unzip, UnzipInflate, Zip, ZipDeflate } from 'fflate'
import type { ID } from '@shared/types'
import { MIGRATIONS } from '../db/migrations'
import * as repo from '../db/repo'
import { newId, renameRetry, slugify, UserError } from '../util'

type DB = Database.Database

export const WORLD_FILE_FORMAT = 'aiwrite-world'
/** The layout of the .aiwrite file this version writes. A file with a higher number is refused. */
export const WORLD_FILE_VERSION = 1
export const WORLD_FILE_EXT = 'aiwrite'

export interface WorldManifest {
  format: typeof WORLD_FILE_FORMAT
  formatVersion: number
  /** The AI Write that made it ("0.6.0"). */
  appVersion: string
  worldName: string
  exportedAt: string
  /** world.db's layout version (PRAGMA user_version). */
  schemaVersion: number
  /** Whether history.db is in the file. */
  history: boolean
}

/** How a long job is getting on: plain words, and 0 to 1 when that is known. */
export type Progress = (step: string, fraction: number | null) => void

/** Where a world's files are, and its open connection when it is the open world. */
export interface WorldSource {
  folder: string
  /** The open world's connection (so the copy is consistent with what is being written); null to read the folder. */
  db: DB | null
}

/** What became of a world's history.db: carried, there was none, or it couldn't be read and was left out. */
export type HistoryCarried = 'carried' | 'none' | 'left-out'

const CHUNK = 1 << 20
const STALE_MS = 60 * 60 * 1000
const STAGING = /^\.aiwrite-(import|copy)-/

// ---------- Small helpers ----------

/** "0.10.2" is newer than "0.9.9". Parts that aren't numbers count as 0. */
export function isNewerVersion(a: string, b: string): boolean {
  const pa = a.split(/[.+-]/).map((x) => Number.parseInt(x, 10) || 0)
  const pb = b.split(/[.+-]/).map((x) => Number.parseInt(x, 10) || 0)
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0)
  return false
}

const codeOf = (e: unknown): string => String((e as { code?: unknown })?.code ?? '')

/** A file system problem in plain words (a full disk, a file held by another program), else the error as it is. */
export function plainFileError(e: unknown, doing: string): unknown {
  if (e instanceof UserError) return e
  const code = codeOf(e)
  if (code === 'ENOSPC' || code === 'SQLITE_FULL') return new UserError(`Couldn't ${doing} because the disk is full. Free up some space, then try again.`)
  if (['EPERM', 'EBUSY', 'EACCES'].includes(code)) {
    return new UserError(`Couldn't ${doing} because another program (often OneDrive or antivirus) is using the file. Try again in a moment.`)
  }
  return e
}

/** Makes a copied database a plain single file (no -wal or -shm beside it), so it can travel. */
function selfContained(file: string): void {
  const d = new Database(file)
  try {
    d.pragma('journal_mode = DELETE')
  } finally {
    d.close()
  }
}

/** Every SQLite database starts with these 16 bytes. */
const SQLITE_HEADER = 'SQLite format 3\u0000'

function looksLikeSqlite(file: string): boolean {
  try {
    const fd = openSync(file, 'r')
    try {
      const head = Buffer.alloc(16)
      return readSync(fd, head, 0, 16, 0) === 16 && head.toString('latin1') === SQLITE_HEADER
    } finally {
      closeSync(fd)
    }
  } catch {
    return false
  }
}

/**
 * Copies a database consistently with SQLite's online backup (it copies in small steps, so the app keeps
 * running, and starts again if another connection writes meanwhile), then makes the copy self-contained.
 */
async function copyDatabase(source: DB | string, to: string, onFraction?: (f: number) => void): Promise<void> {
  rmSync(to, { force: true })
  const own = typeof source === 'string' ? new Database(source, { readonly: true, fileMustExist: true }) : null
  const db = own ?? (source as DB)
  try {
    await db.backup(to, {
      progress: ({ totalPages, remainingPages }) => {
        if (totalPages > 0) onFraction?.(1 - remainingPages / totalPages)
        return 200
      }
    })
  } catch (e) {
    rmSync(to, { force: true })
    throw e
  } finally {
    own?.close()
  }
  selfContained(to)
}

/** The world folder's images, as paths inside images/ ("portraits/mara.png"). Links and other oddities are skipped. */
async function imageFiles(folder: string): Promise<string[]> {
  const root = join(folder, 'images')
  const out: string[] = []
  const walk = async (rel: string): Promise<void> => {
    let items
    try {
      items = await readdir(join(root, rel), { withFileTypes: true })
    } catch {
      return
    }
    for (const it of items) {
      const r = rel ? `${rel}/${it.name}` : it.name
      if (it.isDirectory()) await walk(r)
      else if (it.isFile()) out.push(r)
    }
  }
  await walk('')
  return out
}

/** A world's database copied, with its history when it has one that can be read. */
async function copyWorldFiles(
  src: WorldSource,
  to: { worldDb: string; historyDb: string },
  progress: Progress
): Promise<HistoryCarried> {
  progress('Copying the world', 0)
  const closed = (): UserError => new UserError('The world was closed before it could be copied. Open it again, then try once more.')
  if (src.db && !src.db.open) throw closed()
  try {
    await copyDatabase(src.db ?? join(src.folder, 'world.db'), to.worldDb, (f) => progress('Copying the world', f))
  } catch (e) {
    // The world was closed (or another opened) part way through: the copy stops, in plain words.
    if (src.db && !src.db.open) throw closed()
    const code = codeOf(e)
    if (code.startsWith('SQLITE_CORRUPT') || code === 'SQLITE_NOTADB') {
      throw new UserError(
        "This world's file is damaged, so it couldn't be copied. If the world opens, bring back an earlier copy in Settings › Backups, then try again.",
        'damaged-world'
      )
    }
    throw e
  }
  const history = join(src.folder, 'history.db')
  if (!existsSync(history)) return 'none'
  progress('Copying its history', 0)
  try {
    if (!looksLikeSqlite(history)) throw new Error('history.db is not a database')
    await copyDatabase(history, to.historyDb, (f) => progress('Copying its history', f))
    return 'carried'
  } catch (e) {
    // A damaged or unreadable history never stops the world going: History starts afresh where it lands.
    console.warn('history.db left out:', e instanceof Error ? e.message : e)
    rmSync(to.historyDb, { force: true })
    return 'left-out'
  }
}

/** A name for a new world folder in the library that isn't taken ("My world", "My world 2"...). */
export function freeFolder(library: string, name: string): string {
  const base = slugify(name)
  let folder = join(library, base)
  for (let i = 2; existsSync(folder); i++) folder = join(library, `${base} ${i}`)
  return folder
}

/** Removes hidden folders left in the library by an import or copy the app closed in the middle of. */
export function removeStaleStaging(library: string, nowMs = Date.now()): void {
  let names: string[]
  try {
    names = readdirSync(library)
  } catch {
    return
  }
  for (const n of names) {
    if (!STAGING.test(n)) continue
    const dir = join(library, n)
    // One stopped just before it took its own name is already a whole world (the library lists it): never removed.
    if (existsSync(join(dir, 'world.db'))) continue
    try {
      if (nowMs - statSync(dir).mtimeMs > STALE_MS) rmSync(dir, { recursive: true, force: true })
    } catch {
      /* in use: next time */
    }
  }
}

/**
 * Gives a world database its own id (and a name), as a plain single file. A copy made on this computer
 * notes how far its AI records go (`usage_from_rowid`), so the usage page doesn't count the original's
 * spending twice; an imported world keeps all of its spending, as it usually comes from another computer.
 */
function makeOwnWorld(file: string, name: string, copy = false): ID {
  const d = new Database(file)
  try {
    const id = newId()
    d.transaction(() => {
      repo.setMeta(d, 'id', id)
      repo.setMeta(d, 'name', name)
      if (copy) {
        const top = (d.prepare('SELECT max(rowid) AS top FROM generations').get() as { top: number | null }).top ?? 0
        repo.setMeta(d, 'usage_from_rowid', String(top))
      }
    })()
    d.pragma('journal_mode = DELETE')
    return id
  } finally {
    d.close()
  }
}

/** The finished staging folder takes its place in the library. */
async function settle(staging: string, library: string, name: string): Promise<string> {
  mkdirSync(join(staging, 'images'), { recursive: true })
  mkdirSync(join(staging, 'backups'), { recursive: true })
  const folder = freeFolder(library, name)
  await renameRetry(staging, folder)
  return folder
}

// ---------- Export ----------

/** Writes the zip, streaming each file in from disk in small pieces so the app keeps running. */
async function writeZip(out: string, entries: { name: string; file?: string; data?: Uint8Array }[], progress: (f: number) => void): Promise<void> {
  const fh = await open(out, 'w')
  let failure: unknown = null
  const pending: Uint8Array[] = []
  const zip = new Zip((err, chunk) => {
    if (err) failure = err
    else pending.push(chunk)
  })
  const flush = async (): Promise<void> => {
    while (pending.length) await fh.write(pending.shift()!)
    if (failure) throw failure
  }
  try {
    const sizes = await Promise.all(entries.map(async (e) => (e.data ? e.data.length : (await stat(e.file!)).size)))
    const total = sizes.reduce((a, b) => a + b, 0) || 1
    let done = 0
    for (const e of entries) {
      const f = new ZipDeflate(e.name, { level: 6 })
      zip.add(f)
      if (e.data) {
        f.push(e.data, true)
        done += e.data.length
      } else {
        for await (const chunk of createReadStream(e.file!, { highWaterMark: CHUNK })) {
          f.push(chunk as Uint8Array)
          done += (chunk as Uint8Array).length
          await flush()
          progress(done / total)
        }
        f.push(new Uint8Array(0), true)
      }
      await flush()
    }
    zip.end()
    await flush()
  } finally {
    await fh.close()
  }
}

export interface ExportWorldOptions {
  source: WorldSource
  /** The .aiwrite file to write. */
  out: string
  appVersion: string
  progress?: Progress
  now?: Date
}

/** Writes a world as one .aiwrite file. Its history goes in when it can be read; the result says so. */
export async function exportWorld(opts: ExportWorldOptions): Promise<{ history: HistoryCarried; worldName: string }> {
  const progress = opts.progress ?? (() => undefined)
  const temp = join(tmpdir(), `aiwrite-export-${newId()}`)
  const partial = `${opts.out}.partial`
  try {
    await mkdir(temp, { recursive: true })
    const files = { worldDb: join(temp, 'world.db'), historyDb: join(temp, 'history.db') }
    const history = await copyWorldFiles(opts.source, files, progress)
    const copy = new Database(files.worldDb, { readonly: true })
    let worldName: string
    let schemaVersion: number
    try {
      worldName = repo.getMeta(copy, 'name') ?? 'Untitled world'
      schemaVersion = copy.pragma('user_version', { simple: true }) as number
    } finally {
      copy.close()
    }
    const manifest: WorldManifest = {
      format: WORLD_FILE_FORMAT,
      formatVersion: WORLD_FILE_VERSION,
      appVersion: opts.appVersion,
      worldName,
      exportedAt: (opts.now ?? new Date()).toISOString(),
      schemaVersion,
      history: history === 'carried'
    }
    const images = await imageFiles(opts.source.folder)
    progress('Packing the file', 0)
    await writeZip(
      partial,
      [
        { name: 'manifest.json', data: strToU8(JSON.stringify(manifest, null, 2)) },
        { name: 'world.db', file: files.worldDb },
        ...(history === 'carried' ? [{ name: 'history.db', file: files.historyDb }] : []),
        ...images.map((rel) => ({ name: `images/${rel}`, file: join(opts.source.folder, 'images', ...rel.split('/')) }))
      ],
      (f) => progress('Packing the file', f)
    )
    await renameRetry(partial, opts.out)
    return { history, worldName }
  } catch (e) {
    rmSync(partial, { force: true })
    throw plainFileError(e, 'export the world')
  } finally {
    await rm(temp, { recursive: true, force: true }).catch(() => undefined)
  }
}

// ---------- Import ----------

const NOT_OURS = "This file isn't an AI Write world file, or it is damaged. Check it's the .aiwrite file you exported, then try again."
const DAMAGED = 'This world file is damaged, so it was not imported. Export the world again from the computer it came from, then import the new file.'

const WINDOWS_DEVICE = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i

/** Where an entry of the zip goes in the staging folder, or null when it isn't one we take (or would land outside it). */
export function stagedName(name: string): string | null {
  if (name === 'manifest.json' || name === 'world.db' || name === 'history.db') return name
  if (!name.startsWith('images/') || name.endsWith('/')) return null
  const parts = name.slice('images/'.length).split('/')
  // Windows also drops a name's trailing dots and spaces, and opens a device for CON, NUL, COM1... (even "nul.png").
  const unsafe = (p: string): boolean =>
    !p || p === '.' || p === '..' || /[\\:*?"<>|\u0000-\u001f]/.test(p) || /[. ]$/.test(p) || WINDOWS_DEVICE.test(p)
  if (parts.some(unsafe)) return null
  return ['images', ...parts].join('/')
}

/** Reads and checks a manifest: refuses another kind of file and one from a newer AI Write, in plain words. */
export function checkManifest(raw: Uint8Array | null, appVersion: string): WorldManifest {
  let m: Partial<WorldManifest> | null = null
  try {
    m = raw ? (JSON.parse(strFromU8(raw)) as Partial<WorldManifest>) : null
  } catch {
    m = null
  }
  if (!m || m.format !== WORLD_FILE_FORMAT) throw new UserError(NOT_OURS, 'not-a-world-file')
  const newer =
    (typeof m.formatVersion === 'number' && m.formatVersion > WORLD_FILE_VERSION) ||
    (typeof m.schemaVersion === 'number' && m.schemaVersion > MIGRATIONS.length) ||
    (typeof m.appVersion === 'string' && isNewerVersion(m.appVersion, appVersion))
  if (newer) {
    throw new UserError(
      `This world was exported from a newer AI Write (${m.appVersion ?? 'a later version'}). Update AI Write in Settings › About and updates, then import it again.`,
      'newer-world-file'
    )
  }
  return m as WorldManifest
}

/** Unpacks the zip into the staging folder as it is read, so a large file never sits whole in memory. */
async function unpack(file: string, staging: string, appVersion: string, progress: (f: number) => void): Promise<WorldManifest> {
  const total = (await stat(file)).size || 1
  let manifest: WorldManifest | null = null
  let failure: unknown = null
  let seen = 0
  // Every file being written, so none is left open (Windows couldn't then remove the folder) if the zip stops short.
  const writing = new Set<() => void>()
  const unzip = new Unzip((f) => {
    const name = stagedName(f.name)
    if (!name || failure) return
    // world.db and history.db land under other names until they are checked.
    const target = join(staging, ...(name === 'world.db' || name === 'history.db' ? [`${name}.incoming`] : name.split('/')))
    if (name === 'manifest.json') {
      const parts: Uint8Array[] = []
      f.ondata = (err, chunk, final) => {
        if (err) return void (failure ??= err)
        parts.push(chunk)
        if (!final) return
        try {
          manifest = checkManifest(Buffer.concat(parts), appVersion)
        } catch (e) {
          failure ??= e
        }
      }
    } else {
      if (!manifest) return void (failure ??= new UserError(NOT_OURS, 'not-a-world-file'))
      mkdirSync(join(target, '..'), { recursive: true })
      const fd = openSync(target, 'w')
      let closed = false
      const close = (): void => {
        if (!closed) closeSync(fd)
        closed = true
        writing.delete(close)
      }
      writing.add(close)
      f.ondata = (err, chunk, final) => {
        if (closed) return
        if (err) {
          close()
          return void (failure ??= err)
        }
        try {
          if (chunk.length) writeSync(fd, chunk)
        } catch (e) {
          failure ??= e
          close()
          return
        }
        if (final) close()
      }
    }
    f.start()
  })
  unzip.register(UnzipInflate)
  try {
    for await (const chunk of createReadStream(file, { highWaterMark: CHUNK })) {
      unzip.push(chunk as Uint8Array)
      seen += (chunk as Uint8Array).length
      progress(seen / total)
      if (failure) break
    }
    if (!failure) unzip.push(new Uint8Array(0), true)
  } catch (e) {
    failure ??= e
  }
  for (const close of [...writing]) {
    close()
    // A file the zip never finished: the zip stopped short.
    failure ??= new UserError(DAMAGED, 'damaged-world-file')
  }
  if (failure) {
    if (failure instanceof UserError) throw failure
    const fs = plainFileError(failure, 'import the world')
    if (fs instanceof UserError) throw fs
    throw new UserError(manifest ? DAMAGED : NOT_OURS, 'damaged-world-file')
  }
  if (!manifest) throw new UserError(NOT_OURS, 'not-a-world-file')
  return manifest
}

/** Checks the unpacked world.db is a whole AI Write world this version can open. */
function checkWorldDb(file: string): void {
  if (!existsSync(file) || !looksLikeSqlite(file)) throw new UserError(DAMAGED, 'damaged-world-file')
  let d: DB | null = null
  try {
    d = new Database(file, { readonly: true, fileMustExist: true })
    if (d.pragma('quick_check', { simple: true }) !== 'ok') throw new UserError(DAMAGED, 'damaged-world-file')
    if ((d.pragma('user_version', { simple: true }) as number) > MIGRATIONS.length) {
      throw new UserError('This world was made by a newer AI Write. Update AI Write in Settings › About and updates, then import it again.', 'newer-world-file')
    }
    if (!repo.getMeta(d, 'id')) throw new UserError(DAMAGED, 'damaged-world-file')
  } catch (e) {
    if (e instanceof UserError) throw e
    throw new UserError(DAMAGED, 'damaged-world-file')
  } finally {
    d?.close()
  }
}

export interface ImportWorldOptions {
  file: string
  library: string
  appVersion: string
  /** The names of the worlds already in the library: an import with the same name is called "<name> (imported)". */
  takenNames: string[]
  progress?: Progress
}

/** Unpacks a .aiwrite file into a new world folder in the library, with a new id. Returns where, its id and its name. */
export async function importWorld(opts: ImportWorldOptions): Promise<{ folder: string; id: ID; name: string; history: boolean }> {
  const progress = opts.progress ?? (() => undefined)
  await mkdir(opts.library, { recursive: true }).catch((e) => {
    throw plainFileError(e, 'import the world')
  })
  removeStaleStaging(opts.library)
  const staging = join(opts.library, `.aiwrite-import-${newId()}`)
  try {
    await mkdir(staging, { recursive: true })
    progress('Opening the file', 0)
    const manifest = await unpack(opts.file, staging, opts.appVersion, (f) => progress('Unpacking the world', f))
    const incoming = join(staging, 'world.db.incoming')
    progress('Checking the world', null)
    checkWorldDb(incoming)
    // The history comes too when it is a database; a damaged one is left behind and History starts afresh.
    const history = join(staging, 'history.db.incoming')
    let carried = false
    if (existsSync(history)) {
      if (looksLikeSqlite(history)) {
        await renameRetry(history, join(staging, 'history.db'))
        carried = true
      } else rmSync(history, { force: true })
    }
    const base = (manifest.worldName || '').trim() || 'Imported world'
    const taken = new Set(opts.takenNames.map((n) => n.trim().toLowerCase()))
    const name = taken.has(base.toLowerCase()) ? `${base} (imported)` : base
    const id = makeOwnWorld(incoming, name)
    await renameRetry(incoming, join(staging, 'world.db'))
    const folder = await settle(staging, opts.library, name)
    return { folder, id, name, history: carried }
  } catch (e) {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined)
    throw plainFileError(e, 'import the world')
  }
}

// ---------- Make a copy ----------

export interface CopyWorldOptions {
  source: WorldSource
  library: string
  /** The copy's name ("My world (copy)"). */
  name: string
  progress?: Progress
}

/** Copies a world into a new folder in the library, with its history and images and a new id. */
export async function copyWorld(opts: CopyWorldOptions): Promise<{ folder: string; id: ID; history: HistoryCarried }> {
  const progress = opts.progress ?? (() => undefined)
  removeStaleStaging(opts.library)
  const staging = join(opts.library, `.aiwrite-copy-${newId()}`)
  try {
    await mkdir(staging, { recursive: true })
    const incoming = join(staging, 'world.db.incoming')
    const history = await copyWorldFiles(opts.source, { worldDb: incoming, historyDb: join(staging, 'history.db') }, progress)
    const images = join(opts.source.folder, 'images')
    if (existsSync(images)) {
      progress('Copying its pictures', null)
      await cp(images, join(staging, 'images'), { recursive: true, errorOnExist: false, force: true })
    }
    const id = makeOwnWorld(incoming, opts.name, true)
    await renameRetry(incoming, join(staging, 'world.db'))
    const folder = await settle(staging, opts.library, opts.name)
    return { folder, id, history }
  } catch (e) {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined)
    throw plainFileError(e, 'copy the world')
  }
}
