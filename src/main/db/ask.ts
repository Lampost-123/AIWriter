// All SQL for Ask the world (milestone 4). Its chats are its 'chat' generation records grouped by
// params.chatId, so they need no table of their own (the data model stays frozen). Pure functions
// over a better-sqlite3 handle, no Electron imports.

import type Database from 'better-sqlite3'
import type { Proposal, SavedNote } from '@shared/contracts/ask'
import type { ID } from '@shared/types'

type DB = Database.Database
type Row = Record<string, unknown>

/** The chat id of a record, read without parsing the whole of params_json. */
const CHAT_ID = "CASE WHEN json_valid(params_json) THEN json_extract(params_json, '$.chatId') END"

export interface ChatRow {
  chatId: ID
  turns: number
  /** Its first question. */
  first: string
  updatedAt: string
}

/** The chats whose id starts with `prefix`, the most recently asked in first. */
export function listChatRows(db: DB, prefix: string, limit = 30): ChatRow[] {
  const rows = db
    .prepare(
      `SELECT chat_id, COUNT(*) AS turns, MAX(created_at) AS updated_at, MIN(first) AS first FROM (
         SELECT ${CHAT_ID} AS chat_id, created_at,
           FIRST_VALUE(direction) OVER (PARTITION BY ${CHAT_ID} ORDER BY created_at, rowid) AS first
         FROM generations WHERE job = 'chat'
       )
       WHERE chat_id IS NOT NULL AND substr(chat_id, 1, ?) = ?
       GROUP BY chat_id ORDER BY updated_at DESC, chat_id LIMIT ?`
    )
    .all(prefix.length, prefix, limit) as Row[]
  return rows.map((r) => ({
    chatId: r.chat_id as string,
    turns: Number(r.turns) || 0,
    first: (r.first as string | null) ?? '',
    updatedAt: r.updated_at as string
  }))
}

export interface TurnRow {
  id: ID
  chatId: ID
  status: 'streaming' | 'complete' | 'stopped' | 'error'
  error: string | null
  question: string
  answer: string
  cost: number | null
  costEstimated: boolean
  cutOff: boolean
  createdAt: string
  /** The editor chat's steps (their labels) and proposals, as kept in the record's params. */
  steps: string[]
  proposals: Proposal[]
  /** The note saved from this answer (so it shows "Saved" after a restart too); null when none is. */
  savedNote: SavedNote | null
}

const jsonObject = <T>(v: unknown): T | null => {
  if (typeof v !== 'string' || !v) return null
  try {
    const parsed = JSON.parse(v) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as T) : null
  } catch {
    return null
  }
}

const jsonList = <T>(v: unknown): T[] => {
  if (typeof v !== 'string' || !v) return []
  try {
    const parsed = JSON.parse(v) as unknown
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    return []
  }
}

const toTurn = (r: Row): TurnRow => ({
  id: r.id as string,
  chatId: r.chat_id as string,
  status: r.status as TurnRow['status'],
  error: (r.error as string | null) ?? null,
  question: (r.direction as string) ?? '',
  answer: (r.response as string) ?? '',
  cost: (r.cost as number | null) ?? null,
  costEstimated: r.cost != null && r.prompt_tokens == null,
  cutOff: r.cut_off === 1 || r.cut_off === true,
  createdAt: r.created_at as string,
  steps: jsonList<{ label?: string }>(r.steps).map((s) => s.label ?? '').filter(Boolean),
  proposals: jsonList<Proposal>(r.proposals),
  savedNote: jsonObject<SavedNote>(r.saved_note)
})

const TURN_COLUMNS = `id, ${CHAT_ID} AS chat_id, status, error, direction, response, cost, prompt_tokens, created_at,
  CASE WHEN json_valid(params_json) THEN json_extract(params_json, '$.cutOff') END AS cut_off,
  CASE WHEN json_valid(params_json) THEN json_extract(params_json, '$.steps') END AS steps,
  CASE WHEN json_valid(params_json) THEN json_extract(params_json, '$.proposals') END AS proposals,
  CASE WHEN json_valid(params_json) THEN json_extract(params_json, '$.savedNote') END AS saved_note`

/** A chat's turns, oldest first. */
export function chatTurnRows(db: DB, chatId: ID): TurnRow[] {
  const rows = db
    .prepare(`SELECT ${TURN_COLUMNS} FROM generations WHERE job = 'chat' AND ${CHAT_ID} = ? ORDER BY created_at, rowid`)
    .all(chatId) as Row[]
  return rows.map(toTurn)
}

/** One turn, by its record's id; null when it isn't a turn of a chat. */
export function chatTurnRow(db: DB, generationId: ID): TurnRow | null {
  const r = db.prepare(`SELECT ${TURN_COLUMNS} FROM generations WHERE id = ? AND job = 'chat'`).get(generationId) as Row | undefined
  return r && r.chat_id ? toTurn(r) : null
}

/** The editor chat: keeps a turn's proposals with its record (while it is answered, and as Adam decides on each). */
export function saveProposals(db: DB, generationId: ID, proposals: Proposal[]): void {
  db.prepare("UPDATE generations SET params_json = json_set(params_json, '$.proposals', json(?)) WHERE id = ? AND json_valid(params_json)").run(
    JSON.stringify(proposals),
    generationId
  )
}

/**
 * Keeps (or, with null, forgets) the note saved from a turn's answer with its record, so the answer still shows
 * "Saved" after a restart and the same note isn't saved twice. A record that isn't a chat turn is left alone.
 */
export function setSavedNote(db: DB, generationId: ID, note: SavedNote | null): void {
  if (note) {
    db.prepare(
      "UPDATE generations SET params_json = json_set(params_json, '$.savedNote', json(?)) WHERE id = ? AND job = 'chat' AND json_valid(params_json)"
    ).run(JSON.stringify(note), generationId)
  } else {
    db.prepare("UPDATE generations SET params_json = json_remove(params_json, '$.savedNote') WHERE id = ? AND job = 'chat' AND json_valid(params_json)").run(
      generationId
    )
  }
}

/** The editor chat: a turn's proposals as kept. */
export function proposalsOf(db: DB, generationId: ID): Proposal[] {
  const r = db
    .prepare("SELECT CASE WHEN json_valid(params_json) THEN json_extract(params_json, '$.proposals') END AS proposals FROM generations WHERE id = ?")
    .get(generationId) as Row | undefined
  return jsonList<Proposal>(r?.proposals)
}

/** Puts back whether an entry counts as touched by hand (undoing a note is as if it had never been saved). */
export function setByHand(db: DB, entryId: ID, byHand: boolean): void {
  db.prepare('UPDATE entries SET by_hand = ? WHERE id = ?').run(byHand ? 1 : 0, entryId)
}
