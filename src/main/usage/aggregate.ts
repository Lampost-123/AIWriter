// Adding up one world's AI spending (milestone 6, Usage and cost), from its `generations` table: every AI
// call AI Write makes, the memory keeper's included, is one row there with its job, model, tokens and cost.
// `memory_runs` only adds up the keeper's generation records for each run, so it is never read here (that
// would count the keeper twice).
//
// A world's spending is kept as a tally: sums by local day, job, model and provider, plus how far the table
// has been read. Reading again reads only the rows added since and the rows that were still being written,
// so it stays quick however long the world has been used (a row's tokens and cost sit behind its briefing
// and reply, which can be large). Rows deleted (a scene emptied from Recently deleted takes its records with
// it) or renumbered are noticed by the row count and the last row's id, and then the table is read again in
// full; spending already counted never goes down, since that money was spent.
// Pure over a better-sqlite3 handle; no Electron.

import type Database from 'better-sqlite3'

type DB = Database.Database

/** Calls, dollars and tokens in one bucket. */
export interface Bucket {
  calls: number
  cost: number
  promptTokens: number
  /** Of the prompt tokens, those the provider read from its cache (missing in a tally kept before 0.6). */
  cachedTokens?: number
  completionTokens: number
  /** Calls with no price at all. */
  unpriced: number
  /** Calls whose price is an estimate (no tokens reported). */
  estimated: number
}

export interface WorldTally {
  /** What has been read: how many rows, the highest rowid, and that row's id. */
  seen: { count: number; top: number; topId: string | null }
  /** Rows still being written when last read (their cost isn't known yet), by rowid. */
  pending: number[]
  /** By `bucketKey(day, job, model, provider)`. */
  buckets: Record<string, Bucket>
}

export const emptyTally = (): WorldTally => ({ seen: { count: 0, top: 0, topId: null }, pending: [], buckets: {} })
export const emptyBucket = (): Bucket => ({ calls: 0, cost: 0, promptTokens: 0, cachedTokens: 0, completionTokens: 0, unpriced: 0, estimated: 0 })

const SEP = '\t'
export const bucketKey = (day: string, job: string, model: string, provider: string): string => [day, job, model, provider].join(SEP)
export function splitKey(key: string): { day: string; job: string; model: string; provider: string } {
  const [day = '', job = '', model = '', provider = ''] = key.split(SEP)
  return { day, job, model, provider }
}

