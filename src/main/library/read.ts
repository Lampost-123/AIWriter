// Reading a world that isn't open, for the start screen: its world.db opened read-only, used for a couple of
// queries and closed at once. No Electron imports.
import Database from 'better-sqlite3'
import { join } from 'node:path'
import type { ID } from '@shared/types'
import { worldCounts, worldMeta } from '../db/library'

type DB = Database.Database

/** Runs `fn` on a world folder's database opened read-only; null when it can't be read. */
export function readWorldDb<T>(folder: string, fn: (db: DB) => T): T | null {
  let d: DB | null = null
  try {
    d = new Database(join(folder, 'world.db'), { readonly: true, fileMustExist: true })
    d.pragma('busy_timeout = 1000')
    return fn(d)
  } catch (e) {
    console.warn('Could not read a world', folder, e instanceof Error ? e.message : e)
    return null
  } finally {
    d?.close()
  }
}

export interface WorldFacts {
  worldId: ID
  name: string
  stories: number
  words: number
}

/** What Recently deleted says about a world: its id, name, stories and words. */
export function factsOf(db: DB): WorldFacts {
  const meta = worldMeta(db)
  return { worldId: meta.id ?? '', name: meta.name, ...worldCounts(db) }
}
