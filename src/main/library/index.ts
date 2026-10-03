// The start screen (src/shared/contracts/library.ts): every world in the library with its stories, where Adam
// left off, renaming a world or a story whether it is open or not, and deleting a whole world into the
// library's Recently deleted folder (deleted.ts) for 30 days.
//
// Called each time the start screen shows, so it stays light: each world that isn't open is opened read-only
// once for a couple of queries and closed at once (the open world is read through its own connection), and a
// scene's text is never read (words come from scenes.word_count).
import Database from 'better-sqlite3'
import type { DeletedWorld, LastPlace, LibraryOverview, LibraryWorld } from '@shared/contracts/library'
import type { ID, Settings, WorldSummary } from '@shared/types'
import * as repo from '../db/repo'
import { checkWritable, libraryStories, placeIn, renameStoryRow, renameWorldMeta, worldCounts, worldMeta } from '../db/library'
import * as world from '../world'
import { ensureLibraryFolder, getSettings, updateSettings } from '../settings'
import { UserError } from '../util'
import { readWorldDb } from './read'
import { listDeleted, moveBack, moveToDeleted, purgeDeleted, removeDeleted } from './deleted'

type DB = Database.Database

// ---------- At launch ----------

/** Whether the start screen shows when AI Write opens: the setting, unless the app tests turn it off. */
export const startsAtStartScreen = (startWith: Settings['startWith'] | undefined, env: string | undefined): boolean =>
  startWith !== 'last' && env !== 'off'

let launchAnswered = false

/** True once per run of the app, on the first call, when the start screen should show at launch. A reload of the window answers false. */
export function startScreenAtLaunch(): boolean {
  if (launchAnswered) return false
  launchAnswered = true
  return startsAtStartScreen(getSettings().startWith, process.env.AIWRITE_START)
}

// ---------- The library ----------

/** The open world's connection when `w` is the open world, else null. */
function openDbOf(w: WorldSummary): DB | null {
  const open = world.maybeCurrentWorld()
  return open && open.id === w.id && open.folder === w.folder && open.db.open ? open.db : null
}

/** Runs `fn` on a world's database: the open world's own connection, another world's read-only. Null when it can't be read. */
function readWorld<T>(w: WorldSummary, fn: (db: DB) => T): T | null {
  const own = openDbOf(w)
  if (!own) return readWorldDb(w.folder, fn)
  try {
    return fn(own)
  } catch (e) {
    console.warn('Could not read the open world', e instanceof Error ? e.message : e)
    return null
  }
}

/** Where Adam left off in a world, by the same rules as reopening it (store.ts loadWorldState). */
function lastPlaceIn(db: DB, worldId: ID, s: Settings): Omit<LastPlace, 'worldId' | 'worldName' | 'at'> {
  const place = s.lastPlaces?.[worldId]
  return placeIn(db, { storyIds: [s.lastStoryId, place?.storyId], sceneIds: [s.lastSceneId, place?.sceneId] })
}

/** Removes deleted worlds past 30 days, then lists what is left. Never stops the start screen showing. */
async function deletedIn(library: string): Promise<DeletedWorld[]> {
  try {
    return await purgeDeleted(library)
  } catch (e) {
    console.warn('Could not read Recently deleted', e instanceof Error ? e.message : e)
    return []
  }
}

export async function getLibrary(): Promise<LibraryOverview> {
  const libraryPath = getSettings().libraryPath
  const unreachable: LibraryOverview = { reachable: false, libraryPath, worlds: [], deleted: [], last: null }
  if (!ensureLibraryFolder(libraryPath)) return unreachable
  const deleted = await deletedIn(libraryPath)
  let summaries: WorldSummary[]
  try {
    summaries = world.listWorlds()
  } catch (e) {
    console.warn('Could not list the library', e instanceof Error ? e.message : e)
    return unreachable
  }

  const s = getSettings()
  let last: LastPlace | null = null
  const worlds: LibraryWorld[] = summaries.map((w) => {
    const read = readWorld(w, (db) => ({
      meta: worldMeta(db),
      stories: libraryStories(db),
      place: w.id === s.lastWorldId ? lastPlaceIn(db, w.id, s) : null
    }))
    const stories = read?.stories ?? []
    if (w.id === s.lastWorldId && !last) {
      last = {
        worldId: w.id,
        worldName: w.name,
        ...(read?.place ?? { storyId: null, storyTitle: '', sceneId: null, sceneTitle: '' }),
        at: s.worldsSeenAt?.[w.id] ?? ''
      }
    }
    return {
      id: w.id,
      name: w.name,
      folder: w.folder,
      stories,
      words: stories.reduce((n, x) => n + x.words, 0),
      openedAt: s.worldsSeenAt?.[w.id] || w.updatedAt || '',
      updatedAt: w.updatedAt,
      sample: read?.meta.sample ?? false
    }
  })
  worlds.sort((a, b) => b.openedAt.localeCompare(a.openedAt) || a.name.localeCompare(b.name))
  return { reachable: true, libraryPath, worlds, deleted, last }
}

