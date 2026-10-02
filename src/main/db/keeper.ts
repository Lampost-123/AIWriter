// All SQL for the memory keeper (milestone 2): each scene's processed version and run status,
// memory runs, the "What changed" list, suppressions, issues it raises, and marking scenes done.
// Tables and columns come from migration 2. Pure functions over a better-sqlite3 handle, no
// Electron imports.

import type Database from 'better-sqlite3'
import type { ID, MemoryLogItem, Origin, SceneMeta, SceneMemoryState, SummaryLevel } from '@shared/types'
import { newId, now } from '../util'
import { getSceneMeta } from './repo'
import { getChange } from './memory'
import { linksForEntry, linksForFact } from './history'
import { fingerprint } from '../keeper/facts'
import { plain } from '../keeper/text'

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

// ---------- Marking scenes done ----------

/** Marks a scene done (Ctrl+Enter) and keeps the text it was marked done with. */
export function markSceneDone(db: DB, id: ID): SceneMeta {
  getSceneMeta(db, id)
  const t = now()
  db.prepare("UPDATE scenes SET status = 'done', accepted_at = ?, accepted_text = text, updated_at = ? WHERE id = ?").run(t, t, id)
  return getSceneMeta(db, id)
}

/** Opens a scene marked done for more work. */
export function reopenScene(db: DB, id: ID): SceneMeta {
  getSceneMeta(db, id)
  db.prepare("UPDATE scenes SET status = 'revised', accepted_at = NULL, updated_at = ? WHERE id = ?").run(now(), id)
  return getSceneMeta(db, id)
}

// ---------- Each scene's memory state ----------

/** A paragraph as the keeper last read it. `id` is the editor's paragraph id, or '#n' (its place) when it has none. */
export interface ReadParagraph {
  id: string
  hash: string
  text: string
}

/** A live scene as the keeper sees it. */
export interface KeeperScene {
  sceneId: ID
  chapterId: ID
  storyId: ID
  title: string
  status: SceneMeta['status']
  text: string
  doc: unknown | null
  textVersion: number
  memoryVersion: number
  /** The paragraphs the keeper read at memoryVersion. */
  read: ReadParagraph[]
  memoryState: SceneMemoryState
  memoryError: string | null
  acceptedAt: string | null
}

const toKeeperScene = (r: Row): KeeperScene => ({
  sceneId: r.id as string,
  chapterId: r.chapter_id as string,
  storyId: r.story_id as string,
  title: r.title as string,
  status: r.status as SceneMeta['status'],
  text: (r.text as string) ?? '',
  doc: json<unknown>(r.doc_json, null),
  textVersion: (r.text_version as number) ?? 0,
  memoryVersion: (r.memory_version as number) ?? 0,
  read: json<ReadParagraph[]>(r.memory_paragraphs_json, []),
  memoryState: ((r.memory_status as string) ?? 'current') as SceneMemoryState,
  memoryError: (r.memory_error as string | null) ?? null,
  acceptedAt: (r.accepted_at as string | null) ?? null
})

const LIVE = `FROM scenes s JOIN chapters c ON c.id = s.chapter_id JOIN stories st ON st.id = c.story_id
  WHERE s.deleted_at IS NULL AND c.deleted_at IS NULL AND st.deleted_at IS NULL`
const LIVE_SCENES = `SELECT s.*, c.story_id ${LIVE}`
/** Ids only: a scene's text and document are never read just to check its state. */
const LIVE_IDS = `SELECT s.id ${LIVE}`
const BEHIND = "(s.memory_status <> 'current' OR s.text_version > s.memory_version)"
const READING_ORDER = 'ORDER BY st.created_order, c.position, s.position'

/** One live scene, or null when it (or its chapter or story) is deleted. */
export function keeperScene(db: DB, sceneId: ID): KeeperScene | null {
  const r = db.prepare(`${LIVE_SCENES} AND s.id = ?`).get(sceneId) as Row | undefined
  return r ? toKeeperScene(r) : null
}

