// All SQL for consistency issues (milestone 5, AI checks part): reading `issues` rows as the contract's
// Issue, a scene's and a story's issues, open counts for the binder's badges, status changes, saving what a
// check found, and marking issues whose words have gone. The table is migration 2's, unchanged: everything
// beyond its columns is in `payload_json`. Pure functions over a better-sqlite3 handle, no Electron imports.
//
// Rows come from three places, and all read the same way:
// - the memory keeper's clashes with Adam's facts: { entryId, field, memory, text, key };
// - the world builder's, the same plus from: 'summary', with scene '' (story-wide);
// - the AI checks': { key, by: 'check', check, sources, fix, memoryFix, entryId, field }.
// A clash with one of Adam's own fields can be settled by updating the memory (memoryFix): the field
// takes the text's value, as his.

import type Database from 'better-sqlite3'
import type { CheckKind, Issue, IssueKind, IssueSeverity, IssueSource, IssueStatus } from '@shared/contracts/checks'
import type { ID, Origin } from '@shared/types'
import { newId, now } from '../util'
import { plainQuote, quoteAt, stillThere } from '../checks/quote'

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

/** What an issue's payload_json may hold (each source of rows fills its own part). */
export interface IssuePayload {
  key?: string
  /** The entry and field it is about (the keeper's and the world builder's, and the checks' too, so each can tell they are the same). */
  entryId?: ID
  field?: string | null
  /** The keeper's: what the memory says, and what the text says. */
  memory?: string
  text?: string
  /** The world builder's: found in Adam's summary of the world. */
  from?: 'summary'
  /** The AI checks'. */
  by?: 'check'
  check?: CheckKind | 'story'
  sources?: IssueSource[]
  fix?: string | null
  memoryFix?: Issue['memoryFix']
  /** A story issue: the other story it was compared with. */
  otherStoryId?: ID
}

// ---------- Telling the window ----------

type Touched = (storyId: ID | null, sceneIds: ID[]) => void
let listener: Touched | null = null
const pending = new Map<string, Set<ID>>()
let timer: ReturnType<typeof setTimeout> | null = null

/** Who hears that issues changed (the checks part, which tells the window). One listener. */
export function onIssuesTouched(fn: Touched | null): void {
  listener = fn
}

/**
 * Notes that a scene's (or a story's) issues changed. Told together a moment later, after the
 * transaction that changed them, so the window reads them once.
 */
export function issuesTouched(storyId: ID | null | undefined, sceneId: ID | null | undefined): void {
  if (!listener) return
  const key = storyId || ''
  const set = pending.get(key) ?? new Set<ID>()
  if (sceneId) set.add(sceneId)
  pending.set(key, set)
  timer ??= setTimeout(() => {
    timer = null
    const all = [...pending]
    pending.clear()
    for (const [story, scenes] of all) listener?.(story || null, [...scenes])
  }, 0)
}

// ---------- Reading rows as issues ----------

/** What reading an issue needs to know beyond its row: entries' names and who wrote their fields, places in plain words. */
export interface IssueNames {
  entry(id: ID): { name: string; isAdams: (field: string) => boolean } | null
  sceneLabel(id: ID): string | null
  storyTitle(id: ID): string | null
}

const SEVERITIES: IssueSeverity[] = ['must-fix', 'warning', 'minor']
const STATUSES: IssueStatus[] = ['open', 'ignored', 'fixed', 'gone']

/** Who wrote an entry's field: its own origin unless the field says otherwise. */
export const fieldOriginOf = (origin: Origin, fieldOrigins: Record<string, Origin>, field: string): Origin => fieldOrigins[field] ?? origin

/** Brings a stored source's name up to date (an entry renamed since, a scene moved), keeping the stored words if it has gone. */
function freshSource(s: IssueSource, names: IssueNames): IssueSource {
  switch (s.kind) {
    case 'entry':
    case 'thread':
      return { ...s, name: names.entry(s.entryId)?.name ?? s.name }
    case 'scene':
      return { ...s, label: names.sceneLabel(s.sceneId) ?? s.label }
    case 'story':
      return { ...s, title: names.storyTitle(s.storyId) ?? s.title }
  }
}

