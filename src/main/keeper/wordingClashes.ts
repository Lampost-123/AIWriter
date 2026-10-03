// Before 0.6.2 the memory raised an issue whenever a scene described someone or something in other words
// than the memory (or added to it), not only when the two couldn't both be true. Once per world, the
// open ones that aren't contradictions by the rule in agree.ts are set aside as ignored, so the Issues tab
// shows only real ones and Adam can still reopen any of them. Nothing else in the world changes.

import type Database from 'better-sqlite3'
import type { ID } from '@shared/types'
import * as repo from '../db/repo'
import * as cdb from '../db/checks'
import { contradicts } from './agree'

type DB = Database.Database

const DONE_KEY = 'clashRule'
const DONE_VALUE = '2'

/** Sets aside the memory's open "clashes" that only say the same in other words, or more. Returns how many. Runs once per world. */
export function setAsideWordingClashes(db: DB): number {
  if (repo.getMeta(db, DONE_KEY) === DONE_VALUE) return 0
  const rows = db.prepare("SELECT * FROM issues WHERE status = 'open' AND kind = 'fact'").all() as Record<string, unknown>[]
  let count = 0
  for (const r of rows) {
    let p: Record<string, unknown>
    try {
      p = JSON.parse(String(r.payload_json ?? '{}')) as Record<string, unknown>
    } catch {
      continue
    }
    // Only the memory's own clashes: an issue a consistency check also found (it carries the check's
    // rewrite) was judged on its meaning, and stays.
    if (typeof p.key !== 'string' || !p.key.startsWith('clash:') || p.check || p.fix) continue
    const field = typeof p.field === 'string' ? p.field : null
    const memory = typeof p.memory === 'string' ? p.memory : ''
    const text = typeof p.text === 'string' ? p.text : ''
    if (!memory.trim() || contradicts(field, memory, text)) continue
    cdb.setIssueStatus(db, r.id as ID, 'ignored')
    count++
  }
  repo.setMeta(db, DONE_KEY, DONE_VALUE)
  return count
}
