// Adam's plan for each plot thread (long story memory fix 10, the promises ledger): the chapter it should be paid off
// by, whether he dropped it, and what he said Keep to in Worth a look. Kept in the world's meta table, one row a thread
// (`thread_plan:<thread id>`, JSON of ThreadPlan; no row for an empty plan), as chapter cards and beat markers are, so it
// travels in world files and backups and needs no migration. A thread in Recently deleted keeps its row (a restore
// brings it back); purgeTrash drops the rows of threads gone for good (db/trash.ts). A pay-off chapter that is gone is
// read as none.

import type Database from 'better-sqlite3'
import type { ID, ThreadPlan } from '@shared/types'
import * as repo from './repo'

type DB = Database.Database

export const THREAD_PLAN_PREFIX = 'thread_plan:'
const key = (threadId: ID): string => `${THREAD_PLAN_PREFIX}${threadId}`

const isId = (v: unknown): v is ID => typeof v === 'string' && v !== ''

/** A plan as it may be stored: anything unreadable is left out. Null when nothing is left. */
export function cleanPlan(v: unknown): ThreadPlan | null {
  if (!v || typeof v !== 'object') return null
  const p = v as Record<string, unknown>
  const out: ThreadPlan = {}
  if (isId(p.payBy)) out.payBy = p.payBy
  if (p.dropped === true) out.dropped = true
  const k = p.kept as Record<string, unknown> | null | undefined
  if (k && typeof k === 'object') {
    const kept: NonNullable<ThreadPlan['kept']> = {}
    if (isId(k.due)) kept.due = k.due
    if (k.touch === null || isId(k.touch)) kept.touch = k.touch
    if (typeof k.quiet === 'number' && Number.isFinite(k.quiet) && k.quiet >= 0) kept.quiet = Math.floor(k.quiet)
    if (Object.keys(kept).length) out.kept = kept
  }
  return Object.keys(out).length ? out : null
}

/** One thread's plan; null when it has none. */
export function threadPlan(db: DB, threadId: ID): ThreadPlan | null {
  const raw = repo.getMeta(db, key(threadId))
  if (!raw) return null
  try {
    return cleanPlan(JSON.parse(raw))
  } catch {
    return null
  }
}

/** Every thread's plan, by thread id (one query however many there are). */
export function threadPlans(db: DB): Map<ID, ThreadPlan> {
  const rows = db
    .prepare(`SELECT key, value FROM meta WHERE substr(key, 1, ${THREAD_PLAN_PREFIX.length}) = ?`)
    .all(THREAD_PLAN_PREFIX) as { key: string; value: string }[]
  const out = new Map<ID, ThreadPlan>()
  for (const r of rows) {
    try {
      const plan = cleanPlan(JSON.parse(r.value))
      if (plan) out.set(r.key.slice(THREAD_PLAN_PREFIX.length), plan)
    } catch {
      // A damaged row reads as no plan.
    }
  }
  return out
}

/** Keeps a thread's plan as it is given; an empty one (or null) takes the row away. */
export function setThreadPlan(db: DB, threadId: ID, plan: ThreadPlan | null): void {
  const clean = cleanPlan(plan)
  if (clean) repo.setMeta(db, key(threadId), JSON.stringify(clean))
  else db.prepare('DELETE FROM meta WHERE key = ?').run(key(threadId))
}

/** Rows of threads that are gone for good (called when the Trash is emptied). */
export function dropPlansOfGoneThreads(db: DB): void {
  db.prepare(
    `DELETE FROM meta WHERE substr(key, 1, ${THREAD_PLAN_PREFIX.length}) = ? AND substr(key, ${THREAD_PLAN_PREFIX.length + 1}) NOT IN (SELECT id FROM entries)`
  ).run(THREAD_PLAN_PREFIX)
}