/** "2026-10-03" for a moment, in local time (what Adam calls that day). */
export function localDay(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

interface Row {
  r: number
  job: string | null
  model_id: string | null
  provider_name: string | null
  status: string
  pt: number | null
  cached: number | null
  ct: number | null
  cost: number | null
  created_at: string
  said: number | null
}

const COLUMNS = `rowid AS r, job, model_id, provider_name, status, prompt_tokens AS pt, completion_tokens AS ct, cost, created_at,
  (response <> '') AS said, CASE WHEN json_valid(params_json) THEN json_extract(params_json, '$.cachedTokens') END AS cached`

/**
 * Adds a finished row to the buckets. A request turned down before anything was sent (no tokens, no cost, no
 * words back) cost nothing and isn't a call. Returns false for a row still being written.
 */
function add(buckets: Record<string, Bucket>, row: Row, dayOf: (iso: string) => string): boolean {
  if (row.status === 'streaming') return false
  const cost = typeof row.cost === 'number' && Number.isFinite(row.cost) ? row.cost : null
  const ran = cost != null || row.pt != null || row.ct != null || row.said === 1
  if (!ran) return true
  const key = bucketKey(dayOf(row.created_at), row.job || 'draft', row.model_id || '', row.provider_name || '')
  const b = (buckets[key] ??= emptyBucket())
  b.calls++
  b.promptTokens += row.pt ?? 0
  b.cachedTokens = (b.cachedTokens ?? 0) + (typeof row.cached === 'number' ? row.cached : 0)
  b.completionTokens += row.ct ?? 0
  if (cost == null) b.unpriced++
  else {
    b.cost += cost
    // As the Drafts list says: a cost with no tokens from the provider is AI Write's own estimate.
    if (row.pt == null) b.estimated++
  }
  return true
}

const clone = (t: WorldTally): WorldTally => ({
  seen: { ...t.seen },
  pending: [...t.pending],
  buckets: Object.fromEntries(Object.entries(t.buckets).map(([k, b]) => [k, { ...b }]))
})

/**
 * The world's tally brought up to date: from `before` (reading only what is new) when it still fits the table,
 * else from scratch. Never changes `before`. Throws only when the database can't be read.
 */
export function tallyWorld(db: DB, before: WorldTally | null, dayOf: (iso: string) => string = localDay): WorldTally {
  const head = db.prepare('SELECT count(*) AS n, max(rowid) AS top FROM generations').get() as { n: number; top: number | null }
  const top = head.top ?? 0
  // A copy of a world made on this computer leaves out the records it was copied with (the original counts them).
  const from = Number((db.prepare("SELECT value FROM meta WHERE key = 'usage_from_rowid'").get() as { value: string } | undefined)?.value) || 0
  const idAt = (rowid: number): string | null =>
    (db.prepare('SELECT id FROM generations WHERE rowid = ?').get(rowid) as { id: string } | undefined)?.id ?? null

  if (before && before.seen.top <= top && (before.seen.top === 0 || idAt(before.seen.top) === before.seen.topId)) {
    // Two halves, so each is found by rowid (an OR between them would read through every row of the table).
    const rows = db
      .prepare(
        `SELECT ${COLUMNS} FROM generations WHERE rowid > ?
         UNION ALL SELECT ${COLUMNS} FROM generations WHERE rowid IN (SELECT value FROM json_each(?)) AND rowid <= ?
         ORDER BY r`
      )
      .all(before.seen.top, JSON.stringify(before.pending), before.seen.top) as Row[]
    const added = rows.filter((r) => r.r > before.seen.top).length
    if (before.seen.count + added === head.n) {
      const next = clone(before)
      const still = new Set<number>()
      for (const row of rows) if (row.r > from && !add(next.buckets, row, dayOf)) still.add(row.r)
      // A row still pending that has gone (deleted while being written) is simply forgotten.
      next.pending = [...still]
      next.seen = { count: head.n, top, topId: top ? idAt(top) : null }
      return next
    }
  }

  // From scratch: every row.
  const fresh = emptyTally()
  const pending: number[] = []
  for (const row of db.prepare(`SELECT ${COLUMNS} FROM generations ORDER BY rowid`).iterate() as IterableIterator<Row>) {
    if (row.r > from && !add(fresh.buckets, row, dayOf)) pending.push(row.r)
  }
  fresh.pending = pending
  fresh.seen = { count: head.n, top, topId: top ? idAt(top) : null }
  // Money already counted was spent, even if its records have since gone with a deleted scene.
  if (before) {
    for (const [key, old] of Object.entries(before.buckets)) {
      const now = fresh.buckets[key]
      if (!now || old.cost > now.cost || (old.cost === now.cost && old.calls > now.calls)) fresh.buckets[key] = { ...old }
    }
  }
  return fresh
}

/** The sum of some buckets. */
export function addUp(buckets: Iterable<Bucket>): Bucket {
  const t = emptyBucket()
  for (const b of buckets) {
    t.calls += b.calls
    t.cost += b.cost
    t.promptTokens += b.promptTokens
    t.cachedTokens = (t.cachedTokens ?? 0) + (b.cachedTokens ?? 0)
    t.completionTokens += b.completionTokens
    t.unpriced += b.unpriced
    t.estimated += b.estimated
  }
  return t
}

/** The dollars spent in a month ("2026-10") in one tally. */
export function monthCost(t: WorldTally, month: string): number {
  let n = 0
  const prefix = `${month}-`
  for (const [key, b] of Object.entries(t.buckets)) if (key.startsWith(prefix)) n += b.cost
  return n
}