/** Removes deleted worlds past 30 days (at launch). Never throws. */
export async function purgeOldDeletedWorlds(): Promise<void> {
  try {
    const lib = getSettings().libraryPath
    if (ensureLibraryFolder(lib)) await purgeDeleted(lib)
  } catch (e) {
    console.warn('Could not tidy Recently deleted', e instanceof Error ? e.message : e)
  }
}

// ---------- Renaming ----------

function libraryOrSay(): string {
  const lib = getSettings().libraryPath
  if (!ensureLibraryFolder(lib)) {
    throw new UserError(`AI Write can't reach your library folder (${lib}). Check the drive is connected, then try again.`, 'library-unreachable')
  }
  return lib
}

function findWorld(worldId: ID): WorldSummary {
  libraryOrSay()
  const found = world.listWorlds().find((w) => w.id === worldId)
  if (!found) throw new UserError('That world could not be found in your library folder. It may have been moved or deleted.', 'world-missing')
  return found
}

/**
 * Changes a world that isn't open: its database opened for writing just long enough, only when it is exactly
 * this AI Write's layout (one from an older AI Write is brought up to date when it opens, never here).
 */
function writeClosedWorld(folder: string, what: string, fn: (db: DB) => void): void {
  let d: DB | null = null
  try {
    d = new Database(world.worldDbPath(folder), { fileMustExist: true })
    d.pragma('busy_timeout = 3000')
    d.pragma('foreign_keys = ON')
    checkWritable(d)
    fn(d)
  } catch (e) {
    if (e instanceof UserError) throw e
    console.warn(`Could not rename ${what} in a closed world`, folder, e instanceof Error ? e.message : e)
    throw new UserError(
      `AI Write couldn't rename that ${what}. Another program may be using the world's folder (often a cloud sync app or antivirus). Wait a moment, then try again.`,
      'world-in-use'
    )
  } finally {
    d?.close()
  }
}

/** Renames a world (its name inside the world, never its folder). A blank name keeps the old one. */
export function renameWorldIn(worldId: ID, name: string): void {
  const clean = typeof name === 'string' ? name.trim() : ''
  if (!clean) return
  const open = world.maybeCurrentWorld()
  if (open?.id === worldId) {
    world.updateWorld({ name: clean })
    return
  }
  writeClosedWorld(findWorld(worldId).folder, 'world', (db) => renameWorldMeta(db, clean))
}

/** Renames a story in any world. A blank title keeps the old one. */
export function renameStoryIn(worldId: ID, storyId: ID, title: string): void {
  const clean = typeof title === 'string' ? title.trim() : ''
  if (!clean) return
  const open = world.maybeCurrentWorld()
  if (open?.id === worldId) {
    const db = open.db
    db.transaction(() => {
      repo.updateStory(db, storyId, { title: clean })
      repo.touchWorld(db)
    })()
    return
  }
  writeClosedWorld(findWorld(worldId).folder, 'story', (db) => renameStoryRow(db, storyId, clean))
}

// ---------- Deleting and restoring ----------

/**
 * Moves a world's whole folder into Recently deleted. The open world is closed first (its history.db and
 * every job on it close with it); if the folder can't be moved, it is opened again so nothing is lost.
 */
export async function deleteWorld(worldId: ID): Promise<DeletedWorld> {
  const library = libraryOrSay()
  const found = findWorld(worldId)
  const own = openDbOf(found)
  const facts = readWorld(found, (db) => ({ name: worldMeta(db).name, ...worldCounts(db) })) ?? { name: found.name, stories: 0, words: 0 }
  if (own) world.closeWorld()
  let gone: DeletedWorld
  try {
    gone = await moveToDeleted(library, found.folder, { worldId, ...facts })
  } catch (e) {
    if (own) {
      try {
        world.openWorld(worldId)
      } catch (e2) {
        console.warn('Could not reopen the world after it could not be deleted', e2 instanceof Error ? e2.message : e2)
      }
    }
    throw e
  }
  const s = getSettings()
  const patch: Parameters<typeof updateSettings>[0] = {}
  if (s.lastWorldId === worldId) Object.assign(patch, { lastWorldId: null, lastStoryId: null, lastSceneId: null })
  if (s.firstRun?.worldId === worldId) patch.firstRun = null
  try {
    if (Object.keys(patch).length) updateSettings(patch)
  } catch (e) {
    console.warn('Could not forget the deleted world in the settings', e instanceof Error ? e.message : e)
  }
  return gone
}

/** Moves a deleted world back into the library and returns it. */
export async function restoreWorld(trashId: string): Promise<WorldSummary> {
  const library = libraryOrSay()
  const before = listDeleted(library).find((d) => d.trashId === trashId)
  const folder = await moveBack(library, trashId)
  const back = world.listWorlds().find((w) => w.folder === folder)
  return back ?? { id: before?.worldId ?? '', name: before?.name ?? 'Untitled world', folder, updatedAt: '' }
}

/** Removes deleted worlds for good: one, or all of them. */
export async function emptyDeletedWorlds(trashId?: string): Promise<void> {
  await removeDeleted(libraryOrSay(), trashId)
}
