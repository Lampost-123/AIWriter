// All SQL for memory over time (milestone 2): changes, first-exists points, summaries, pins,
// per-scene block modes and Adam's answers. Pure functions over a better-sqlite3 handle, no
// Electron imports, so they can be unit-tested in plain Node. Which changes count where is
// worked out in src/main/memory (the line and state), never here.

import type Database from 'better-sqlite3'
import type {
  Answer,
  AnswerKind,
  BlockMode,
  Change,
  ChangeAnchor,
  ChangeData,
  ChangeInput,
  Entry,
  ExistsKind,
  ExistsPoint,
  ID,
  Origin,
  Pin,
  PinScope,
  Summary,
  SummaryLevel
} from '@shared/types'
import { newId, now, UserError } from '../util'
import { recordVersion } from './history'

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

// ---------- Changes ----------

const toChange = (r: Row): Change =>
  ({
    id: r.id as string,
    entryId: r.entry_id as string,
    anchor: r.anchor as ChangeAnchor,
    storyId: (r.story_id as string) ?? null,
    sceneId: (r.scene_id as string) ?? null,
    kind: r.kind as ChangeData['kind'],
    payload: json<ChangeData['payload']>(r.payload_json, {} as ChangeData['payload']),
    position: r.position as number,
    origin: r.origin as Origin,
    runId: (r.run_id as string) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string
  }) as Change

const ANCHORS: ChangeAnchor[] = ['baseline', 'story-start', 'scene']
const KINDS: ChangeData['kind'][] = ['update', 'full', 'relationship', 'knowledge', 'thread']

/** The story a scene is in (live or not), or null. */
function sceneStory(db: DB, sceneId: ID): ID | null {
  const r = db.prepare('SELECT c.story_id FROM scenes s JOIN chapters c ON c.id = s.chapter_id WHERE s.id = ?').get(sceneId) as
    | Row
    | undefined
  return r ? (r.story_id as string) : null
}

/** Checks an anchor and fills in the story for a scene change. */
function anchorFor(
  db: DB,
  input: Pick<ChangeInput, 'anchor' | 'storyId' | 'sceneId' | 'kind'>
): { storyId: ID | null; sceneId: ID | null } {
  if (!ANCHORS.includes(input.anchor)) throw new UserError('That change has no place in the story.')
  if (!KINDS.includes(input.kind)) throw new UserError("That kind of change isn't known.")
  if (input.anchor === 'baseline') return { storyId: null, sceneId: null }
  if (input.anchor === 'story-start') {
    if (!input.storyId) throw new UserError('A change at the start of a story needs its story.')
    return { storyId: input.storyId, sceneId: null }
  }
  if (!input.sceneId) throw new UserError('A change in a scene needs its scene.')
  const storyId = sceneStory(db, input.sceneId)
  if (!storyId) throw new UserError('That scene no longer exists.')
  return { storyId, sceneId: input.sceneId }
}

export type NewChange = ChangeInput & {
  origin: Origin
  /** The memory keeper run that makes it (text- and ai-origin changes). */
  runId?: ID | null
  /** Order among changes at the same anchor; after the others when left out. */
  position?: number
}

export function getChange(db: DB, id: ID): Change {
  const r = db.prepare('SELECT * FROM changes WHERE id = ? AND deleted_at IS NULL').get(id) as Row | undefined
  if (!r) throw new UserError('That change no longer exists.')
  return toChange(r)
}

export function insertChange(db: DB, c: NewChange): Change {
  const { storyId, sceneId } = anchorFor(db, c)
  const t = now()
  const id = newId()
  const position =
    c.position ??
    ((
      db
        .prepare(
          `SELECT COALESCE(MAX(position), -1) AS p FROM changes
           WHERE anchor = ? AND COALESCE(story_id, '') = COALESCE(?, '') AND COALESCE(scene_id, '') = COALESCE(?, '') AND deleted_at IS NULL`
        )
        .get(c.anchor, storyId, sceneId) as Row
    ).p as number) + 1
  db.prepare(
    `INSERT INTO changes (id, entry_id, anchor, story_id, scene_id, kind, payload_json, position, origin, run_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    c.entryId,
    c.anchor,
    storyId,
    sceneId,
    c.kind,
    JSON.stringify(c.payload ?? {}),
    position,
    c.origin,
    c.runId ?? null,
    t,
    t
  )
  const change = getChange(db, id)
  recordVersion(db, { factKind: 'change', factId: id, entryId: change.entryId, data: change, origin: c.origin, runId: c.runId })
  return change
}

/**
 * Replaces a change's anchor, kind and payload. `origin` says who: Adam editing a text-origin change
 * makes it his ('adam'); the memory keeper passes 'text' or 'ai' with its run.
 */
export function replaceChange(db: DB, id: ID, c: ChangeInput & { origin: Origin; runId?: ID | null }): Change {
  const old = getChange(db, id)
  const { storyId, sceneId } = anchorFor(db, c)
  db.prepare(
    `UPDATE changes SET entry_id = ?, anchor = ?, story_id = ?, scene_id = ?, kind = ?, payload_json = ?, run_id = ?, origin = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    c.entryId,
    c.anchor,
    storyId,
    sceneId,
    c.kind,
    JSON.stringify(c.payload ?? {}),
    c.runId !== undefined ? c.runId : old.runId,
    c.origin,
    now(),
    id
  )
  const change = getChange(db, id)
  recordVersion(db, { factKind: 'change', factId: id, entryId: change.entryId, data: change, origin: c.origin, runId: c.runId })
  return change
}