/** An issue row as the contract's Issue. */
export function readIssue(r: Row, names: IssueNames): Issue {
  const p = json<IssuePayload>(r.payload_json, {})
  const entry = p.entryId ? names.entry(p.entryId) : null
  let sources: IssueSource[]
  if (Array.isArray(p.sources)) sources = p.sources.filter((s) => s && typeof s === 'object').map((s) => freshSource(s, names))
  else sources = p.entryId && entry ? [{ kind: 'entry', entryId: p.entryId, name: entry.name, field: p.field ?? null }] : []
  // The keeper's and the world builder's clashes with one of Adam's own fields: the text's value can become his.
  let memoryFix = p.memoryFix ?? null
  if (p.memoryFix === undefined && p.entryId && entry && p.field && p.field !== 'name' && (p.text ?? '').trim() && entry.isAdams(p.field)) {
    memoryFix = { entryId: p.entryId, field: p.field, value: (p.text ?? '').trim() }
  }
  const severity = r.severity as IssueSeverity
  const status = r.status as IssueStatus
  return {
    id: r.id as ID,
    sceneId: (r.scene_id as string) || null,
    storyId: (r.story_id as string) || null,
    kind: r.kind as IssueKind,
    severity: SEVERITIES.includes(severity) ? severity : 'warning',
    status: STATUSES.includes(status) ? status : 'open',
    quote: (r.quote as string) ?? '',
    message: (r.message as string) ?? '',
    sources,
    fix: typeof p.fix === 'string' && p.fix.trim() ? p.fix : null,
    memoryFix,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string
  }
}

/** Entries' names and who wrote each field, for the entries these rows name (one query). */
export function entryNamesFor(db: DB, rows: Row[]): Map<ID, { name: string; origin: Origin; fieldOrigins: Record<string, Origin> }> {
  const ids = new Set<ID>()
  for (const r of rows) {
    const p = json<IssuePayload>(r.payload_json, {})
    if (p.entryId) ids.add(p.entryId)
    for (const s of p.sources ?? []) if (s && (s.kind === 'entry' || s.kind === 'thread')) ids.add(s.entryId)
  }
  const out = new Map<ID, { name: string; origin: Origin; fieldOrigins: Record<string, Origin> }>()
  if (!ids.size) return out
  const list = [...ids]
  for (let i = 0; i < list.length; i += 500) {
    const part = list.slice(i, i + 500)
    const got = db.prepare(`SELECT id, name, origin, field_origins_json FROM entries WHERE id IN (${part.map(() => '?').join(',')})`).all(...part) as Row[]
    for (const e of got) {
      out.set(e.id as ID, {
        name: e.name as string,
        origin: ((e.origin as Origin) || 'adam') as Origin,
        fieldOrigins: json<Record<string, Origin>>(e.field_origins_json, {})
      })
    }
  }
  return out
}

/** Every story's title, by id. */
export function storyTitles(db: DB): Map<ID, string> {
  return new Map((db.prepare('SELECT id, title FROM stories').all() as Row[]).map((r) => [r.id as ID, r.title as string]))
}

// ---------- Lists and counts ----------

const RANK: Record<string, number> = { 'must-fix': 0, warning: 1, minor: 2 }
const STATUS_RANK: Record<string, number> = { open: 0, ignored: 1, fixed: 2, gone: 3 }

/** Open first (must fix first, then in reading order), then ignored, then fixed; newest last within each. */
export function sortIssues(rows: Row[], textOf: (sceneId: ID) => string): Row[] {
  const at = new Map<Row, number>()
  for (const r of rows) at.set(r, r.scene_id ? quoteAt(textOf(r.scene_id as ID), (r.quote as string) ?? '') : Infinity)
  return [...rows].sort(
    (a, b) =>
      (STATUS_RANK[a.status as string] ?? 9) - (STATUS_RANK[b.status as string] ?? 9) ||
      (RANK[a.severity as string] ?? 9) - (RANK[b.severity as string] ?? 9) ||
      (at.get(a)! === at.get(b)! ? 0 : at.get(a)! < at.get(b)! ? -1 : 1) ||
      String(a.created_at).localeCompare(String(b.created_at))
  )
}

/** A scene's issues (not those whose words have gone), unsorted. */
export function sceneIssueRows(db: DB, sceneId: ID): Row[] {
  return db.prepare("SELECT * FROM issues WHERE scene_id = ? AND status <> 'gone'").all(sceneId) as Row[]
}

/** A story's issues: its scenes' (live scenes only) and its story-wide ones, not those whose words have gone. */
export function storyIssueRows(db: DB, storyId: ID): Row[] {
  return db
    .prepare(
      `SELECT i.* FROM issues i
       WHERE i.status <> 'gone' AND (
         i.scene_id IN (SELECT sc.id FROM scenes sc JOIN chapters c ON c.id = sc.chapter_id
                        WHERE c.story_id = ? AND sc.deleted_at IS NULL AND c.deleted_at IS NULL)
         OR ((i.scene_id IS NULL OR i.scene_id = '') AND i.story_id = ?))`
    )
    .all(storyId, storyId) as Row[]
}

