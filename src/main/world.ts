import Database from 'better-sqlite3'
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { ID, World, WorldSummary } from '@shared/types'
import { defaultStyleGuide } from '@shared/defaults'
import { migrate, pendingMigrations } from './db/migrations'
import * as repo from './db/repo'
import { getSettings, updateSettings } from './settings'
import { newId, now, slugify, UserError } from './util'
import { backupBeforeMigration } from './services/backups'

// The open world: one folder in the library holding world.db, images/ and backups/.

export interface OpenWorld {
  id: ID
  folder: string
  db: Database.Database
}

let current: OpenWorld | null = null
const openedListeners: ((w: OpenWorld) => void)[] = []
const closingListeners: ((w: OpenWorld) => void)[] = []

/** Runs after a world is opened (backups use this for the launch backup and timer). */
export const onWorldOpened = (fn: (w: OpenWorld) => void): void => void openedListeners.push(fn)
/** Runs just before a world is closed. */
export const onWorldClosing = (fn: (w: OpenWorld) => void): void => void closingListeners.push(fn)

export function currentWorld(): OpenWorld {
  if (!current) throw new UserError('No world is open. Pick or create a world first.')
  return current
}

export const maybeCurrentWorld = (): OpenWorld | null => current

/** The open world's database. Throws a plain-words error if none is open. */
export const db = (): Database.Database => currentWorld().db

export const worldDbPath = (folder: string): string => join(folder, 'world.db')

export function openDatabase(file: string): Database.Database {
  const d = new Database(file)
  d.pragma('journal_mode = WAL')
  d.pragma('synchronous = NORMAL')
  d.pragma('foreign_keys = ON')
  d.pragma('busy_timeout = 3000')
  return d
}

function readSummary(folder: string): WorldSummary | null {
  const file = worldDbPath(folder)
  if (!existsSync(file)) return null
  let d: Database.Database | null = null
  try {
    d = new Database(file, { readonly: true, fileMustExist: true })
    const get = (k: string): string | null => {
      const r = d!.prepare('SELECT value FROM meta WHERE key = ?').get(k) as { value: string } | undefined
      return r?.value ?? null
    }
    const id = get('id')
    if (!id) return null
    return { id, name: get('name') ?? 'Untitled world', folder, updatedAt: get('updated_at') ?? '' }
  } catch {
    return null
  } finally {
    d?.close()
  }
}

