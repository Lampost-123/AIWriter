// What the Recipe maker's calls cost, kept with the recipe library (Recipes/spending.db), never in a world: a
// recipe belongs to no world, and the story it is made from must never reach one. Every AI call goes through the
// task runner, which records it as a generation (so the monthly limit can hold it before anything is sent, and its
// tokens and cost are known); here those records live in a small database of their own with the same table, and
// as soon as a call ends its words (what was sent, and the reply) are wiped from its record, leaving the job, the
// model, the tokens and the cost. The usage page and the monthly limit add this file's spending to the worlds'
// (usage/index.ts), as "Story recipes". No Electron imports.

import Database from 'better-sqlite3'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'

type DB = Database.Database

export const SPENDING_FILE = 'spending.db'

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS generations (
    id TEXT PRIMARY KEY,
    scene_id TEXT NOT NULL,
    job TEXT NOT NULL,
    status TEXT NOT NULL,
    error TEXT,
    provider_id TEXT NOT NULL,
    provider_name TEXT NOT NULL,
    model_id TEXT NOT NULL,
    params_json TEXT NOT NULL,
    direction TEXT NOT NULL DEFAULT '',
    blocks_json TEXT NOT NULL,
    messages_json TEXT NOT NULL,
    budget_json TEXT NOT NULL,
    response TEXT NOT NULL DEFAULT '',
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    cost REAL,
    created_at TEXT NOT NULL,
    finished_at TEXT
  );
  CREATE TABLE IF NOT EXISTS generation_entries (
    generation_id TEXT NOT NULL REFERENCES generations(id) ON DELETE CASCADE,
    entry_id TEXT NOT NULL,
    entry_version TEXT NOT NULL,
    PRIMARY KEY (generation_id, entry_id)
  );
`

/** Opens (or makes) the recipe library's spending file; calls left half-written are finished and wiped. */
export function openSpending(dir: string): DB {
  mkdirSync(dir, { recursive: true })
  const db = new Database(join(dir, SPENDING_FILE))
  db.pragma('journal_mode = WAL')
  db.pragma('busy_timeout = 3000')
  db.exec(SCHEMA)
  db.prepare("INSERT INTO meta (key, value) VALUES ('name', 'Story recipes') ON CONFLICT(key) DO NOTHING").run()
  db.prepare("UPDATE generations SET status = 'stopped', finished_at = COALESCE(finished_at, created_at) WHERE status = 'streaming'").run()
  wipeWords(db)
  return db
}

/**
 * Takes the words out of every finished record: what was sent, the reply, and the error text (which can quote
 * the reply). A reply that came is marked "…" so the call still counts when the provider sent no tokens or cost.
 */
export function wipeWords(db: DB, id?: string): void {
  db.prepare(
    `UPDATE generations SET messages_json = '[]', blocks_json = '[]', direction = '',
       response = CASE WHEN response <> '' THEN '…' ELSE '' END, error = CASE WHEN error IS NULL THEN NULL ELSE '' END
     WHERE status <> 'streaming' AND (messages_json <> '[]' OR response NOT IN ('', '…'))${id ? ' AND id = ?' : ''}`
  ).run(...(id ? [id] : []))
}
