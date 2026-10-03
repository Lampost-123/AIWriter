// The sample world in the library (milestone 6): finding it, and making it when it isn't there. A world is
// the sample when its meta table has `sample_world`, so a renamed or moved sample is still found, and there
// is never a second one: opening it again opens the one there, and a deleted one is made afresh.

import Database from 'better-sqlite3'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { ID, World, WorldSummary } from '@shared/types'
import * as world from '../world'
import * as repo from '../db/repo'
import { migrate } from '../db/migrations'
import { getSettings } from '../settings'
import { newId, slugify, UserError } from '../util'
import { fillSampleWorld, isSampleWorld, SAMPLE_META_KEY } from './sampleWorld'
import { SAMPLE_NAME } from './sampleContent'

/** Whether a world folder holds the sample world (read without opening it for writing). */
function folderIsSample(folder: string): boolean {
  let d: Database.Database | null = null
  try {
    d = new Database(world.worldDbPath(folder), { readonly: true, fileMustExist: true })
    return !!(d.prepare('SELECT 1 FROM meta WHERE key = ?').get(SAMPLE_META_KEY) as unknown)
  } catch {
    return false
  } finally {
    d?.close()
  }
}

/** The worlds in the library that are the sample world (normally one). */
export function sampleWorlds(worlds: WorldSummary[] = world.listWorlds()): WorldSummary[] {
  const open = world.maybeCurrentWorld()
  return worlds.filter((w) => (open && w.id === open.id ? isSampleWorld(open.db) : folderIsSample(w.folder)))
}

/** A new folder in the library for a world of this name ("Sample world - Gullhaven", then "... 2"). */
function newFolder(name: string): string {
  const lib = getSettings().libraryPath
  const base = slugify(name)
  let folder = join(lib, base)
  for (let i = 2; existsSync(folder); i++) folder = join(lib, `${base} ${i}`)
  return folder
}

/** Makes the sample world in the library, complete before anything opens it. Returns its id. */
export function makeSampleWorld(): ID {
  const folder = newFolder(SAMPLE_NAME)
  try {
    mkdirSync(folder, { recursive: true })
  } catch (e) {
    console.warn('Could not make the sample world folder', folder, e instanceof Error ? e.message : e)
    throw new UserError(
      `AI Write can't make the sample world in your library folder (${getSettings().libraryPath}). Check the drive is connected, or choose another library folder.`
    )
  }
  const id = newId()
  let d: Database.Database | null = null
  try {
    d = world.openDatabase(world.worldDbPath(folder))
    migrate(d)
    // One transaction: if AI Write stops halfway (a crash, the power), the folder holds no world id, so it is
    // never listed as a half-made world of Adam's own.
    const db = d
    db.transaction(() => {
      repo.initWorld(db, id, SAMPLE_NAME)
      fillSampleWorld(db)
    })()
    d.pragma('wal_checkpoint(TRUNCATE)')
  } catch (e) {
    d?.close()
    d = null
    // Never leave half a sample behind: the next try makes it whole.
    rmSync(folder, { recursive: true, force: true })
    throw e
  } finally {
    d?.close()
  }
  return id
}

/** Opens the sample world, making it first when the library has none. */
export function openSampleWorld(): World {
  const found = sampleWorlds()[0]
  return world.openWorld(found ? found.id : makeSampleWorld())
}