/** Removes a change (it stays restorable). `by` says who removed it, for the memory history. */
export function deleteChange(db: DB, id: ID, by: { origin: Origin; runId?: ID | null } = { origin: 'adam' }): void {
  const r = db.prepare('SELECT entry_id FROM changes WHERE id = ? AND deleted_at IS NULL').get(id) as Row | undefined
  if (!r) return
  db.prepare('UPDATE changes SET deleted_at = ? WHERE id = ?').run(now(), id)
  recordVersion(db, { factKind: 'change', factId: id, entryId: r.entry_id as string, data: null, origin: by.origin, runId: by.runId })
}

export function restoreChange(db: DB, id: ID, by: { origin: Origin; runId?: ID | null } = { origin: 'adam' }): void {
  const r = db.prepare('SELECT id FROM changes WHERE id = ?').get(id) as Row | undefined
  if (!r) throw new UserError('That change could not be found to restore.')
  db.prepare('UPDATE changes SET deleted_at = NULL WHERE id = ?').run(id)
  const change = getChange(db, id)
  recordVersion(db, { factKind: 'change', factId: id, entryId: change.entryId, data: change, origin: by.origin, runId: by.runId })
}

/** Every live change, in a stable order (the line decides which count where). */
export function listAllChanges(db: DB): Change[] {
  return (db.prepare('SELECT * FROM changes WHERE deleted_at IS NULL ORDER BY position, created_at, rowid').all() as Row[]).map(toChange)
}

/** An entry's changes, and changes on other entries that point at it (relationships from the other side). */
export function changesForEntry(db: DB, entryId: ID): Change[] {
  return (
    db
      .prepare(
        `SELECT * FROM changes WHERE deleted_at IS NULL
         AND (entry_id = ? OR (kind IN ('relationship', 'full') AND payload_json LIKE ?))
         ORDER BY position, created_at, rowid`
      )
      .all(entryId, `%${entryId}%`) as Row[]
  )
    .map(toChange)
    .filter(
      (c) =>
        c.entryId === entryId ||
        (c.kind === 'relationship' && c.payload.otherId === entryId) ||
        (c.kind === 'full' && c.payload.relationships.some((r) => r.otherId === entryId))
    )
}

export function changesInScene(db: DB, sceneId: ID): Change[] {
  return (
    db.prepare('SELECT * FROM changes WHERE scene_id = ? AND deleted_at IS NULL ORDER BY position, created_at, rowid').all(sceneId) as Row[]
  ).map(toChange)
}

/** Every fact any character knows (or knew), once each, for picking the same fact again. */
export function listFacts(db: DB): { factId: ID; fact: string }[] {
  const out = new Map<ID, string>()
  for (const c of db
    .prepare("SELECT kind, payload_json FROM changes WHERE deleted_at IS NULL AND kind IN ('knowledge', 'full')")
    .all() as Row[]) {
    if (c.kind === 'knowledge') {
      const p = json<{ factId?: ID; fact?: string }>(c.payload_json, {})
      if (p.factId && p.fact) out.set(p.factId, p.fact)
    } else {
      for (const k of json<{ knows?: { factId: ID; fact: string }[] }>(c.payload_json, {}).knows ?? [])
        if (k.factId && k.fact) out.set(k.factId, k.fact)
    }
  }
  return [...out].map(([factId, fact]) => ({ factId, fact })).sort((a, b) => a.fact.localeCompare(b.fact))
}

// ---------- Where entries first exist ----------

const toExists = (r: Row): ExistsPoint => ({
  id: r.id as string,
  entryId: r.entry_id as string,
  kind: r.kind as ExistsKind,
  storyId: (r.story_id as string) ?? null,
  sceneId: (r.scene_id as string) ?? null,
  byHand: !!r.by_hand
})

