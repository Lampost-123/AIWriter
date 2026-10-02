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
  `,
  // 2: milestone 2, memory over time. The data model is frozen after this one (spec: Guiding
  // principles); later changes need a written reason in docs/ARCHITECTURE.md and a new migration.
  `
  -- Where each story starts and (side stories) ends, and what a prequel leads into.
  -- Milestone 1 stories continue after their start story (or start at the beginning of the world).
  ALTER TABLE stories ADD COLUMN start_at TEXT NOT NULL DEFAULT 'end';
  ALTER TABLE stories ADD COLUMN start_ref_id TEXT;
  ALTER TABLE stories ADD COLUMN end_at TEXT;
  ALTER TABLE stories ADD COLUMN end_ref_id TEXT;
  ALTER TABLE stories ADD COLUMN leads_into_id TEXT;
  ALTER TABLE stories ADD COLUMN leads_in INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE stories ADD COLUMN time_gap TEXT NOT NULL DEFAULT '';

  CREATE TABLE acts (
    id TEXT PRIMARY KEY,
    story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT '',
    purpose TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL DEFAULT 0,
    deleted_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  ALTER TABLE chapters ADD COLUMN act_id TEXT;

  -- Accepting a scene, and the text it was accepted with (so a re-accept only re-reads what changed).
  -- context_json holds Adam's per-scene briefing choices (block modes) from the Context tab.
  ALTER TABLE scenes ADD COLUMN accepted_at TEXT;
  ALTER TABLE scenes ADD COLUMN accepted_text TEXT;
  ALTER TABLE scenes ADD COLUMN context_json TEXT NOT NULL DEFAULT '{}';

  -- How each entry was made. by_hand: Adam has edited it, so the memory keeper never overwrites it.
  ALTER TABLE entries ADD COLUMN origin TEXT NOT NULL DEFAULT 'hand';
  ALTER TABLE entries ADD COLUMN origin_story_id TEXT;
  ALTER TABLE entries ADD COLUMN origin_scene_id TEXT;
  ALTER TABLE entries ADD COLUMN by_hand INTEGER NOT NULL DEFAULT 0;
  -- Milestone 1 entries were all typed by Adam.
  UPDATE entries SET by_hand = 1;

  -- Where each entry first exists (one or more points). kind: world | story-pre | story-post | scene.
  CREATE TABLE exists_points (
    id TEXT PRIMARY KEY,
    entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    story_id TEXT,
    scene_id TEXT,
    by_hand INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE INDEX exists_points_entry ON exists_points(entry_id);
  -- Milestone 1 entries were made outside any story's memory: the starting setup.
  INSERT INTO exists_points (id, entry_id, kind, by_hand, created_at)
    SELECT lower(hex(randomblob(16))), id, 'world', 0, created_at FROM entries;

  -- Every change to an entry over time: baseline relationships and knowledge, start-of-story
  -- changes (including full descriptions) and changes pinned to scenes.
  --   anchor: baseline | story-start | scene     kind: update | full | relationship | knowledge | thread
  --   source: hand | memory    quote: the words in the scene a memory change rests on
  CREATE TABLE changes (
    id TEXT PRIMARY KEY,
    entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    anchor TEXT NOT NULL,
    story_id TEXT,
    scene_id TEXT,
    kind TEXT NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}',
    position INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT 'hand',
    quote TEXT NOT NULL DEFAULT '',
    run_id TEXT,
    deleted_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX changes_entry ON changes(entry_id);
  CREATE INDEX changes_scene ON changes(scene_id);
  CREATE INDEX changes_story ON changes(story_id, anchor);

  -- Summaries at every level: scene, chapter, story, series.
  CREATE TABLE summaries (
    level TEXT NOT NULL,
    target_id TEXT NOT NULL,
    text TEXT NOT NULL DEFAULT '',
    by_hand INTEGER NOT NULL DEFAULT 0,
    stale INTEGER NOT NULL DEFAULT 0,
    source_hash TEXT NOT NULL DEFAULT '',
    generation_id TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (level, target_id)
  );

  -- Entries pinned to (or kept out of) briefings for a scene, a story or the world (scope_id '' for the world).
  CREATE TABLE pins (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL,
    scope_id TEXT NOT NULL DEFAULT '',
    entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (scope, scope_id, entry_id)
  );

  -- Adam's answers to multi-story questions (side story order, "Which happened last?", end of prequel).
  CREATE TABLE answers (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    key TEXT NOT NULL,
    value_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (kind, key)
  );

  -- Consistency checker results (milestone 5), stored now with their out-of-date mark.
  CREATE TABLE issues (
    id TEXT PRIMARY KEY,
    scene_id TEXT,
    story_id TEXT,
    kind TEXT NOT NULL,
    severity TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    quote TEXT NOT NULL DEFAULT '',
    message TEXT NOT NULL DEFAULT '',
    payload_json TEXT NOT NULL DEFAULT '{}',
    out_of_date INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX issues_scene ON issues(scene_id);

  -- ---------- The memory keeper (src/main/keeper) ----------
  -- What it last read of each scene, so it reads only what changed and resumes after a restart.
  --   read_text: the scene text it last read    summary_source: the text the scene summary was written from
  --   error: why the last attempt failed, in plain words (cleared when a read works)
  CREATE TABLE keeper_scenes (
    scene_id TEXT PRIMARY KEY,
    read_text TEXT NOT NULL DEFAULT '',
    read_at TEXT,
    summary_source TEXT,
    error TEXT,
    updated_at TEXT NOT NULL
  );

  -- Facts the keeper found that aren't rows in changes: entries it made, entries from elsewhere in
  -- the world it found here (exists point), and voice sample lines it added. Each rests on its quote.
  --   kind: entry | exists | voice    ref_id: the exists point (exists)    line: the sample line (voice)
  CREATE TABLE keeper_facts (
    id TEXT PRIMARY KEY,
    scene_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    entry_id TEXT NOT NULL,
    ref_id TEXT,
    line TEXT NOT NULL DEFAULT '',
    quote TEXT NOT NULL DEFAULT '',
    run_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX keeper_facts_scene ON keeper_facts(scene_id);
  CREATE INDEX keeper_facts_entry ON keeper_facts(entry_id);

  -- The quiet "What changed" list: everything the keeper did, and what an undo puts back.
  --   action: added | updated | removed    what: entry | change | summary
  --   detail: entry | exists | voice | change | summary    before_json: the fact as it was (for undo)
  --   bundle_json: changes made along with an entry (a plot thread's opening, an event's people)
  --   guess_json: the guess, so an undone one is never made again for the same words
  CREATE TABLE keeper_log (
    id TEXT PRIMARY KEY,
    run_id TEXT,
    scene_id TEXT,
    action TEXT NOT NULL,
    what TEXT NOT NULL,
    detail TEXT NOT NULL,
    entry_id TEXT,
    change_id TEXT,
    fact_id TEXT,
    summary_level TEXT,
    summary_target TEXT,
    text TEXT NOT NULL,
    quote TEXT NOT NULL DEFAULT '',
    before_json TEXT,
    bundle_json TEXT NOT NULL DEFAULT '[]',
    guess_json TEXT,
    undone_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX keeper_log_time ON keeper_log(created_at);
  CREATE INDEX keeper_log_scene ON keeper_log(scene_id, created_at);
  CREATE INDEX keeper_log_entry ON keeper_log(entry_id, created_at);

  -- Guesses Adam undid: never made again for the same words in that scene.
  CREATE TABLE keeper_rejected (
    id TEXT PRIMARY KEY,
    scene_id TEXT,
    guess_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX keeper_rejected_scene ON keeper_rejected(scene_id);
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
