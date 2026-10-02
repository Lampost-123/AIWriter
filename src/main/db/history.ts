// Memory history and source links (milestone 2; spec, Multi-story rules: "Source links and
// automatic upkeep"). Every change to a fact, automatic or by hand, writes a version here, so any
// entry can be compared with and restored to an earlier one. Facts read from a scene keep links
// to the words they came from. Pure functions over a better-sqlite3 handle, no Electron imports.

import type Database from 'better-sqlite3'
import type { FactVersion, ID, Origin, SourceLink } from '@shared/types'
import { newId, now } from '../util'

type DB = Database.Database
type Row = Record<string, unknown>

const json = <T>(s: unknown, fallback: T): T => {
  if (typeof s !== 'string' || s === '') return fallback
  try {
    return JSON.parse(s) as T
  } catch {
    return fallback
  }
}

// ---------- Versions ----------

const toVersion = (r: Row): FactVersion => ({
  id: r.id as string,
  factKind: r.fact_kind as FactVersion['factKind'],
  factId: r.fact_id as string,
  entryId: (r.entry_id as string) ?? null,
  version: r.version as number,
  data: json<unknown>(r.data_json, null),
  origin: r.origin as Origin,
  runId: (r.run_id as string) ?? null,
  createdAt: r.created_at as string
})

/** Writes the next version of a fact. `data` is the fact as saved, or null when it was removed. */
export function recordVersion(
  db: DB,
  v: { factKind: FactVersion['factKind']; factId: ID; entryId: ID | null; data: unknown; origin: Origin; runId?: ID | null }
): FactVersion {
  const next =
    ((
      db
        .prepare('SELECT COALESCE(MAX(version), 0) AS v FROM fact_versions WHERE fact_kind = ? AND fact_id = ?')
        .get(v.factKind, v.factId) as Row
    ).v as number) + 1
  const id = newId()
  db.prepare(
    `INSERT INTO fact_versions (id, fact_kind, fact_id, entry_id, version, data_json, origin, run_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, v.factKind, v.factId, v.entryId, next, v.data == null ? null : JSON.stringify(v.data), v.origin, v.runId ?? null, now())
  return toVersion(db.prepare('SELECT * FROM fact_versions WHERE id = ?').get(id) as Row)
}

/** Every version of an entry and of its changes, newest first. */
export function entryHistory(db: DB, entryId: ID): FactVersion[] {
  return (db.prepare('SELECT * FROM fact_versions WHERE entry_id = ? ORDER BY created_at DESC, rowid DESC').all(entryId) as Row[]).map(
    toVersion
  )
}

export function getVersion(db: DB, id: ID): FactVersion | null {
  const r = db.prepare('SELECT * FROM fact_versions WHERE id = ?').get(id) as Row | undefined
  return r ? toVersion(r) : null
}

/** The version before the latest one of a fact (what an undo goes back to), or null. */
export function previousVersion(db: DB, factKind: FactVersion['factKind'], factId: ID): FactVersion | null {
  const r = db
    .prepare('SELECT * FROM fact_versions WHERE fact_kind = ? AND fact_id = ? ORDER BY version DESC LIMIT 1 OFFSET 1')
    .get(factKind, factId) as Row | undefined
  return r ? toVersion(r) : null
}

// ---------- Source links ----------

const toLink = (r: Row): SourceLink => ({
  id: r.id as string,
  factKind: r.fact_kind as SourceLink['factKind'],
  factId: r.fact_id as string,
  field: (r.field as string) ?? null,
  sceneId: r.scene_id as string,
  sceneVersion: r.scene_version as number,
  paragraphId: (r.paragraph_id as string) ?? null,
  start: r.start as number,
  end: r.end as number,
  quote: r.quote as string,
  state: r.state as SourceLink['state']
})

export function addLink(db: DB, l: Omit<SourceLink, 'id' | 'state'> & { state?: SourceLink['state'] }): SourceLink {
  const id = newId()
  const t = now()
  db.prepare(
    `INSERT INTO source_links (id, fact_kind, fact_id, field, scene_id, scene_version, paragraph_id, start, end, quote, state, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, l.factKind, l.factId, l.field, l.sceneId, l.sceneVersion, l.paragraphId, l.start, l.end, l.quote, l.state ?? 'ok', t, t)
  return toLink(db.prepare('SELECT * FROM source_links WHERE id = ?').get(id) as Row)
}

export function updateLink(
  db: DB,
  id: ID,
  patch: Partial<Pick<SourceLink, 'sceneVersion' | 'paragraphId' | 'start' | 'end' | 'quote' | 'state'>>
): void {
  const r = db.prepare('SELECT * FROM source_links WHERE id = ?').get(id) as Row | undefined
  if (!r) return
  const l = { ...toLink(r), ...patch }
  db.prepare(
    'UPDATE source_links SET scene_version = ?, paragraph_id = ?, start = ?, end = ?, quote = ?, state = ?, updated_at = ? WHERE id = ?'
  ).run(l.sceneVersion, l.paragraphId, l.start, l.end, l.quote, l.state, now(), id)
}

export function deleteLink(db: DB, id: ID): void {
  db.prepare('DELETE FROM source_links WHERE id = ?').run(id)
}

export function linksForFact(db: DB, factKind: SourceLink['factKind'], factId: ID): SourceLink[] {
  return (
    db.prepare('SELECT * FROM source_links WHERE fact_kind = ? AND fact_id = ? ORDER BY created_at, rowid').all(factKind, factId) as Row[]
  ).map(toLink)
}

/** The links of many facts of one kind, by fact id, in one query (for lists of changes). */
export function linksForFacts(db: DB, factKind: SourceLink['factKind'], factIds: ID[]): Map<ID, SourceLink[]> {
  const out = new Map<ID, SourceLink[]>()
  if (!factIds.length) return out
  const rows = db
    .prepare('SELECT * FROM source_links WHERE fact_kind = ? AND fact_id IN (SELECT value FROM json_each(?)) ORDER BY created_at, rowid')
    .all(factKind, JSON.stringify([...new Set(factIds)])) as Row[]
  for (const r of rows) {
    const l = toLink(r)
    const list = out.get(l.factId)
    if (list) list.push(l)
    else out.set(l.factId, [l])
  }
  return out
}

export function linksInScene(db: DB, sceneId: ID): SourceLink[] {
  return (db.prepare('SELECT * FROM source_links WHERE scene_id = ? ORDER BY created_at, rowid').all(sceneId) as Row[]).map(toLink)
}

/** The links of an entry itself and of its fields and voice lines. */
export function linksForEntry(db: DB, entryId: ID): SourceLink[] {
  return (
    db
      .prepare("SELECT * FROM source_links WHERE fact_id = ? AND fact_kind IN ('entry', 'field', 'voice') ORDER BY created_at, rowid")
      .all(entryId) as Row[]
  ).map(toLink)
}
