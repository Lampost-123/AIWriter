// All SQL for the memory keeper: what it last read of each scene, the facts it found that aren't
// rows in `changes`, the quiet "What changed" list, the guesses Adam undid, and accepting and
// reopening scenes. Tables come from the end of migration 2. Pure functions over a
// better-sqlite3 handle, no Electron imports.

import type Database from 'better-sqlite3'
import type { ID, MemoryLogItem, SceneMeta, SummaryLevel } from '@shared/types'
import { newId, now } from '../util'
import { getSceneMeta } from './repo'

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

// ---------- Accepting and reopening scenes ----------

/** Marks a scene done (Accept, Ctrl+Enter) and keeps the text it was accepted with. */
export function acceptScene(db: DB, id: ID): SceneMeta {
  getSceneMeta(db, id)
  const t = now()
  db.prepare("UPDATE scenes SET status = 'done', accepted_at = ?, accepted_text = text, updated_at = ? WHERE id = ?").run(t, t, id)
  return getSceneMeta(db, id)
}

/** Opens an accepted scene for more work. */
export function reopenScene(db: DB, id: ID): SceneMeta {
  getSceneMeta(db, id)
  db.prepare("UPDATE scenes SET status = 'revised', accepted_at = NULL, updated_at = ? WHERE id = ?").run(now(), id)
  return getSceneMeta(db, id)
}

// ---------- What the keeper last read of each scene ----------

/** A live scene as the keeper sees it: its text, and what it last read of it. */
export interface KeeperScene {
  sceneId: ID
  chapterId: ID
  storyId: ID
  title: string
  text: string
  /** The text the keeper last read ('' if never). */
  readText: string
  /** The text the scene summary was last written from (null if never). */
  summarySource: string | null
  acceptedAt: string | null
}

const toKeeperScene = (r: Row): KeeperScene => ({
  sceneId: r.id as string,
  chapterId: r.chapter_id as string,
  storyId: r.story_id as string,
  title: r.title as string,
  text: (r.text as string) ?? '',
  readText: (r.read_text as string) ?? '',
  summarySource: (r.summary_source as string | null) ?? null,
  acceptedAt: (r.accepted_at as string | null) ?? null
})

const SCENE_SELECT = `SELECT s.id, s.chapter_id, c.story_id, s.title, s.text, s.accepted_at, k.read_text, k.summary_source
  FROM scenes s JOIN chapters c ON c.id = s.chapter_id JOIN stories st ON st.id = c.story_id
  LEFT JOIN keeper_scenes k ON k.scene_id = s.id
  WHERE s.deleted_at IS NULL AND c.deleted_at IS NULL AND st.deleted_at IS NULL`

/** One live scene, or null when it (or its chapter or story) is deleted. */
export function keeperScene(db: DB, sceneId: ID): KeeperScene | null {
  const r = db.prepare(`${SCENE_SELECT} AND s.id = ?`).get(sceneId) as Row | undefined
  return r ? toKeeperScene(r) : null
}

/** Every live scene, in reading order (stories by creation, then chapters and scenes). */
export function keeperScenes(db: DB): KeeperScene[] {
  return (db.prepare(`${SCENE_SELECT} ORDER BY st.created_order, c.position, s.position`).all() as Row[]).map(toKeeperScene)
}

/** Live scenes whose text the keeper hasn't read yet, in reading order. */
export function behindSceneIds(db: DB): ID[] {
  return (
    db.prepare(`SELECT id FROM (${SCENE_SELECT} AND s.text <> COALESCE(k.read_text, '') ORDER BY st.created_order, c.position, s.position)`).all() as Row[]
  ).map((r) => r.id as string)
}

function ensureRow(db: DB, sceneId: ID): void {
  db.prepare('INSERT OR IGNORE INTO keeper_scenes (scene_id, updated_at) VALUES (?, ?)').run(sceneId, now())
}

/** Records that the keeper has read this text of the scene. */
export function markRead(db: DB, sceneId: ID, text: string): void {
  ensureRow(db, sceneId)
  const t = now()
  db.prepare('UPDATE keeper_scenes SET read_text = ?, read_at = ?, error = NULL, updated_at = ? WHERE scene_id = ?').run(text, t, t, sceneId)
}

