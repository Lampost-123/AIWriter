// The SQL for milestone 4's Variants: reading a set of variants back from the generation records. A
// variant is a 'draft' record whose params_json holds `variant` ({ setId, index, of }), so no table or
// column of its own is needed (the data model is frozen). Pure functions over a better-sqlite3 handle,
// no Electron imports.

import type Database from 'better-sqlite3'
import type { Creativity, GenerationRecord, GenerationStatus, ID } from '@shared/types'

type DB = Database.Database
type Row = Record<string, unknown>

/** One variant's record, as the Variants part reads it. */
export interface VariantRow {
  id: ID
  sceneId: ID
  status: GenerationStatus
  error: string | null
  response: string
  cost: number | null
  promptTokens: number | null
  modelId: string
  direction: string
  createdAt: string
  setId: ID
  index: number
  of: number
  cutOff: boolean
  targetWords: number | null
  creativity: Creativity | null
}

/** The set a record belongs to (null for a record that isn't a variant, or whose params can't be read). */
const SET_SQL = "CASE WHEN json_valid(params_json) THEN json_extract(params_json, '$.variant.setId') END"

const params = (s: unknown): GenerationRecord['params'] | null => {
  if (typeof s !== 'string' || !s) return null
  try {
    return JSON.parse(s) as GenerationRecord['params']
  } catch {
    return null
  }
}

function toRow(r: Row): VariantRow | null {
  const p = params(r.params_json)
  const v = p?.variant
  if (!p || !v || typeof v.setId !== 'string' || !Number.isFinite(v.index)) return null
  return {
    id: r.id as string,
    sceneId: r.scene_id as string,
    status: r.status as GenerationStatus,
    error: (r.error as string | null) ?? null,
    response: (r.response as string) ?? '',
    cost: (r.cost as number | null) ?? null,
    promptTokens: (r.prompt_tokens as number | null) ?? null,
    modelId: r.model_id as string,
    direction: (r.direction as string) ?? '',
    createdAt: r.created_at as string,
    setId: v.setId,
    index: v.index,
    of: Number.isFinite(v.of) ? v.of : 0,
    cutOff: p.cutOff === true,
    targetWords: typeof p.targetWords === 'number' ? p.targetWords : null,
    creativity: p.creativity ?? null
  }
}

const COLUMNS = 'id, scene_id, status, error, response, cost, prompt_tokens, model_id, direction, created_at, params_json'

/** Every variant of one of the scene's sets, variant 1 first. */
export function variantRows(db: DB, sceneId: ID, setId: ID): VariantRow[] {
  const rows = db
    .prepare(`SELECT ${COLUMNS} FROM generations WHERE scene_id = ? AND job = 'draft' AND ${SET_SQL} = ? ORDER BY created_at, rowid`)
    .all(sceneId, setId) as Row[]
  return rows
    .map(toRow)
    .filter((r): r is VariantRow => !!r)
    .sort((a, b) => a.index - b.index)
}

/** The scene's latest set of variants (the set of its newest variant record), variant 1 first; empty when it has none. */
export function latestVariantRows(db: DB, sceneId: ID): VariantRow[] {
  const latest = db
    .prepare(
      `SELECT ${SET_SQL} AS set_id FROM generations
       WHERE scene_id = ? AND job = 'draft' AND ${SET_SQL} IS NOT NULL
       ORDER BY created_at DESC, rowid DESC LIMIT 1`
    )
    .get(sceneId) as Row | undefined
  return typeof latest?.set_id === 'string' ? variantRows(db, sceneId, latest.set_id) : []
}
