// What an AI wrote for a scene, for telling Adam's own words from the AI's (style/ownWords.ts). Every AI call is kept in
// the generations table with its reply; the replies that put prose into a scene are these jobs', plus the editor chat's
// proposed rewrites (kept in its records' params as `proposals`). Pure functions over a better-sqlite3 handle.

import type Database from 'better-sqlite3'
import type { ID } from '@shared/types'

type DB = Database.Database

/**
 * The jobs whose reply is prose for the scene they are recorded with: Generate, Variants, Add below and Beat by beat
 * (draft, beat), the AI edits and Continue (edit), the polish pass (polish) and the chapter writer's fixes (chapter).
 * Never the memory's calls or the checks', whose replies quote the scene's own words.
 */
export const PROSE_JOBS = ['draft', 'beat', 'edit', 'polish', 'chapter'] as const

const IN_JOBS = `job IN (${PROSE_JOBS.map((j) => `'${j}'`).join(', ')})`

/**
 * For each of these scenes, a short mark that changes whenever a new AI reply for it is recorded (or one is let go), so a
 * reading of the scene can be kept until then. Scenes with none have no mark.
 */
export function proseMarks(db: DB, sceneIds: readonly ID[]): Map<ID, string> {
  const out = new Map<ID, string>()
  if (!sceneIds.length) return out
  const rows = db
    .prepare(
      `SELECT scene_id, count(*) AS n, max(rowid) AS top FROM generations
       WHERE scene_id IN (SELECT value FROM json_each(?)) AND ${IN_JOBS} GROUP BY scene_id`
    )
    .all(JSON.stringify(sceneIds)) as { scene_id: ID; n: number; top: number }[]
  for (const r of rows) out.set(r.scene_id, `${r.n}:${r.top}`)
  return out
}

/** The replies of PROSE_JOBS records for a scene (finished, stopped part-way or failed with words: what streamed in stayed on the page). */
export function proseTexts(db: DB, sceneId: ID): string[] {
  const rows = db.prepare(`SELECT response FROM generations WHERE scene_id = ? AND ${IN_JOBS} AND response <> ''`).all(sceneId) as { response: unknown }[]
  return rows.flatMap((r) => (typeof r.response === 'string' && r.response.trim() ? [r.response] : []))
}

interface ProposalLike {
  kind?: unknown
  sceneId?: unknown
  replace?: unknown
  status?: unknown
}

/**
 * The words of the editor chat's text proposals that Adam didn't turn down, by the scene they are for, with a mark that
 * changes when another chat turn proposes some (the chat's records have no scene of their own).
 */
export function chatTexts(db: DB): Map<ID, { mark: string; texts: string[] }> {
  const out = new Map<ID, { mark: string; texts: string[] }>()
  const rows = db
    .prepare(
      `SELECT rowid AS at, CASE WHEN json_valid(params_json) THEN json_extract(params_json, '$.proposals') END AS proposals
       FROM generations WHERE job = 'chat' AND instr(params_json, '"proposals"') > 0 ORDER BY rowid`
    )
    .all() as { at: number; proposals: string | null }[]
  for (const r of rows) {
    let list: unknown
    try {
      list = r.proposals ? JSON.parse(r.proposals) : null
    } catch {
      list = null
    }
    if (!Array.isArray(list)) continue
    for (const p of list as ProposalLike[]) {
      if (!p || (p.kind !== 'text' && p.kind !== 'passage') || typeof p.sceneId !== 'string' || p.status === 'declined') continue
      if (typeof p.replace !== 'string' || !p.replace.trim()) continue
      const had = out.get(p.sceneId) ?? { mark: '', texts: [] }
      had.texts.push(p.replace)
      had.mark = `${had.texts.length}:${r.at}`
      out.set(p.sceneId, had)
    }
  }
  return out
}