/** Live scenes the memory hasn't caught up with (waiting, or "Memory not updated"), in reading order. */
export function scenesToRead(db: DB): ID[] {
  return (db.prepare(`${LIVE_IDS} AND ${BEHIND} ${READING_ORDER}`).all() as Row[]).map((r) => r.id as string)
}

/** True when a live scene's latest text hasn't been read (or its last read failed). */
export function needsReading(db: DB, sceneId: ID): boolean {
  return !!db.prepare(`${LIVE_IDS} AND s.id = ? AND ${BEHIND}`).get(sceneId)
}

/** Every live scene id, in reading order. */
export function liveSceneIds(db: DB): ID[] {
  return (db.prepare(`${LIVE_IDS} ${READING_ORDER}`).all() as Row[]).map((r) => r.id as string)
}

/** A save moved the scene's text on: its memory is waiting to be read ("Memory not updated" stays until a read works). */
export function noteSceneSaved(db: DB, sceneId: ID): void {
  db.prepare(
    "UPDATE scenes SET text_version = text_version + 1, memory_status = CASE WHEN memory_status = 'failed' THEN 'failed' ELSE 'pending' END WHERE id = ?"
  ).run(sceneId)
}

/** Records that the keeper has read this version of the scene, and the paragraphs it read. */
export function markProcessed(db: DB, sceneId: ID, version: number, read: ReadParagraph[]): void {
  db.prepare(
    `UPDATE scenes SET memory_version = ?, memory_paragraphs_json = ?, memory_error = NULL,
       memory_status = CASE WHEN text_version > ? THEN 'pending' ELSE 'current' END WHERE id = ?`
  ).run(version, JSON.stringify(read), version, sceneId)
}

/** The keeper couldn't read the scene: it shows "Memory not updated" and is tried again later. */
export function markFailed(db: DB, sceneId: ID, error: string): void {
  db.prepare("UPDATE scenes SET memory_status = 'failed', memory_error = ? WHERE id = ?").run(error, sceneId)
}

/** Puts the latest reason on a scene's "Memory not updated" line in What changed; false when it has none. */
export function updateFailedLine(db: DB, sceneId: ID, text: string): boolean {
  const r = db
    .prepare("SELECT id FROM memory_log WHERE scene_id = ? AND action = 'failed' AND undone_at IS NULL ORDER BY rowid DESC LIMIT 1")
    .get(sceneId) as Row | undefined
  if (!r) return false
  db.prepare('UPDATE memory_log SET text = ? WHERE id = ?').run(text, r.id)
  return true
}

/** How many live scenes are waiting to be read, and how many show "Memory not updated". */
export function memoryCounts(db: DB): { behind: number; failed: number } {
  const r = db
    .prepare(
      `SELECT SUM(CASE WHEN s.memory_status = 'failed' THEN 0 WHEN s.memory_status = 'pending' OR s.text_version > s.memory_version THEN 1 ELSE 0 END) AS behind,
              SUM(CASE WHEN s.memory_status = 'failed' THEN 1 ELSE 0 END) AS failed
       FROM scenes s JOIN chapters c ON c.id = s.chapter_id JOIN stories st ON st.id = c.story_id
       WHERE s.deleted_at IS NULL AND c.deleted_at IS NULL AND st.deleted_at IS NULL`
    )
    .get() as Row
  return { behind: (r.behind as number) ?? 0, failed: (r.failed as number) ?? 0 }
}

/** The latest error of a scene that shows "Memory not updated", newest first. */
export function latestFailure(db: DB): { sceneId: ID; error: string } | null {
  const r = db
    .prepare(
      `SELECT s.id, s.memory_error FROM scenes s JOIN chapters c ON c.id = s.chapter_id JOIN stories st ON st.id = c.story_id
       WHERE s.deleted_at IS NULL AND c.deleted_at IS NULL AND st.deleted_at IS NULL AND s.memory_status = 'failed' AND s.memory_error IS NOT NULL
       ORDER BY s.updated_at DESC LIMIT 1`
    )
    .get() as Row | undefined
  return r ? { sceneId: r.id as string, error: r.memory_error as string } : null
}