/** Records the text the scene summary was written from. */
export function setSummarySource(db: DB, sceneId: ID, text: string | null): void {
  ensureRow(db, sceneId)
  db.prepare('UPDATE keeper_scenes SET summary_source = ?, updated_at = ? WHERE scene_id = ?').run(text, now(), sceneId)
}

/** Why the last attempt to read the scene failed, in plain words (null clears it). */
export function setSceneError(db: DB, sceneId: ID, error: string | null): void {
  ensureRow(db, sceneId)
  db.prepare('UPDATE keeper_scenes SET error = ?, updated_at = ? WHERE scene_id = ?').run(error, now(), sceneId)
}

export function sceneError(db: DB, sceneId: ID): string | null {
  const r = db.prepare('SELECT error FROM keeper_scenes WHERE scene_id = ?').get(sceneId) as Row | undefined
  return (r?.error as string | null) ?? null
}

// ---------- Facts that aren't rows in changes ----------

/** entry: an entry the keeper made; exists: an entry from elsewhere found here; voice: a sample line it added. */
export type KeeperFactKind = 'entry' | 'exists' | 'voice'

export interface KeeperFact {
  id: ID
  sceneId: ID
  kind: KeeperFactKind
  entryId: ID
  /** The exists point, for 'exists'. */
  refId: ID | null
  /** The sample line, for 'voice'. */
  line: string
  quote: string
  runId: ID | null
}

const toFact = (r: Row): KeeperFact => ({
  id: r.id as string,
  sceneId: r.scene_id as string,
  kind: r.kind as KeeperFactKind,
  entryId: r.entry_id as string,
  refId: (r.ref_id as string | null) ?? null,
  line: (r.line as string) ?? '',
  quote: (r.quote as string) ?? '',
  runId: (r.run_id as string | null) ?? null
})

export function listKeeperFacts(db: DB, sceneId: ID): KeeperFact[] {
  return (db.prepare('SELECT * FROM keeper_facts WHERE scene_id = ? ORDER BY created_at, rowid').all(sceneId) as Row[]).map(toFact)
}

export function getKeeperFact(db: DB, id: ID): KeeperFact | null {
  const r = db.prepare('SELECT * FROM keeper_facts WHERE id = ?').get(id) as Row | undefined
  return r ? toFact(r) : null
}

