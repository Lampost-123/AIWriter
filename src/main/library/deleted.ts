// The library's Recently deleted folder (the start screen): a deleted world's whole folder (world.db,
// history.db, images/, backups/) is moved into `<library>/Recently deleted/`, with a small deleted.json inside
// saying what it was, kept for 30 days and then removed for good. Only ever touches folders inside Recently
// deleted, and only those that hold a world. No Electron imports: every function takes the library folder.
//
// A live world can sit in a folder called Recently deleted (made by hand, or by an AI Write before the name was
// kept back): while it does, nothing here lists, restores or removes anything in it, and a delete first moves
// that world aside to a folder of its own (moveLiveWorldAside), so it stays a normal world.
import { existsSync, mkdirSync, readdirSync, rmdirSync, rmSync, statSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { DELETED_WORLDS_FOLDER, DELETED_WORLD_DAYS, type DeletedWorld } from '@shared/contracts/library'
import type { ID } from '@shared/types'
import { readJson, renameRetry, slugify, UserError, writeFileAtomic } from '../util'
import { factsOf, readWorldDb } from './read'
import { isReservedName } from './names'

export { isReservedName }

/** What deleted.json holds. */
export interface DeletedNote {
  worldId: ID
  name: string
  stories: number
  words: number
  /** When it was deleted (ISO). */
  deletedAt: string
  /** Its folder's name in the library before it was deleted. */
  originalFolder: string
}

export const NOTE_FILE = 'deleted.json'
const DAY_MS = 24 * 60 * 60 * 1000
/** A folder move is tried for about two seconds while another program holds a file in it. */
const MOVE_TRIES = 16
const MOVE_WAIT_MS = 125

export const deletedFolder = (library: string): string => join(library, DELETED_WORLDS_FOLDER)

const IN_USE = 'Another program may be using its folder (often a cloud sync app or antivirus). Wait a moment, then try again.'

/** The interface hands back a trashId: it must name a folder directly inside Recently deleted, nothing else. */
export function safeTrashId(trashId: unknown): string {
  const id = typeof trashId === 'string' ? trashId : ''
  if (!id || id !== id.trim() || id === '.' || id === '..' || /[\\/:\0]/.test(id) || basename(id) !== id) {
    throw new UserError('That world is no longer in Recently deleted.', 'not-in-deleted')
  }
  return id
}

/** True while Recently deleted is itself a live world's folder (it has a world.db of its own). */
export const trashIsLiveWorld = (library: string): boolean => existsSync(join(deletedFolder(library), 'world.db'))

/** Folder moves under way: Recently deleted is never tidied away meanwhile, and their new names are kept for them. */
let movesInFlight = 0
const claimed = new Set<string>()

async function moving<T>(to: string, fn: () => Promise<T>): Promise<T> {
  movesInFlight++
  claimed.add(to.toLowerCase())
  try {
    return await fn()
  } finally {
    claimed.delete(to.toLowerCase())
    movesInFlight--
  }
}

const isClaimed = (dir: string, name: string): boolean => claimed.has(join(dir, name).toLowerCase())

/** `base`, else `base 2`, `base 3`... whichever isn't taken in `dir`. */
export function freeName(dir: string, base: string, reserved: (name: string) => boolean = () => false): string {
  let name = base
  for (let i = 2; existsSync(join(dir, name)) || reserved(name) || isClaimed(dir, name); i++) name = `${base} ${i}`
  return name
}

const isDir = (path: string): boolean => {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/** A folder in Recently deleted that holds a deleted world (anything else there is never touched). */
const holdsWorld = (folder: string): boolean => isDir(folder) && (existsSync(join(folder, NOTE_FILE)) || existsSync(join(folder, 'world.db')))

function readNote(folder: string): DeletedNote | null {
  const n = readJson<Partial<DeletedNote> | null>(join(folder, NOTE_FILE), null)
  if (!n || typeof n !== 'object' || typeof n.deletedAt !== 'string' || Number.isNaN(Date.parse(n.deletedAt))) return null
  return {
    worldId: typeof n.worldId === 'string' ? n.worldId : '',
    name: typeof n.name === 'string' && n.name ? n.name : 'Untitled world',
    stories: Number(n.stories) || 0,
    words: Number(n.words) || 0,
    deletedAt: n.deletedAt,
    originalFolder: typeof n.originalFolder === 'string' ? n.originalFolder : ''
  }
}

const toDeleted = (trashId: string, n: DeletedNote): DeletedWorld => ({
  trashId,
  worldId: n.worldId,
  name: n.name,
  stories: n.stories,
  words: n.words,
  deletedAt: n.deletedAt,
  purgeAt: new Date(Date.parse(n.deletedAt) + DELETED_WORLD_DAYS * DAY_MS).toISOString()
})

/**
 * Every world in Recently deleted, newest deleted first. A world folder put there by hand (or whose
 * deleted.json was lost) is taken in as deleted now, so it gets its full 30 days; anything else there (a
 * stray file, a folder with no world in it) is left alone and never listed.
 */
export function listDeleted(library: string, nowMs = Date.now()): DeletedWorld[] {
  const trash = deletedFolder(library)
  if (trashIsLiveWorld(library)) return []
  let names: string[]
  try {
    names = readdirSync(trash)
  } catch {
    return []
  }
  const out: DeletedWorld[] = []
  for (const name of names) {
    const folder = join(trash, name)
    if (!isDir(folder)) continue
    let note = readNote(folder)
    if (!note) {
      if (!existsSync(join(folder, 'world.db'))) continue
      const facts = readWorldDb(folder, factsOf)
      note = {
        worldId: facts?.worldId ?? '',
        name: facts?.name ?? name,
        stories: facts?.stories ?? 0,
        words: facts?.words ?? 0,
        deletedAt: new Date(nowMs).toISOString(),
        originalFolder: name
      }
      try {
        writeFileAtomic(join(folder, NOTE_FILE), JSON.stringify(note, null, 2))
      } catch (e) {
        console.warn('Could not note a deleted world', folder, e instanceof Error ? e.message : e)
      }
    }
    out.push(toDeleted(name, note))
  }
  return out.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt) || a.name.localeCompare(b.name))
}