// ---------- Runs ----------

export interface RunTotals {
  providerId: ID | null
  modelId: string | null
  promptTokens: number | null
  completionTokens: number | null
  cost: number | null
  generationIds: ID[]
}

export function startRun(db: DB, sceneId: ID, sceneVersion: number): ID {
  const id = newId()
  db.prepare("INSERT INTO memory_runs (id, scene_id, scene_version, status, created_at) VALUES (?, ?, ?, 'running', ?)").run(
    id,
    sceneId,
    sceneVersion,
    now()
  )
  return id
}

export function finishRun(db: DB, id: ID, status: 'done' | 'failed' | 'stopped', error: string | null, t: RunTotals): void {
  db.prepare(
    `UPDATE memory_runs SET status = ?, error = ?, provider_id = ?, model_id = ?, prompt_tokens = ?, completion_tokens = ?, cost = ?,
       generation_ids_json = ?, finished_at = ? WHERE id = ?`
  ).run(status, error, t.providerId, t.modelId, t.promptTokens, t.completionTokens, t.cost, JSON.stringify(t.generationIds), now(), id)
}

/** After a crash or a forced quit: runs left 'running' count as stopped (their scenes are read again). */
export function stopUnfinishedRuns(db: DB): number {
  return db.prepare("UPDATE memory_runs SET status = 'stopped', finished_at = COALESCE(finished_at, ?) WHERE status = 'running'").run(now())
    .changes
}

/** A memory call cut short by the world closing: its record is finished as stopped. */
export function stopRecord(db: DB, generationId: ID): void {
  db.prepare("UPDATE generations SET status = 'stopped', finished_at = COALESCE(finished_at, ?) WHERE id = ? AND status = 'streaming'").run(
    now(),
    generationId
  )
}

export function getRun(
  db: DB,
  id: ID
): (RunTotals & { id: ID; sceneId: ID; sceneVersion: number; status: string; error: string | null }) | null {
  const r = db.prepare('SELECT * FROM memory_runs WHERE id = ?').get(id) as Row | undefined
  if (!r) return null
  return {
    id: r.id as string,
    sceneId: r.scene_id as string,
    sceneVersion: r.scene_version as number,
    status: r.status as string,
    error: (r.error as string | null) ?? null,
    providerId: (r.provider_id as string | null) ?? null,
    modelId: (r.model_id as string | null) ?? null,
    promptTokens: (r.prompt_tokens as number | null) ?? null,
    completionTokens: (r.completion_tokens as number | null) ?? null,
    cost: (r.cost as number | null) ?? null,
    generationIds: json<ID[]>(r.generation_ids_json, [])
  }
}

// ---------- The "What changed" list ----------

/** A line of the list as stored: the item without its place in words, plus what an undo or an answer needs. */
export interface LogRow extends Omit<MemoryLogItem, 'where'> {
  /** What undoing it (or answering its question) needs; written by the keeper, read only by it. */
  undo: Record<string, unknown> | null
}

const toLog = (r: Row): LogRow => ({
  id: r.id as string,
  runId: r.run_id as string,
  sceneId: (r.scene_id as string | null) ?? null,
  entryName: (r.entry_name as string) ?? '',
  text: (r.text as string) ?? '',
  before: (r.before as string) ?? '',
  after: (r.after as string) ?? '',
  action: r.action as LogRow['action'],
  what: r.what as LogRow['what'],
  entryId: (r.entry_id as string | null) ?? null,
  factId: (r.fact_id as string | null) ?? null,
  quote: (r.quote as string) ?? '',
  question: json<LogRow['question']>(r.question_json, null),
  createdAt: r.created_at as string,
  undone: r.undone_at != null,
  undo: json<Record<string, unknown> | null>(r.undo_json, null)
})

export type NewLog = Omit<LogRow, 'id' | 'createdAt' | 'undone'>