export function insertKeeperFact(db: DB, f: Omit<KeeperFact, 'id'>): KeeperFact {
  const id = newId()
  const t = now()
  db.prepare(
    'INSERT INTO keeper_facts (id, scene_id, kind, entry_id, ref_id, line, quote, run_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, f.sceneId, f.kind, f.entryId, f.refId, f.line, f.quote, f.runId, t, t)
  return getKeeperFact(db, id)!
}

export function updateKeeperFact(db: DB, id: ID, patch: { quote?: string; line?: string; runId?: ID | null }): void {
  const f = getKeeperFact(db, id)
  if (!f) return
  db.prepare('UPDATE keeper_facts SET quote = ?, line = ?, run_id = ?, updated_at = ? WHERE id = ?').run(
    patch.quote ?? f.quote,
    patch.line ?? f.line,
    patch.runId !== undefined ? patch.runId : f.runId,
    now(),
    id
  )
}

export function deleteKeeperFact(db: DB, id: ID): void {
  db.prepare('DELETE FROM keeper_facts WHERE id = ?').run(id)
}

/** Puts back a fact row exactly as it was (undo). */
export function restoreKeeperFact(db: DB, f: KeeperFact): void {
  const t = now()
  db.prepare(
    `INSERT OR REPLACE INTO keeper_facts (id, scene_id, kind, entry_id, ref_id, line, quote, run_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(f.id, f.sceneId, f.kind, f.entryId, f.refId, f.line, f.quote, f.runId, t, t)
}

/** Removes a first-exists point the keeper added (never one Adam set). */
export function deleteDefaultExistsPoint(db: DB, id: ID): void {
  db.prepare('DELETE FROM exists_points WHERE id = ? AND by_hand = 0').run(id)
}

/**
 * True when something other than the given facts refers to the entry: a change on it or pointing
 * at it, a scene card, a pin, a place inside it, or another fact the keeper found elsewhere.
 */
export function entryReferenced(db: DB, entryId: ID, ignore: { changeIds?: ID[]; factIds?: ID[] } = {}): boolean {
  const changeIgnore = new Set(ignore.changeIds ?? [])
  const factIgnore = new Set(ignore.factIds ?? [])
  const changes = db
    .prepare(
      `SELECT id, entry_id, kind, payload_json FROM changes WHERE deleted_at IS NULL
       AND (entry_id = ? OR payload_json LIKE ?)`
    )
    .all(entryId, `%${entryId}%`) as Row[]
  if (changes.some((c) => !changeIgnore.has(c.id as string))) return true
  const like = `%${entryId}%`
  if (db.prepare('SELECT 1 FROM scenes WHERE deleted_at IS NULL AND card_json LIKE ? LIMIT 1').get(like)) return true
  if (db.prepare('SELECT 1 FROM pins WHERE entry_id = ? LIMIT 1').get(entryId)) return true
  if (db.prepare('SELECT 1 FROM entries WHERE parent_id = ? AND deleted_at IS NULL LIMIT 1').get(entryId)) return true
  const facts = db.prepare('SELECT id FROM keeper_facts WHERE entry_id = ?').all(entryId) as Row[]
  return facts.some((f) => !factIgnore.has(f.id as string))
}

/**
 * Facts the keeper found in this scene that Adam deleted himself (from an entry page or the
 * trash): the keeper treats them as guesses he said no to. Ones the keeper removed are left out.
 */
export function adamDeletedInScene(db: DB, sceneId: ID): { changes: Row[]; entries: Row[] } {
  const changes = db
    .prepare(
      `SELECT c.* FROM changes c WHERE c.scene_id = ? AND c.source = 'memory' AND c.deleted_at IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM keeper_log l WHERE l.change_id = c.id AND l.action = 'removed')`
    )
    .all(sceneId) as Row[]
  const entries = db
    .prepare(
      `SELECT e.* FROM entries e WHERE e.origin = 'memory' AND e.origin_scene_id = ? AND e.deleted_at IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM keeper_log l WHERE l.entry_id = e.id AND l.action = 'removed' AND l.detail = 'entry')`
    )
    .all(sceneId) as Row[]
  return { changes, entries }
}

// ---------- The "What changed" list ----------

export type LogDetail = 'entry' | 'exists' | 'voice' | 'change' | 'summary'

export interface LogRow {
  id: ID
  runId: ID | null
  sceneId: ID | null
  action: MemoryLogItem['action']
  what: MemoryLogItem['what']
  detail: LogDetail
  entryId: ID | null
  changeId: ID | null
  /** The keeper_facts row, for entry / exists / voice. */
  factId: ID | null
  summaryLevel: SummaryLevel | null
  summaryTarget: ID | null
  text: string
  quote: string
  /** What an undo puts back. */
  before: unknown
  /** Changes made along with an entry (undone with it). */
  bundle: ID[]
  /** The guess, so an undone one is never made again. */
  guess: unknown
  undone: boolean
  createdAt: string
}

const toLog = (r: Row): LogRow => ({
  id: r.id as string,
  runId: (r.run_id as string | null) ?? null,
  sceneId: (r.scene_id as string | null) ?? null,
  action: r.action as LogRow['action'],
  what: r.what as LogRow['what'],
  detail: r.detail as LogDetail,
  entryId: (r.entry_id as string | null) ?? null,
  changeId: (r.change_id as string | null) ?? null,
  factId: (r.fact_id as string | null) ?? null,
  summaryLevel: (r.summary_level as SummaryLevel | null) ?? null,
  summaryTarget: (r.summary_target as string | null) ?? null,
  text: r.text as string,
  quote: (r.quote as string) ?? '',
  before: json<unknown>(r.before_json, null),
  bundle: json<ID[]>(r.bundle_json, []),
  guess: json<unknown>(r.guess_json, null),
  undone: r.undone_at != null,
  createdAt: r.created_at as string
})

export type NewLog = Omit<LogRow, 'id' | 'undone' | 'createdAt'>

/** Adds to the "What changed" list. Items made in one moment keep their order (rowid breaks ties). */
export function insertLog(db: DB, l: NewLog): LogRow {
  const id = newId()
  db.prepare(
    `INSERT INTO keeper_log (id, run_id, scene_id, action, what, detail, entry_id, change_id, fact_id, summary_level, summary_target,
       text, quote, before_json, bundle_json, guess_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    l.runId,
    l.sceneId,
    l.action,
    l.what,
    l.detail,
    l.entryId,
    l.changeId,
    l.factId,
    l.summaryLevel,
    l.summaryTarget,
    l.text,
    l.quote,
    l.before === undefined || l.before === null ? null : JSON.stringify(l.before),
    JSON.stringify(l.bundle ?? []),
    l.guess === undefined || l.guess === null ? null : JSON.stringify(l.guess),
    now()
  )
  return getLog(db, id)!
}