export function listWorlds(): WorldSummary[] {
  const lib = getSettings().libraryPath
  if (!existsSync(lib)) return []
  const out: WorldSummary[] = []
  for (const name of readdirSync(lib, { withFileTypes: true })) {
    if (!name.isDirectory()) continue
    // A world file being imported or copied is unpacked into a hidden folder first (src/main/transfer/).
    if (name.name.startsWith('.aiwrite-')) continue
    if (current && join(lib, name.name) === current.folder) {
      out.push(toSummary(getWorld()!))
      continue
    }
    const s = readSummary(join(lib, name.name))
    if (s) out.push(s)
  }
  return separateCopies(out).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

/**
 * A world folder copied by hand (Explorer's "My world - Copy") carries the same
 * world id as the original, so opening by id could open either. The copy is a
 * separate world from then on: it gets its own id and "(copy)" on its name.
 * The open world, or else the oldest folder, keeps the original id.
 */
function separateCopies(worlds: WorldSummary[]): WorldSummary[] {
  const byId = new Map<ID, WorldSummary[]>()
  for (const w of worlds) byId.set(w.id, [...(byId.get(w.id) ?? []), w])
  for (const group of byId.values()) {
    if (group.length < 2) continue
    const age = (w: WorldSummary): number => {
      try {
        const st = statSync(w.folder)
        return st.birthtimeMs || st.ctimeMs
      } catch {
        return Number.MAX_SAFE_INTEGER
      }
    }
    const keeper =
      group.find((w) => current && w.folder === current.folder) ??
      [...group].sort((a, b) => age(a) - age(b) || a.folder.length - b.folder.length)[0]
    for (const w of group) {
      if (w === keeper) continue
      let d: Database.Database | null = null
      try {
        d = openDatabase(worldDbPath(w.folder))
        const id = newId()
        const name = `${w.name} (copy)`
        d.transaction(() => {
          repo.setMeta(d!, 'id', id)
          repo.setMeta(d!, 'name', name)
        })()
        w.id = id
        w.name = name
      } catch (e) {
        console.warn('Could not separate a copied world', w.folder, e)
      } finally {
        d?.close()
      }
    }
  }
  return worlds
}

const toSummary = (w: World): WorldSummary => ({ id: w.id, name: w.name, folder: w.folder, updatedAt: w.updatedAt })

function uniqueFolder(name: string): string {
  const lib = getSettings().libraryPath
  const base = slugify(name)
  let folder = join(lib, base)
  for (let i = 2; existsSync(folder); i++) folder = join(lib, `${base} ${i}`)
  return folder
}

export function closeWorld(): void {
  if (!current) return
  for (const fn of closingListeners) {
    try {
      fn(current)
    } catch (e) {
      console.error('world closing listener failed', e)
    }
  }
  try {
    current.db.pragma('wal_checkpoint(TRUNCATE)')
  } catch {
    /* ignore */
  }
  current.db.close()
  current = null
}

/**
 * Opens the world in `folder` and makes it the open world. The new database is opened and
 * brought up to date before the current world is let go, so if anything fails (a damaged
 * world, a full disk, a folder in use) the current world stays open and keeps saving.
 */
function activate(folder: string): World {
  const d = openDatabase(worldDbPath(folder))
  let id: ID | null
  try {
    if (pendingMigrations(d) > 0 && (d.pragma('user_version', { simple: true }) as number) > 0) {
      backupBeforeMigration(folder, d)
    }
    migrate(d)
    id = repo.getMeta(d, 'id')
    if (!id) throw new UserError('This folder does not hold an AI Write world.')
    mkdirSync(join(folder, 'images'), { recursive: true })
    mkdirSync(join(folder, 'backups'), { recursive: true })
  } catch (e) {
    if (d.open) d.close()
    // A restore closes the open world's database itself before reopening it: if that reopen
    // fails, nothing usable is left open, so say so rather than keep a closed database.
    if (current && !current.db.open) closeWorld()
    throw e
  }
  closeWorld()
  current = { id, folder, db: d }
  updateSettings({ lastWorldId: id })
  for (const fn of openedListeners) {
    try {
      fn(current)
    } catch (e) {
      console.error('world opened listener failed', e)
    }
  }
  return getWorld()!
}

export function createWorld(name: string): World {
  const clean = name.trim() || 'My world'
  const folder = uniqueFolder(clean)
  try {
    mkdirSync(folder, { recursive: true })
  } catch (e) {
    console.warn('Could not make a world folder', folder, e instanceof Error ? e.message : e)
    throw new UserError(
      `AI Write can't make a world in your library folder (${getSettings().libraryPath}). Check the drive is connected, or choose another library folder.`
    )
  }
  const d = openDatabase(worldDbPath(folder))
  try {
    migrate(d)
    repo.initWorld(d, newId(), clean)
  } finally {
    d.close()
  }
  return activate(folder)
}

export function openWorld(id: ID): World {
  if (current?.id === id) return getWorld()!
  const found = listWorlds().find((w) => w.id === id)
  if (!found) throw new UserError('That world could not be found in your library folder.')
  return activate(found.folder)
}

export function reopenCurrent(): World {
  const folder = currentWorld().folder
  return activate(folder)
}

export function getWorld(): World | null {
  if (!current) return null
  const d = current.db
  return {
    id: current.id,
    name: repo.getMeta(d, 'name') ?? 'Untitled world',
    folder: current.folder,
    themes: repo.getMeta(d, 'themes') ?? '',
    tone: repo.getMeta(d, 'tone') ?? '',
    style: repo.getWorldStyle(d),
    createdAt: repo.getMeta(d, 'created_at') ?? '',
    updatedAt: repo.getMeta(d, 'updated_at') ?? ''
  }
}

export function updateWorld(patch: Partial<Pick<World, 'name' | 'themes' | 'tone' | 'style'>>): World {
  const d = db()
  d.transaction(() => {
    if (patch.name !== undefined) repo.setMeta(d, 'name', patch.name.trim() || 'Untitled world')
    if (patch.themes !== undefined) repo.setMeta(d, 'themes', patch.themes)
    if (patch.tone !== undefined) repo.setMeta(d, 'tone', patch.tone)
    if (patch.style !== undefined) repo.setMeta(d, 'style', JSON.stringify({ ...defaultStyleGuide(), ...patch.style }))
    repo.setMeta(d, 'updated_at', now())
  })()
  return getWorld()!
}
