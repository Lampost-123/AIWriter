import Database from 'better-sqlite3'
import { CHAT_SWITCHES, chatSwitchVar, type ChatSwitch } from '../../src/shared/askIntent'
import { migrate } from '../../src/main/db/migrations'
import { initWorld } from '../../src/main/db/repo'

/**
 * Sets the chat overhaul's lab switches for a test: the ones named on, every other one off. `null` clears them all,
 * back to the defaults (all on).
 */
export function chatSwitches(on: readonly ChatSwitch[] | null): void {
  for (const n of CHAT_SWITCHES) {
    if (on === null) delete process.env[chatSwitchVar(n)]
    else process.env[chatSwitchVar(n)] = on.includes(n) ? 'on' : 'off'
  }
}

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
