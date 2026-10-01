import type Database from 'better-sqlite3'

// Each migration runs once, in order, inside a transaction. PRAGMA user_version
// records how many have run. Never edit a migration that has shipped: add a new one.
// A backup is taken before migrations run on an existing world (see world.ts).

export const MIGRATIONS: string[] = [
  // 1: milestone 1 schema
  `
  CREATE TABLE meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE series (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    themes TEXT NOT NULL DEFAULT '',
    tone TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE stories (
    id TEXT PRIMARY KEY,
    series_id TEXT REFERENCES series(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    premise TEXT NOT NULL DEFAULT '',
    themes TEXT NOT NULL DEFAULT '',
    tone TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT 'continues',
    start_story_id TEXT,
    position INTEGER NOT NULL DEFAULT 0,
    created_order INTEGER NOT NULL DEFAULT 0,
    style_json TEXT NOT NULL DEFAULT '{}',
    deleted_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE chapters (
    id TEXT PRIMARY KEY,
    story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT '',
    goal TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL DEFAULT 0,
    deleted_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX chapters_story ON chapters(story_id, position);

  CREATE TABLE scenes (
    id TEXT PRIMARY KEY,
    chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'planned',
    card_json TEXT NOT NULL DEFAULT '{}',
    doc_json TEXT,
    text TEXT NOT NULL DEFAULT '',
    word_count INTEGER NOT NULL DEFAULT 0,
    deleted_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX scenes_chapter ON scenes(chapter_id, position);

  CREATE TABLE entries (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    aliases_json TEXT NOT NULL DEFAULT '[]',
    summary TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    tags_json TEXT NOT NULL DEFAULT '[]',
    notes TEXT NOT NULL DEFAULT '',
    fields_json TEXT NOT NULL DEFAULT '{}',
    parent_id TEXT,
    hard_rule INTEGER NOT NULL DEFAULT 0,
    image TEXT,
    deleted_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX entries_kind ON entries(kind, name);

  CREATE TABLE generations (
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
  CREATE INDEX generations_scene ON generations(scene_id, created_at);

  -- Which memory entries (and which version of each) a generation was given.
  CREATE TABLE generation_entries (
    generation_id TEXT NOT NULL REFERENCES generations(id) ON DELETE CASCADE,
    entry_id TEXT NOT NULL,
    entry_version TEXT NOT NULL,
    PRIMARY KEY (generation_id, entry_id)
  );
  `
]

export function migrate(db: Database.Database): { from: number; to: number } {
  const from = db.pragma('user_version', { simple: true }) as number
  for (let v = from; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v])
      db.pragma(`user_version = ${v + 1}`)
    })()
  }
  return { from, to: MIGRATIONS.length }
}

export const pendingMigrations = (db: Database.Database): number =>
  MIGRATIONS.length - (db.pragma('user_version', { simple: true }) as number)