export function listExistsPoints(db: DB, entryId?: ID): ExistsPoint[] {
  const rows = entryId
    ? db.prepare('SELECT * FROM exists_points WHERE entry_id = ? ORDER BY created_at, rowid').all(entryId)
    : db.prepare('SELECT * FROM exists_points ORDER BY created_at, rowid').all()
  return (rows as Row[]).map(toExists)
}

export function addExistsPoint(db: DB, p: Omit<ExistsPoint, 'id'>): ExistsPoint {
  const id = newId()
  db.prepare('INSERT INTO exists_points (id, entry_id, kind, story_id, scene_id, by_hand, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    id,
    p.entryId,
    p.kind,
    p.storyId,
    p.sceneId,
    p.byHand ? 1 : 0,
    now()
  )
  return toExists(db.prepare('SELECT * FROM exists_points WHERE id = ?').get(id) as Row)
}

/** Replaces an entry's default points (Adam's own are kept). */
export function setDefaultExistsPoints(db: DB, entryId: ID, points: Omit<ExistsPoint, 'id' | 'entryId' | 'byHand'>[]): void {
  db.transaction(() => {
    db.prepare('DELETE FROM exists_points WHERE entry_id = ? AND by_hand = 0').run(entryId)
    for (const p of points) addExistsPoint(db, { ...p, entryId, byHand: false })
  })()
}

/** The world's first story (by creation order): entries made by hand in it exist from the beginning of the world. */
export function firstStoryId(db: DB): ID | null {
  const r = db.prepare('SELECT id FROM stories WHERE deleted_at IS NULL ORDER BY created_order, created_at LIMIT 1').get() as
    | Row
    | undefined
  return r ? (r.id as string) : null
}

/**
 * Where an entry first exists by default (spec, Multi-story rules: "Where entries first exist").
 * The memory core may refine this; it is used when an entry is made.
 */
export function defaultExistsPoint(
  db: DB,
  e: Pick<Entry, 'kind' | 'origin' | 'originStoryId' | 'originSceneId' | 'originStart'>
): Omit<ExistsPoint, 'id' | 'entryId' | 'byHand'> {
  const world = { kind: 'world' as const, storyId: null, sceneId: null }
  if (e.originStart && e.originStoryId) return { kind: 'story-post', storyId: e.originStoryId, sceneId: null }
  if (e.origin === 'text') {
    if ((e.kind === 'character' || e.kind === 'item' || e.kind === 'event') && e.originSceneId) {
      return {
        kind: 'scene',
        storyId: e.originStoryId ?? sceneStory(db, e.originSceneId),
        sceneId: e.originSceneId
      }
    }
    const storyId = e.originStoryId ?? (e.originSceneId ? sceneStory(db, e.originSceneId) : null)
    return storyId && storyId !== firstStoryId(db) ? { kind: 'story-pre', storyId, sceneId: null } : world
  }
  if (!e.originStoryId || e.originStoryId === firstStoryId(db)) return world
  return { kind: 'story-pre', storyId: e.originStoryId, sceneId: null }
}

// ---------- Summaries ----------

const toSummary = (r: Row): Summary => ({
  level: r.level as SummaryLevel,
  targetId: r.target_id as string,
  text: r.text as string,
  origin: r.origin as Origin,
  stale: !!r.stale,
  updatedAt: r.updated_at as string
})

export function getSummary(db: DB, level: SummaryLevel, targetId: ID): Summary | null {
  const r = db.prepare('SELECT * FROM summaries WHERE level = ? AND target_id = ?').get(level, targetId) as Row | undefined
  return r ? toSummary(r) : null
}

export function listSummaries(db: DB): Summary[] {
  return (db.prepare('SELECT * FROM summaries').all() as Row[]).map(toSummary)
}

/**
 * Writes a summary and its memory-history version. `origin` 'adam' marks Adam's own words (never
 * replaced automatically); `sourceHash` records what an automatic one was made from.
 */
export function putSummary(
  db: DB,
  s: {
    level: SummaryLevel
    targetId: ID
    text: string
    origin: Origin
    sourceHash?: string
    generationId?: ID | null
    runId?: ID | null
  }
): Summary {
  db.prepare(
    `INSERT INTO summaries (level, target_id, text, origin, stale, source_hash, generation_id, updated_at)
     VALUES (?, ?, ?, ?, 0, ?, ?, ?)
     ON CONFLICT(level, target_id) DO UPDATE SET text = excluded.text, origin = excluded.origin, stale = 0,
       source_hash = excluded.source_hash, generation_id = excluded.generation_id, updated_at = excluded.updated_at`
  ).run(s.level, s.targetId, s.text, s.origin, s.sourceHash ?? '', s.generationId ?? null, now())
  const summary = getSummary(db, s.level, s.targetId)!
  recordVersion(db, { factKind: 'summary', factId: `${s.level}:${s.targetId}`, entryId: null, data: summary, origin: s.origin, runId: s.runId })
  return summary
}

