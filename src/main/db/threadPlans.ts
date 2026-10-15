// Adam's plan for each plot thread (long story memory fix 10, the promises ledger): the chapter it should be paid off
// by, whether he dropped it, and what he said Keep to in Worth a look. Kept in the world's meta table, one row a thread
// (`thread_plan:<thread id>`, JSON of ThreadPlan; no row for an empty plan), as chapter cards and beat markers are, so it
// travels in world files and backups and needs no migration. A thread in Recently deleted keeps its row (a restore
// brings it back); purgeTrash drops the rows of threads gone for good (db/trash.ts). A pay-off chapter in Recently
// deleted is read as none of Adam's (memory/promises.ts: a scene card's plan holds, as with no chapter chosen) and comes
// back with a restore; one gone for good (purgeTrash, the outline helper's Undo, an imported story taking the empty
// first one's place) is cleared from every plan, with what Keep remembered for it (clearGoneChapters).

import type Database from 'better-sqlite3'
import type { ID, ThreadPlan } from '@shared/types'

type DB = Database.Database

export const THREAD_PLAN_PREFIX = 'thread_plan:'
const key = (threadId: ID): string => `${THREAD_PLAN_PREFIX}${threadId}`

// The meta table's own SQL (as in db/repo.ts), so db/acts.ts, which repo.ts reads, can use this file.
const getMeta = (db: DB, k: string): string | null => (db.prepare('SELECT value FROM meta WHERE key = ?').get(k) as { value: string } | undefined)?.value ?? null
const setMeta = (db: DB, k: string, value: string): void =>
  void db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, value)

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
  const raw = getMeta(db, key(threadId))
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
  if (clean) setMeta(db, key(threadId), JSON.stringify(clean))
  else db.prepare('DELETE FROM meta WHERE key = ?').run(key(threadId))
}

/**
 * Clears every plan's pay-off chapter, and what Keep remembered for a due chapter, where that chapter is gone for good
 * (no longer in the world at all; one in Recently deleted stays). A plan left empty goes.
 */
export function clearGoneChapters(db: DB): void {
  const plans = threadPlans(db)
  const named = [...new Set([...plans.values()].flatMap((p) => [p.payBy, p.kept?.due].filter((id): id is ID => !!id)))]
  if (!named.length) return
  const there = new Set(
    (db.prepare('SELECT id FROM chapters WHERE id IN (SELECT value FROM json_each(?))').all(JSON.stringify(named)) as { id: ID }[]).map((r) => r.id)
  )
  for (const [threadId, plan] of plans) {
    const payBy = plan.payBy && !there.has(plan.payBy)
    const due = plan.kept?.due && !there.has(plan.kept.due)
    if (!payBy && !due) continue
    const next: ThreadPlan = { ...plan }
    if (payBy) delete next.payBy
    if (due && next.kept) {
      const { due: _gone, ...kept } = next.kept
      if (Object.keys(kept).length) next.kept = kept
      else delete next.kept
    }
    setThreadPlan(db, threadId, next)
  }
}

/** Rows of threads that are gone for good (called when the Trash is emptied). */
export function dropPlansOfGoneThreads(db: DB): void {
  db.prepare(
    `DELETE FROM meta WHERE substr(key, 1, ${THREAD_PLAN_PREFIX.length}) = ? AND substr(key, ${THREAD_PLAN_PREFIX.length + 1}) NOT IN (SELECT id FROM entries)`
  ).run(THREAD_PLAN_PREFIX)
}