/** Open issues per live scene in a story, with how many must be fixed. Scenes with none are left out. */
export function openCounts(db: DB, storyId: ID): Record<ID, { count: number; mustFix: number }> {
  const rows = db
    .prepare(
      `SELECT i.scene_id AS scene_id, COUNT(*) AS n, SUM(CASE WHEN i.severity = 'must-fix' THEN 1 ELSE 0 END) AS m
       FROM issues i JOIN scenes sc ON sc.id = i.scene_id JOIN chapters c ON c.id = sc.chapter_id
       WHERE i.status = 'open' AND c.story_id = ? AND sc.deleted_at IS NULL AND c.deleted_at IS NULL
       GROUP BY i.scene_id`
    )
    .all(storyId) as Row[]
  const out: Record<ID, { count: number; mustFix: number }> = {}
  for (const r of rows) out[r.scene_id as ID] = { count: Number(r.n) || 0, mustFix: Number(r.m) || 0 }
  return out
}

/** The text of these scenes (live or in Recently deleted), by id. */
export function sceneTexts(db: DB, sceneIds: ID[]): Map<ID, string> {
  const out = new Map<ID, string>()
  const ids = [...new Set(sceneIds)]
  for (let i = 0; i < ids.length; i += 500) {
    const part = ids.slice(i, i + 500)
    for (const r of db.prepare(`SELECT id, text FROM scenes WHERE id IN (${part.map(() => '?').join(',')})`).all(...part) as Row[]) {
      out.set(r.id as ID, (r.text as string) ?? '')
    }
  }
  return out
}

/**
 * Open issues whose words are no longer in their scene's text become 'gone' (a scene that no longer
 * exists at all takes its issues with it; one in Recently deleted keeps them, as it may come back).
 * Ignored and fixed ones are never touched. Cheap: only scenes with open, quoted issues are read.
 * Returns the scenes whose issues changed.
 */
export function sweepGone(db: DB, where: { sceneId: ID } | { storyId: ID }): ID[] {
  const rows = (
    'sceneId' in where
      ? db.prepare("SELECT id, scene_id, story_id, quote FROM issues WHERE status = 'open' AND scene_id = ? AND quote <> ''").all(where.sceneId)
      : db
          .prepare(
            `SELECT id, scene_id, story_id, quote FROM issues WHERE status = 'open' AND quote <> '' AND scene_id IS NOT NULL AND scene_id <> ''
             AND (story_id = ? OR scene_id IN (SELECT sc.id FROM scenes sc JOIN chapters c ON c.id = sc.chapter_id WHERE c.story_id = ?))`
          )
          .all(where.storyId, where.storyId)
  ) as Row[]
  if (!rows.length) return []
  const texts = sceneTexts(
    db,
    rows.map((r) => r.scene_id as ID)
  )
  const gone = rows.filter((r) => {
    const text = texts.get(r.scene_id as ID)
    return text === undefined || !stillThere(text, r.quote as string)
  })
  if (!gone.length) return []
  const t = now()
  const set = db.prepare("UPDATE issues SET status = 'gone', updated_at = ? WHERE id = ? AND status = 'open'")
  db.transaction(() => {
    for (const r of gone) set.run(t, r.id)
  })()
  const scenes = [...new Set(gone.map((r) => r.scene_id as ID))]
  for (const r of gone) issuesTouched(r.story_id as ID | null, r.scene_id as ID)
  return scenes
}

// ---------- One issue ----------

export function issueRow(db: DB, id: ID): Row | null {
  return (db.prepare('SELECT * FROM issues WHERE id = ?').get(id) as Row | undefined) ?? null
}

/** Changes an issue's status. Returns the row as it is now, or null when there is no such issue. */
export function setIssueStatus(db: DB, id: ID, status: IssueStatus): Row | null {
  const r = issueRow(db, id)
  if (!r) return null
  if (r.status !== status) {
    db.prepare('UPDATE issues SET status = ?, updated_at = ? WHERE id = ?').run(status, now(), id)
    issuesTouched(r.story_id as ID | null, (r.scene_id as ID) || null)
  }
  return issueRow(db, id)
}

// ---------- Saving what a check found ----------

/** One thing a check found, ready to save. */
export interface FoundIssue {
  sceneId: ID | null
  storyId: ID
  kind: IssueKind
  severity: IssueSeverity
  quote: string
  message: string
  key: string
  payload: IssuePayload
}

/** True when two rows are about the same thing in the same place: the same entry and field, or the same words for the same kind. */
function sameThing(p: IssuePayload, row: Row, f: FoundIssue): boolean {
  const q = json<IssuePayload>(row.payload_json, {})
  if (q.key && q.key === f.key) return true
  if ((row.scene_id || null) !== (f.sceneId || null)) return false
  if (p.entryId && q.entryId === p.entryId && p.field && q.field === p.field) return true
  return row.kind === f.kind && !!f.quote && plainQuote(row.quote as string) === plainQuote(f.quote) && (q.entryId ?? null) === (p.entryId ?? null)
}