export function markSummaryStale(db: DB, level: SummaryLevel, targetId: ID): void {
  db.prepare('UPDATE summaries SET stale = 1 WHERE level = ? AND target_id = ?').run(level, targetId)
}

/** A story's scene and chapter summaries and its own. */
export function storySummaries(db: DB, storyId: ID): Summary[] {
  return (
    db
      .prepare(
        `SELECT su.* FROM summaries su WHERE
           (su.level = 'story' AND su.target_id = ?)
           OR (su.level = 'chapter' AND su.target_id IN (SELECT id FROM chapters WHERE story_id = ? AND deleted_at IS NULL))
           OR (su.level = 'scene' AND su.target_id IN (
                SELECT s.id FROM scenes s JOIN chapters c ON c.id = s.chapter_id
                WHERE c.story_id = ? AND s.deleted_at IS NULL AND c.deleted_at IS NULL))`
      )
      .all(storyId, storyId, storyId) as Row[]
  ).map(toSummary)
}

// ---------- Pins and block modes ----------

const toPin = (r: Row): Pin => ({
  id: r.id as string,
  scope: r.scope as PinScope,
  scopeId: (r.scope_id as string) || null,
  entryId: r.entry_id as string,
  action: r.action as Pin['action']
})

export function setPin(db: DB, entryId: ID, scope: PinScope, scopeId: ID | null, action: Pin['action'] | null): void {
  const sid = scope === 'world' ? '' : (scopeId ?? '')
  if (scope !== 'world' && !sid) throw new UserError('Pick the scene or story to pin this to.')
  if (action === null) {
    db.prepare('DELETE FROM pins WHERE scope = ? AND scope_id = ? AND entry_id = ?').run(scope, sid, entryId)
    return
  }
  db.prepare(
    `INSERT INTO pins (id, scope, scope_id, entry_id, action, created_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(scope, scope_id, entry_id) DO UPDATE SET action = excluded.action`
  ).run(newId(), scope, sid, entryId, action, now())
}

/** The pins that apply to a scene: its own, its story's and the world's. */
export function pinsForScene(db: DB, sceneId: ID): Pin[] {
  const storyId = sceneStory(db, sceneId) ?? ''
  return (
    db
      .prepare(
        `SELECT p.* FROM pins p JOIN entries e ON e.id = p.entry_id AND e.deleted_at IS NULL
         WHERE (p.scope = 'scene' AND p.scope_id = ?) OR (p.scope = 'story' AND p.scope_id = ?) OR p.scope = 'world'
         ORDER BY p.created_at, p.rowid`
      )
      .all(sceneId, storyId) as Row[]
  ).map(toPin)
}

interface SceneContextPrefs {
  blockModes?: Record<string, BlockMode>
}

export function getBlockModes(db: DB, sceneId: ID): Record<string, BlockMode> {
  const r = db.prepare('SELECT context_json FROM scenes WHERE id = ?').get(sceneId) as Row | undefined
  return json<SceneContextPrefs>(r?.context_json, {}).blockModes ?? {}
}

export function setBlockMode(db: DB, sceneId: ID, blockId: string, mode: BlockMode): void {
  const r = db.prepare('SELECT context_json FROM scenes WHERE id = ? AND deleted_at IS NULL').get(sceneId) as Row | undefined
  if (!r) throw new UserError('That scene no longer exists.')
  const prefs = json<SceneContextPrefs>(r.context_json, {})
  const modes = { ...(prefs.blockModes ?? {}) }
  if (mode === 'auto') delete modes[blockId]
  else modes[blockId] = mode
  db.prepare('UPDATE scenes SET context_json = ? WHERE id = ?').run(JSON.stringify({ ...prefs, blockModes: modes }), sceneId)
}

// ---------- Adam's answers ----------

const toAnswer = (r: Row): Answer => ({
  id: r.id as string,
  kind: r.kind as AnswerKind,
  key: r.key as string,
  value: json<unknown>(r.value_json, null)
})

export function listAnswers(db: DB): Answer[] {
  return (db.prepare('SELECT * FROM answers ORDER BY created_at, rowid').all() as Row[]).map(toAnswer)
}

export function setAnswer(db: DB, kind: AnswerKind, key: string, value: unknown): void {
  const t = now()
  db.prepare(
    `INSERT INTO answers (id, kind, key, value_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(kind, key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
  ).run(newId(), kind, key, JSON.stringify(value), t, t)
}

export function clearAnswer(db: DB, kind: AnswerKind, key: string): void {
  db.prepare('DELETE FROM answers WHERE kind = ? AND key = ?').run(kind, key)
}