/** Removes Recently deleted itself once nothing is left in it, so the library looks as it did. */
function tidyEmpty(library: string): void {
  if (movesInFlight > 0) return
  try {
    const trash = deletedFolder(library)
    if (existsSync(trash) && readdirSync(trash).length === 0) rmdirSync(trash)
  } catch {
    /* tidy-up only */
  }
}

const removeFolder = (folder: string): Promise<void> => rm(folder, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 })

/** Removes for good every deleted world past 30 days, then lists the rest. One that can't be removed yet waits for next time. */
export async function purgeDeleted(library: string, nowMs = Date.now()): Promise<DeletedWorld[]> {
  const kept: DeletedWorld[] = []
  let removed = false
  for (const d of listDeleted(library, nowMs)) {
    if (Date.parse(d.purgeAt) > nowMs) {
      kept.push(d)
      continue
    }
    try {
      await removeFolder(join(deletedFolder(library), d.trashId))
      removed = true
    } catch (e) {
      console.warn('Could not remove an old deleted world', d.trashId, e instanceof Error ? e.message : e)
      kept.push(d)
    }
  }
  if (removed) tidyEmpty(library)
  return kept
}

/**
 * Moves a world's folder into Recently deleted, with deleted.json inside (written first, so a moved world is
 * never without it). Returns its trashId. Throws a plain-words error, with the folder left where it was, when
 * the folder can't be moved.
 */
export async function moveToDeleted(library: string, folder: string, facts: Omit<DeletedNote, 'deletedAt' | 'originalFolder'>, nowMs = Date.now()): Promise<DeletedWorld> {
  const trash = deletedFolder(library)
  // The caller moves a live world out of Recently deleted first (moveLiveWorldAside): never put a world inside one.
  if (trashIsLiveWorld(library)) throw new Error('Recently deleted holds a live world')
  const note: DeletedNote = { ...facts, deletedAt: new Date(nowMs).toISOString(), originalFolder: basename(folder) }
  const noteFile = join(folder, NOTE_FILE)
  let trashId = ''
  try {
    mkdirSync(trash, { recursive: true })
    trashId = freeName(trash, basename(folder))
    const to = join(trash, trashId)
    writeFileAtomic(noteFile, JSON.stringify(note, null, 2))
    await moving(to, async () => {
      try {
        await renameRetry(folder, to, MOVE_TRIES, MOVE_WAIT_MS)
      } catch (e) {
        // Recently deleted went away meanwhile (emptied in another window, or by hand): made again, tried once more.
        if ((e as { code?: string })?.code !== 'ENOENT' || !existsSync(folder)) throw e
        mkdirSync(trash, { recursive: true })
        await renameRetry(folder, to, MOVE_TRIES, MOVE_WAIT_MS)
      }
    })
  } catch (e) {
    console.warn('Could not move a world to Recently deleted', folder, e instanceof Error ? e.message : e)
    try {
      rmSync(noteFile, { force: true })
    } catch {
      /* it says nothing to a world still in the library */
    }
    tidyEmpty(library)
    throw new UserError(`AI Write couldn't move that world to Recently deleted. ${IN_USE}`, 'world-in-use')
  }
  return toDeleted(trashId, note)
}

