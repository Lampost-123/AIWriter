// All SQL for generation records: every AI call is saved with exactly what was
// sent, the settings, tokens, cost, the response, and which memory entries
// (and which version of each) it was given. Tables come from migration 1.
// Pure functions over a better-sqlite3 handle, no Electron imports.

import type Database from 'better-sqlite3'
import type {
  ChatMessage,
  ContextBlock,
  ContextBudget,
  EntryKind,
  GenerationJob,
  GenerationRecord,
  GenerationStatus,
  GenerationSummary,
  ID
} from '@shared/types'
import { countWords } from '@shared/defaults'
import { UserError } from '../util'
import { touchWorld } from './repo'

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

export interface NewGeneration {
  id: ID
  sceneId: ID
  /** 'draft' for scene drafts; 'memory' and 'summary' for the memory keeper's calls (scene_id is then the scene, or the chapter, story or series a summary is for). */
  job: GenerationJob
  providerId: ID
  providerName: string
  modelId: string
  params: GenerationRecord['params']
  direction: string
  blocks: ContextBlock[]
  messages: ChatMessage[]
  budget: ContextBudget
  /** Each entry sent, with its updatedAt as the version. */
  entries: { entryId: ID; version: string }[]
  createdAt: string
}

export function insertGeneration(db: DB, g: NewGeneration): void {
  db.transaction(() => {
    db.prepare(
      `INSERT INTO generations (id, scene_id, job, status, error, provider_id, provider_name, model_id, params_json, direction,
        blocks_json, messages_json, budget_json, response, created_at)
       VALUES (?, ?, ?, 'streaming', NULL, ?, ?, ?, ?, ?, ?, ?, ?, '', ?)`
    ).run(
      g.id,
      g.sceneId,
      g.job,
      g.providerId,
      g.providerName,
      g.modelId,
      JSON.stringify(g.params),
      g.direction,
      JSON.stringify(g.blocks),
      JSON.stringify(g.messages),
      JSON.stringify(g.budget),
      g.createdAt
    )
    const add = db.prepare('INSERT OR IGNORE INTO generation_entries (generation_id, entry_id, entry_version) VALUES (?, ?, ?)')
    for (const e of g.entries) add.run(g.id, e.entryId, e.version)
    touchWorld(db)
  })()
}

/** Saves the text received so far (called every half second while streaming). */
export function saveResponse(db: DB, id: ID, response: string): void {
  db.prepare("UPDATE generations SET response = ? WHERE id = ? AND status = 'streaming'").run(response, id)
}

export interface Finish {
  status: Exclude<GenerationStatus, 'streaming'>
  error: string | null
  response: string
  promptTokens: number | null
  completionTokens: number | null
  cost: number | null
  finishedAt: string
  /** The settings actually used, when they changed while the request was made (a smaller reply limit). */
  params?: GenerationRecord['params']
}

export function finishGeneration(db: DB, id: ID, f: Finish): void {
  db.prepare(
    `UPDATE generations SET status = ?, error = ?, response = ?, prompt_tokens = ?, completion_tokens = ?, cost = ?, finished_at = ?,
       params_json = COALESCE(?, params_json)
     WHERE id = ?`
  ).run(f.status, f.error, f.response, f.promptTokens, f.completionTokens, f.cost, f.finishedAt, f.params ? JSON.stringify(f.params) : null, id)
  // Backups watch the world's last-changed time, so a finished draft gets backed up.
  touchWorld(db)
}

/** After a crash or a forced quit: drafts left 'streaming' become 'stopped', keeping their text. */
export function stopInterrupted(db: DB, at: string): number {
  return db.prepare("UPDATE generations SET status = 'stopped', finished_at = COALESCE(finished_at, ?) WHERE status = 'streaming'").run(at).changes
}

const toSummary = (r: Row): GenerationSummary => ({
  id: r.id as string,
  sceneId: r.scene_id as string,
  job: ((r.job as GenerationJob | undefined) ?? 'draft') as GenerationJob,
  status: r.status as GenerationStatus,
  modelId: r.model_id as string,
  providerName: r.provider_name as string,
  words: countWords((r.response as string) ?? ''),
  cost: (r.cost as number | null) ?? null,
  costEstimated: r.cost != null && r.prompt_tokens == null,
  createdAt: r.created_at as string
})

/** This scene's drafts, newest first (the memory keeper's calls are left out). */
export function listGenerations(db: DB, sceneId: ID): GenerationSummary[] {
  const rows = db
    .prepare(
      `SELECT id, scene_id, job, status, model_id, provider_name, response, cost, prompt_tokens, created_at
       FROM generations WHERE scene_id = ? AND job = 'draft' ORDER BY created_at DESC, rowid DESC`
    )
    .all(sceneId) as Row[]
  return rows.map(toSummary)
}

export function getGeneration(db: DB, id: ID): GenerationRecord {
  const r = db.prepare('SELECT * FROM generations WHERE id = ?').get(id) as Row | undefined
  if (!r) throw new UserError("This draft's record could not be found. It may belong to another world.")
  const blocks = json<ContextBlock[]>(r.blocks_json, [])
  // Entries are listed even if deleted since, so the record still says who was in the briefing.
  const rows = db
    .prepare(
      `SELECT ge.entry_id, ge.entry_version, e.name, e.kind, e.deleted_at, e.updated_at
       FROM generation_entries ge LEFT JOIN entries e ON e.id = ge.entry_id
       WHERE ge.generation_id = ?`
    )
    .all(id) as Row[]
  const order = new Map<ID, number>()
  blocks.forEach((b) => b.entryIds.forEach((eid) => order.has(eid) || order.set(eid, order.size)))
  const entries: GenerationRecord['entries'] = rows
    .map((e) => ({
      entryId: e.entry_id as string,
      name: (e.name as string | null) ?? 'Deleted entry',
      kind: ((e.kind as EntryKind | null) ?? 'lore') as EntryKind,
      version: e.entry_version as string,
      deleted: e.name == null || e.deleted_at != null,
      changedSince: e.updated_at != null && e.updated_at !== e.entry_version
    }))
    .sort((a, b) => (order.get(a.entryId) ?? 1e9) - (order.get(b.entryId) ?? 1e9))
  return {
    ...toSummary(r),
    error: (r.error as string | null) ?? null,
    providerId: r.provider_id as string,
    params: json<GenerationRecord['params']>(r.params_json, { temperature: 0, top_p: 1, max_tokens: 0 }),
    direction: (r.direction as string) ?? '',
    blocks,
    messages: json<ChatMessage[]>(r.messages_json, []),
    response: (r.response as string) ?? '',
    budget: json<ContextBudget>(r.budget_json, { contextLength: 0, reserved: 0, available: 0, used: 0 }),
    promptTokens: (r.prompt_tokens as number | null) ?? null,
    completionTokens: (r.completion_tokens as number | null) ?? null,
    entries,
    finishedAt: (r.finished_at as string | null) ?? null
  }
}