export function getLog(db: DB, id: ID): LogRow | null {
  const r = db.prepare('SELECT * FROM keeper_log WHERE id = ?').get(id) as Row | undefined
  return r ? toLog(r) : null
}

/** The list, newest first, for a scene, an entry (as the subject or bundled with it) or everything. */
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
  const limit = Math.max(1, Math.min(o.limit ?? 200, 1000))
  const sql = `SELECT * FROM keeper_log ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC, rowid DESC LIMIT ${limit}`
  return (db.prepare(sql).all(...args) as Row[]).map(toLog)
}

export function markUndone(db: DB, id: ID): void {
  db.prepare('UPDATE keeper_log SET undone_at = ? WHERE id = ?').run(now(), id)
}

// ---------- Guesses Adam said no to ----------

export function addRejected(db: DB, sceneId: ID | null, guess: unknown): void {
  db.prepare('INSERT INTO keeper_rejected (id, scene_id, guess_json, created_at) VALUES (?, ?, ?, ?)').run(newId(), sceneId, JSON.stringify(guess), now())
}

export function listRejected(db: DB, sceneId: ID): unknown[] {
  return (db.prepare('SELECT guess_json FROM keeper_rejected WHERE scene_id = ? ORDER BY created_at, rowid').all(sceneId) as Row[]).map((r) =>
    json<unknown>(r.guess_json, null)
  )
}

// ---------- Summaries ----------

/** What an automatic summary was made from (its source hash), or null when there is none. */
export function summaryHash(db: DB, level: SummaryLevel, targetId: ID): string | null {
  const r = db.prepare('SELECT source_hash FROM summaries WHERE level = ? AND target_id = ?').get(level, targetId) as Row | undefined
  return r ? ((r.source_hash as string) ?? '') : null
}

/** Removes an automatic summary (a scene emptied of text); Adam's own words are never removed. */
export function deleteAutoSummary(db: DB, level: SummaryLevel, targetId: ID): boolean {
  return db.prepare('DELETE FROM summaries WHERE level = ? AND target_id = ? AND by_hand = 0').run(level, targetId).changes > 0
}

/** Puts a summary row back exactly as it was (undo), or removes it when there was none. */
export function restoreSummary(
  db: DB,
  level: SummaryLevel,
  targetId: ID,
  before: { text: string; byHand: boolean; stale: boolean; sourceHash: string; generationId: ID | null } | null,
  sourceHash: string
): void {
  if (!before) {
    db.prepare('DELETE FROM summaries WHERE level = ? AND target_id = ? AND by_hand = 0').run(level, targetId)
    return
  }
  // The restored words stand until what they were made from changes again.
  db.prepare(
    `INSERT INTO summaries (level, target_id, text, by_hand, stale, source_hash, generation_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(level, target_id) DO UPDATE SET text = excluded.text, by_hand = excluded.by_hand, stale = excluded.stale,
       source_hash = excluded.source_hash, generation_id = excluded.generation_id, updated_at = excluded.updated_at`
  ).run(level, targetId, before.text, before.byHand ? 1 : 0, before.stale ? 1 : 0, sourceHash, before.generationId, now())
}

/** A summary row with what it was made from and the record of the call that wrote it. */
export function summaryRow(
  db: DB,
  level: SummaryLevel,
  targetId: ID
): { text: string; byHand: boolean; stale: boolean; sourceHash: string; generationId: ID | null } | null {
  const r = db.prepare('SELECT * FROM summaries WHERE level = ? AND target_id = ?').get(level, targetId) as Row | undefined
  if (!r) return null
  return {
    text: r.text as string,
    byHand: !!r.by_hand,
    stale: !!r.stale,
    sourceHash: (r.source_hash as string) ?? '',
    generationId: (r.generation_id as string | null) ?? null
  }
}

/** Marks an automatic scene summary as out of date (Adam's own are left alone). */
export function markAutoSummaryStale(db: DB, level: SummaryLevel, targetId: ID): void {
  db.prepare('UPDATE summaries SET stale = 1 WHERE level = ? AND target_id = ? AND by_hand = 0 AND stale = 0').run(level, targetId)
}