/**
 * Recently deleted is a live world's own folder: that world moves to a free folder of its own ("Recently
 * deleted 2"), so deleted worlds can go in a Recently deleted of their own. Returns where it went. The world
 * must not be open (its database would keep the folder from moving).
 */
export async function moveLiveWorldAside(library: string): Promise<string> {
  const from = deletedFolder(library)
  const to = join(library, freeName(library, DELETED_WORLDS_FOLDER, isReservedName))
  try {
    await moving(to, () => renameRetry(from, to, MOVE_TRIES, MOVE_WAIT_MS))
  } catch (e) {
    console.warn('Could not move a world out of the Recently deleted folder', e instanceof Error ? e.message : e)
    throw new UserError(
      `AI Write couldn't delete that world: one of your worlds is in the folder called "${DELETED_WORLDS_FOLDER}", and it couldn't be moved to a folder of its own. ${IN_USE.replace('its folder', 'that folder')}`,
      'world-in-use'
    )
  }
  return to
}

/** A folder name for a world coming back: the one it had, made safe, else one from its name. */
function homeName(note: DeletedNote | null, trashId: string): string {
  const original = (note?.originalFolder ?? '').trim()
  if (original && original === basename(original) && !/[\\/:\0]/.test(original) && original !== '.' && original !== '..' && !isReservedName(original)) {
    return original
  }
  return slugify(note?.name || trashId)
}

/** Moves a deleted world back into the library under its old folder name (or a free one like it). Returns its folder. */
export async function moveBack(library: string, trashId: unknown): Promise<string> {
  const id = safeTrashId(trashId)
  const from = join(deletedFolder(library), id)
  if (trashIsLiveWorld(library) || !holdsWorld(from)) {
    throw new UserError('That world is no longer in Recently deleted.', 'not-in-deleted')
  }
  const note = readNote(from)
  const to = join(library, freeName(library, homeName(note, id), isReservedName))
  try {
    await moving(to, () => renameRetry(from, to, MOVE_TRIES, MOVE_WAIT_MS))
  } catch (e) {
    console.warn('Could not move a world back from Recently deleted', from, e instanceof Error ? e.message : e)
    throw new UserError(`AI Write couldn't move that world back into your library. ${IN_USE}`, 'world-in-use')
  }
  try {
    rmSync(join(to, NOTE_FILE), { force: true })
  } catch {
    /* harmless: nothing reads it outside Recently deleted */
  }
  tidyEmpty(library)
  return to
}

/** Removes deleted worlds for good: one, or every one in Recently deleted. */
export async function removeDeleted(library: string, trashId?: unknown): Promise<void> {
  if (trashId !== undefined && trashId !== null) safeTrashId(trashId)
  if (trashIsLiveWorld(library)) return
  const ids = trashId === undefined || trashId === null ? listDeleted(library).map((d) => d.trashId) : [safeTrashId(trashId)]
  let failed = 0
  for (const id of ids) {
    const folder = join(deletedFolder(library), id)
    if (!holdsWorld(folder)) continue
    try {
      await removeFolder(folder)
    } catch (e) {
      console.warn('Could not remove a deleted world', folder, e instanceof Error ? e.message : e)
      failed++
    }
  }
  tidyEmpty(library)
  if (failed) {
    const what = ids.length > 1 ? (failed === ids.length ? 'those worlds' : 'some of those worlds') : 'that world'
    throw new UserError(`AI Write couldn't remove ${what} for good. ${IN_USE.replace('its folder', 'a folder')}`, 'world-in-use')
  }
}
