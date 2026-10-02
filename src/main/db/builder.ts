// SQL for the builder (milestone 3). Everything else it saves goes through repo.ts, which writes the
// memory history. No Electron imports.

import type Database from 'better-sqlite3'
import type { Entry, ID, Origin } from '@shared/types'
import { getEntry } from './repo'

type DB = Database.Database

/**
 * Marks who some of an entry's fields come from without changing the fields: a name the AI chose for
 * a character Adam made, say. Set on the entry and on its newest history version (the one that saved
 * those values), so bringing that version back keeps who they came from. Use it straight after the
 * write that saved them, in the same transaction.
 */
export function stampOrigins(db: DB, entryId: ID, origins: Record<string, Origin>): Entry {
  const fieldOrigins = { ...getEntry(db, entryId).fieldOrigins, ...origins }
  const json = JSON.stringify(fieldOrigins)
  db.prepare('UPDATE entries SET field_origins_json = ? WHERE id = ?').run(json, entryId)
  const v = db
    .prepare("SELECT id, data_json FROM fact_versions WHERE fact_kind = 'entry' AND fact_id = ? ORDER BY version DESC LIMIT 1")
    .get(entryId) as { id: ID; data_json: string | null } | undefined
  if (v?.data_json) {
    try {
      const data = JSON.parse(v.data_json) as Entry
      db.prepare('UPDATE fact_versions SET data_json = ? WHERE id = ?').run(JSON.stringify({ ...data, fieldOrigins }), v.id)
    } catch {
      // A version that can't be read is left as it is.
    }
  }
  return getEntry(db, entryId)
}
