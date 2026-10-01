import Database from 'better-sqlite3'
import { migrate } from '../../src/main/db/migrations'
import { initWorld } from '../../src/main/db/repo'

/** A fresh in-memory world database with the current schema. */
export function memoryDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}

/** A fresh in-memory world with its first series, story, chapter and scene. */
export function memoryWorld(name = 'Test world'): Database.Database {
  const db = memoryDb()
  initWorld(db, 'world-1', name)
  return db
}