export function insertLog(db: DB, l: NewLog): LogRow {
  const id = newId()
  db.prepare(
    `INSERT INTO memory_log (id, run_id, scene_id, action, what, entry_id, fact_id, entry_name, text, before, after, quote, question_json, undo_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    l.runId,
    l.sceneId,
    l.action,
    l.what,
    l.entryId,
    l.factId,
    l.entryName,
    l.text,
    l.before,
    l.after,
    l.quote,
    l.question ? JSON.stringify(l.question) : null,
    l.undo ? JSON.stringify(l.undo) : null,
    now()
  )
  return getLog(db, id)!
}

export function getLog(db: DB, id: ID): LogRow | null {
  const r = db.prepare('SELECT * FROM memory_log WHERE id = ?').get(id) as Row | undefined
  return r ? toLog(r) : null
}

/** Newest first; lines of one run stay in the order they were made. */
export function listLog(db: DB, o: { sceneId?: ID; entryId?: ID; limit?: number } = {}): LogRow[] {
  const where: string[] = []
  const args: unknown[] = []
  if (o.sceneId) {
    where.push('scene_id = ?')
    args.push(o.sceneId)
  }
  if (o.entryId) {
    where.push('entry_id = ?')
    args.push(o.entryId)
  }
  const limit = Math.max(1, Math.min(Math.floor(o.limit ?? 200), 1000))
  // Runs newest first (by their last line shown); a run's own lines in the order they were made.
  const filter = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const rows = db
    .prepare(
      `SELECT l.* FROM memory_log l JOIN (SELECT run_id, MAX(rowid) AS last FROM memory_log ${filter} GROUP BY run_id) r ON r.run_id = l.run_id
       ${where.length ? `WHERE ${where.map((w) => `l.${w}`).join(' AND ')}` : ''} ORDER BY r.last DESC, l.rowid ASC LIMIT ${limit}`
    )
    .all(...args, ...args) as Row[]
  return rows.map(toLog)
}

export function logForRun(db: DB, runId: ID): LogRow[] {
  return (db.prepare('SELECT * FROM memory_log WHERE run_id = ? ORDER BY rowid').all(runId) as Row[]).map(toLog)
}

export function markUndone(db: DB, id: ID): void {
  db.prepare('UPDATE memory_log SET undone_at = ? WHERE id = ?').run(now(), id)
}

export function setLogQuestion(db: DB, id: ID, question: LogRow['question'], undo?: Record<string, unknown> | null): void {
  db.prepare('UPDATE memory_log SET question_json = ?, undo_json = COALESCE(?, undo_json) WHERE id = ?').run(
    question ? JSON.stringify(question) : null,
    undo ? JSON.stringify(undo) : null,
    id
  )
}

/**
 * The last run that changed something, for the quiet "Memory updated" note. Asked after every save,
 * so it reads only the newest line and its run's lines (by index), never the whole list.
 */
export function lastUpdate(db: DB): { at: string; runId: ID; changes: number } | null {
  const last = db.prepare("SELECT run_id FROM memory_log WHERE action <> 'failed' ORDER BY created_at DESC, rowid DESC LIMIT 1").get() as
    | Row
    | undefined
  if (!last) return null
  const r = db
    .prepare("SELECT MAX(created_at) AS at, COUNT(*) AS n FROM memory_log WHERE run_id = ? AND action <> 'failed'")
    .get(last.run_id) as Row
  return { at: r.at as string, runId: last.run_id as string, changes: r.n as number }
}

// ---------- Suppressions: facts Adam undid, not added again from the same words ----------

/** `words` is compared as given: pass the words in a plain form (see keeper/text.ts `plain`). */
export function addSuppression(db: DB, fingerprint: string, sceneId: ID, words: string): void {
  db.prepare('INSERT OR IGNORE INTO suppressions (id, fingerprint, scene_id, quote, created_at) VALUES (?, ?, ?, ?, ?)').run(
    newId(),
    fingerprint,
    sceneId,
    words,
    now()
  )
}

/**
 * Adam removed a fact by hand (a change on an entry page, or a detail): the keeper won't add it again
 * from the words it came from, unless they change. Call before removing it. Facts with no source
 * links (typed by Adam) need nothing.
 */
export function suppressFact(db: DB, factKind: 'change' | 'field', factId: ID, field?: string): void {
  if (factKind === 'change') {
    let fp: string
    try {
      const c = getChange(db, factId)
      fp = fingerprint({ type: 'change', entryId: c.entryId, change: c })
    } catch {
      return
    }
    for (const l of linksForFact(db, 'change', factId)) addSuppression(db, fp, l.sceneId, plain(l.quote))
    return
  }
  if (!field) return
  const fp = fingerprint({ type: 'field', entryId: factId, field })
  for (const l of linksForEntry(db, factId))
    if (l.factKind === 'field' && l.field === field) addSuppression(db, fp, l.sceneId, plain(l.quote))
}

export function suppressionsInScene(db: DB, sceneId: ID): { fingerprint: string; words: string }[] {
  return (db.prepare('SELECT fingerprint, quote FROM suppressions WHERE scene_id = ?').all(sceneId) as Row[]).map((r) => ({
    fingerprint: r.fingerprint as string,
    words: r.quote as string
  }))
}

// ---------- Issues the keeper raises ----------

/** A consistency issue: the text disagrees with one of Adam's facts. Not raised twice for the same thing while open. */
export function raiseIssue(
  db: DB,
  i: {
    sceneId: ID
    storyId: ID
    kind: string
    severity: string
    quote: string
    message: string
    key: string
    payload: Record<string, unknown>
  }
): boolean {
  const open = db
    .prepare("SELECT id, payload_json FROM issues WHERE scene_id = ? AND kind = ? AND status = 'open'")
    .all(i.sceneId, i.kind) as Row[]
  if (open.some((r) => json<{ key?: string }>(r.payload_json, {}).key === i.key)) return false
  const t = now()
  db.prepare(
    `INSERT INTO issues (id, scene_id, story_id, kind, severity, status, quote, message, payload_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)`
  ).run(newId(), i.sceneId, i.storyId, i.kind, i.severity, i.quote, i.message, JSON.stringify({ ...i.payload, key: i.key }), t, t)
  return true
}

// ---------- Summaries ----------

/** A summary row with who wrote it and what it was made from. */
export function summaryRow(
  db: DB,
  level: SummaryLevel,
  targetId: ID
): { text: string; origin: Origin; stale: boolean; sourceHash: string } | null {
  const r = db.prepare('SELECT text, origin, stale, source_hash FROM summaries WHERE level = ? AND target_id = ?').get(level, targetId) as
    | Row
    | undefined
  if (!r) return null
  return { text: r.text as string, origin: (r.origin as Origin) ?? 'text', stale: !!r.stale, sourceHash: (r.source_hash as string) ?? '' }
}

/** Removes a summary the keeper wrote (Adam's own are never removed). */
export function deleteTextSummary(db: DB, level: SummaryLevel, targetId: ID): boolean {
  return db.prepare("DELETE FROM summaries WHERE level = ? AND target_id = ? AND origin <> 'adam'").run(level, targetId).changes > 0
}

/** Marks a summary the keeper wrote as out of date (Adam's own are left alone). */
export function markTextSummaryStale(db: DB, level: SummaryLevel, targetId: ID): void {
  db.prepare("UPDATE summaries SET stale = 1 WHERE level = ? AND target_id = ? AND origin <> 'adam' AND stale = 0").run(level, targetId)
}

/** Records what a summary stands for without rewriting it (after an undo, so it isn't written again until that changes). */
export function setSummarySourceHash(db: DB, level: SummaryLevel, targetId: ID, sourceHash: string): void {
  db.prepare('UPDATE summaries SET source_hash = ?, stale = 0 WHERE level = ? AND target_id = ?').run(sourceHash, level, targetId)
}

// ---------- Memory history ----------

/** The number of a fact's latest version (0 when it has none). */
export function latestVersion(db: DB, factKind: 'entry' | 'change' | 'summary', factId: ID): number {
  const r = db
    .prepare('SELECT COALESCE(MAX(version), 0) AS v FROM fact_versions WHERE fact_kind = ? AND fact_id = ?')
    .get(factKind, factId) as Row
  return r.v as number
}

/** A fact as it was at one version, and who wrote that version; null when there is no such version. */
export function versionData(
  db: DB,
  factKind: 'entry' | 'change' | 'summary',
  factId: ID,
  version: number
): { data: unknown; origin: Origin } | null {
  const r = db
    .prepare('SELECT data_json, origin FROM fact_versions WHERE fact_kind = ? AND fact_id = ? AND version = ?')
    .get(factKind, factId, version) as Row | undefined
  return r ? { data: json<unknown>(r.data_json, null), origin: r.origin as Origin } : null
}

/** True when a line already asks this question (by the key in its undo data). */
export function questionAsked(db: DB, key: string): boolean {
  const rows = db.prepare('SELECT undo_json FROM memory_log WHERE question_json IS NOT NULL AND undo_json LIKE ?').all(`%${key}%`) as Row[]
  return rows.some((r) => json<{ key?: string }>(r.undo_json, {}).key === key)
}

// ---------- References ----------

/**
 * True when something other than the keeper's own links refers to the entry: a live change on it
 * or pointing at it (other than `ignoreChangeIds`), a scene card, a pin, or a place inside it.
 */
export function entryReferenced(db: DB, entryId: ID, ignoreChangeIds: ID[] = []): boolean {
  const ignore = new Set(ignoreChangeIds)
  const changes = db
    .prepare('SELECT id FROM changes WHERE deleted_at IS NULL AND (entry_id = ? OR payload_json LIKE ?)')
    .all(entryId, `%${entryId}%`) as Row[]
  if (changes.some((c) => !ignore.has(c.id as string))) return true
  if (db.prepare('SELECT 1 FROM scenes WHERE deleted_at IS NULL AND card_json LIKE ? LIMIT 1').get(`%${entryId}%`)) return true
  if (db.prepare('SELECT 1 FROM pins WHERE entry_id = ? LIMIT 1').get(entryId)) return true
  return !!db.prepare('SELECT 1 FROM entries WHERE parent_id = ? AND deleted_at IS NULL LIMIT 1').get(entryId)
}

/**
 * Puts back who some of an entry's fields come from (an undo restores them exactly): an origin per
 * key, or null to let the key follow the entry's own origin again.
 */
export function setFieldOrigins(db: DB, entryId: ID, origins: Record<string, Origin | null>): void {
  const r = db.prepare('SELECT field_origins_json FROM entries WHERE id = ?').get(entryId) as Row | undefined
  if (!r) return
  const current = json<Record<string, Origin>>(r.field_origins_json, {})
  for (const [k, v] of Object.entries(origins)) {
    if (v) current[k] = v
    else delete current[k]
  }
  db.prepare('UPDATE entries SET field_origins_json = ? WHERE id = ?').run(JSON.stringify(current), entryId)
}

/** Brings back an entry from Trash (an undo of the keeper moving it there). */
export function untrashEntry(db: DB, id: ID): void {
  db.prepare('UPDATE entries SET deleted_at = NULL WHERE id = ?').run(id)
}

/** Removes a first-exists point the keeper added (never one Adam set). */
export function deleteDefaultExistsPoint(db: DB, id: ID): void {
  db.prepare('DELETE FROM exists_points WHERE id = ? AND by_hand = 0').run(id)
}

/** Ends a side story after a chapter of its host ("End Kell's Road before this point"); returns what it was. */
export function setSideStoryEnd(
  db: DB,
  storyId: ID,
  endAt: 'end' | 'chapter',
  endRefId: ID | null
): { endAt: string | null; endRefId: ID | null } {
  const r = db.prepare('SELECT end_at, end_ref_id FROM stories WHERE id = ?').get(storyId) as Row | undefined
  db.prepare('UPDATE stories SET end_at = ?, end_ref_id = ?, updated_at = ? WHERE id = ?').run(endAt, endRefId, now(), storyId)
  return { endAt: (r?.end_at as string | null) ?? null, endRefId: (r?.end_ref_id as string | null) ?? null }
}