/**
 * Saves what a check found in one transaction, replacing what the same check found there before:
 * - anything Adam ignored (by key, or the same entry and field or words) is never raised again;
 * - something already open (the memory keeper's clash about the same thing, say) stays as it is, and
 *   takes the check's suggested rewrite if it had none;
 * - something the same check found before is updated in place (fixed or gone ones come back open);
 * - what the same check found before and didn't find this time goes (`replaces` says which rows
 *   this run stands for).
 * `existing` are the rows to compare with. Returns how many new issues were raised.
 */
export function saveFound(db: DB, existing: Row[], found: FoundIssue[], replaces: (p: IssuePayload, row: Row) => boolean): number {
  const t = now()
  let raised = 0
  const kept = new Set<ID>()
  db.transaction(() => {
    const rows = [...existing]
    for (const f of found) {
      const p: IssuePayload = { ...f.payload, key: f.key }
      const same = rows.filter((r) => sameThing(p, r, f))
      if (same.some((r) => r.status === 'ignored')) continue
      const mine = same.find((r) => json<IssuePayload>(r.payload_json, {}).key === f.key)
      const other = same.find((r) => r.status === 'open' && r !== mine)
      if (other && (!mine || mine.status !== 'open')) {
        // Already raised (by the memory keeper, or another check): it stays, with the rewrite if it lacked one.
        kept.add(other.id as ID)
        const q = json<IssuePayload>(other.payload_json, {})
        if (!q.fix && p.fix) {
          db.prepare('UPDATE issues SET payload_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify({ ...q, fix: p.fix }), t, other.id)
          issuesTouched(f.storyId, f.sceneId)
        }
        continue
      }
      if (mine) {
        kept.add(mine.id as ID)
        const wasOpen = mine.status === 'open'
        db.prepare(
          "UPDATE issues SET status = 'open', severity = ?, quote = ?, message = ?, payload_json = ?, kind = ?, scene_id = ?, story_id = ?, updated_at = ? WHERE id = ?"
        ).run(f.severity, f.quote, f.message, JSON.stringify(p), f.kind, f.sceneId ?? '', f.storyId, t, mine.id)
        if (!wasOpen) raised++
        issuesTouched(f.storyId, f.sceneId)
        continue
      }
      const id = newId()
      db.prepare(
        `INSERT INTO issues (id, scene_id, story_id, kind, severity, status, quote, message, payload_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)`
      ).run(id, f.sceneId ?? '', f.storyId, f.kind, f.severity, f.quote, f.message, JSON.stringify(p), t, t)
      kept.add(id)
      rows.push(issueRow(db, id)!)
      raised++
      issuesTouched(f.storyId, f.sceneId)
    }
    // What this check found before and not this time goes (only open ones: ignored stay ignored, fixed stay fixed).
    for (const r of existing) {
      if (r.status !== 'open' || kept.has(r.id as ID)) continue
      const q = json<IssuePayload>(r.payload_json, {})
      if (q.by !== 'check' || !replaces(q, r)) continue
      db.prepare('DELETE FROM issues WHERE id = ?').run(r.id)
      issuesTouched(r.story_id as ID | null, (r.scene_id as ID) || null)
    }
  })()
  return raised
}

/** Every issue row in these scenes (any status). */
export function rowsInScenes(db: DB, sceneIds: ID[]): Row[] {
  if (!sceneIds.length) return []
  const out: Row[] = []
  for (let i = 0; i < sceneIds.length; i += 500) {
    const part = sceneIds.slice(i, i + 500)
    out.push(...(db.prepare(`SELECT * FROM issues WHERE scene_id IN (${part.map(() => '?').join(',')})`).all(...part) as Row[]))
  }
  return out
}

/** Every story issue (kind 'story') a check raised for this story (any status, any scene). */
export function storyKindRows(db: DB, storyId: ID): Row[] {
  return db.prepare("SELECT * FROM issues WHERE kind = 'story' AND story_id = ?").all(storyId) as Row[]
}

/** The payload of a row. */
export const payloadOf = (r: Row): IssuePayload => json<IssuePayload>(r.payload_json, {})

/** How many open issues a scene has that were raised at or after `since` (by a check, or by the memory keeper). */
export function openSince(db: DB, sceneId: ID, since: string): number {
  const r = db.prepare("SELECT COUNT(*) AS n FROM issues WHERE scene_id = ? AND status = 'open' AND created_at >= ?").get(sceneId, since) as Row
  return Number(r.n) || 0
}
