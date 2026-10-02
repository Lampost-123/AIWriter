// All SQL for Ask the world (milestone 4). Its chats are its 'chat' generation records grouped by
// params.chatId, so they need no table of their own (the data model stays frozen). Pure functions
// over a better-sqlite3 handle, no Electron imports.

import type Database from 'better-sqlite3'
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
  createdAt: r.created_at as string
})

const TURN_COLUMNS = `id, ${CHAT_ID} AS chat_id, status, error, direction, response, cost, prompt_tokens, created_at,
  CASE WHEN json_valid(params_json) THEN json_extract(params_json, '$.cutOff') END AS cut_off`

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

/** Puts back whether an entry counts as touched by hand (undoing a note is as if it had never been saved). */
export function setByHand(db: DB, entryId: ID, byHand: boolean): void {
  db.prepare('UPDATE entries SET by_hand = ? WHERE id = ?').run(byHand ? 1 : 0, entryId)
}
