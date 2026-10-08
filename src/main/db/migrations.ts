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

  -- Marking a scene done (accepted_at), and the text it was marked done with.
  -- context_json holds Adam's per-scene briefing choices (block modes) from the Context tab.
  -- text_version goes up on every save; the memory keeper records the version it last read
  -- (memory_version), the paragraphs it read then (id, hash and text, to find what changed), and
  -- its run status for the scene: current | pending | failed ("Memory not updated").
  ALTER TABLE scenes ADD COLUMN accepted_at TEXT;
  ALTER TABLE scenes ADD COLUMN accepted_text TEXT;
  ALTER TABLE scenes ADD COLUMN context_json TEXT NOT NULL DEFAULT '{}';
  ALTER TABLE scenes ADD COLUMN text_version INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE scenes ADD COLUMN memory_version INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE scenes ADD COLUMN memory_paragraphs_json TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE scenes ADD COLUMN memory_status TEXT NOT NULL DEFAULT 'current';
  ALTER TABLE scenes ADD COLUMN memory_error TEXT;
  -- Milestone 1 scenes with text haven't been read by the memory keeper yet.
  UPDATE scenes SET text_version = 1, memory_status = 'pending' WHERE text <> '';

  -- Who made each entry and each of its fields: adam | text (read from a scene) | ai (drafted by the AI).
  -- origin_start: made by a start-of-story change. by_hand: Adam has edited some of it, so the
  -- memory keeper never removes it.
  ALTER TABLE entries ADD COLUMN origin TEXT NOT NULL DEFAULT 'adam';
  ALTER TABLE entries ADD COLUMN field_origins_json TEXT NOT NULL DEFAULT '{}';
  ALTER TABLE entries ADD COLUMN origin_story_id TEXT;
  ALTER TABLE entries ADD COLUMN origin_scene_id TEXT;
  ALTER TABLE entries ADD COLUMN origin_start INTEGER NOT NULL DEFAULT 0;
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
  --   origin: adam | text | ai (text-origin changes have source_links to their words)
  CREATE TABLE changes (
    id TEXT PRIMARY KEY,
    entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    anchor TEXT NOT NULL,
    story_id TEXT,
    scene_id TEXT,
    kind TEXT NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}',
    position INTEGER NOT NULL DEFAULT 0,
    origin TEXT NOT NULL DEFAULT 'adam',
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
    origin TEXT NOT NULL DEFAULT 'text',
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

  -- ----- Source links and automatic upkeep (spec, Multi-story rules) -----

  -- Links from facts to the words they were read from. fact_kind: entry | field | change | summary | voice.
  -- state: ok | changed (the words were edited) | gone (deleted).
  CREATE TABLE source_links (
    id TEXT PRIMARY KEY,
    fact_kind TEXT NOT NULL,
    fact_id TEXT NOT NULL,
    field TEXT,
    scene_id TEXT NOT NULL,
    scene_version INTEGER NOT NULL,
    paragraph_id TEXT,
    start INTEGER NOT NULL DEFAULT 0,
    end INTEGER NOT NULL DEFAULT 0,
    quote TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'ok',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX source_links_fact ON source_links(fact_kind, fact_id);
  CREATE INDEX source_links_scene ON source_links(scene_id);

  -- Memory history: every version of every fact (entry rows, changes, summaries), automatic or by hand.
  CREATE TABLE fact_versions (
    id TEXT PRIMARY KEY,
    fact_kind TEXT NOT NULL,
    fact_id TEXT NOT NULL,
    entry_id TEXT,
    version INTEGER NOT NULL,
    data_json TEXT,
    origin TEXT NOT NULL,
    run_id TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (fact_kind, fact_id, version)
  );
  CREATE INDEX fact_versions_entry ON fact_versions(entry_id, created_at);

  -- Facts Adam undid: not added again from the same words unless the words change.
  CREATE TABLE suppressions (
    id TEXT PRIMARY KEY,
    fingerprint TEXT NOT NULL,
    scene_id TEXT NOT NULL,
    quote TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (fingerprint, scene_id, quote)
  );

  -- Memory keeper runs: one per scene version read (model, tokens and cost alongside the generation records).
  CREATE TABLE memory_runs (
    id TEXT PRIMARY KEY,
    scene_id TEXT NOT NULL,
    scene_version INTEGER NOT NULL,
    status TEXT NOT NULL,
    error TEXT,
    provider_id TEXT,
    model_id TEXT,
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    cost REAL,
    generation_ids_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    finished_at TEXT
  );
  CREATE INDEX memory_runs_scene ON memory_runs(scene_id, created_at);

  -- The "What changed" list, grouped by run. question_json: a judgement call made with a default.
  CREATE TABLE memory_log (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    scene_id TEXT,
    action TEXT NOT NULL,
    what TEXT NOT NULL,
    entry_id TEXT,
    fact_id TEXT,
    entry_name TEXT NOT NULL DEFAULT '',
    text TEXT NOT NULL DEFAULT '',
    before TEXT NOT NULL DEFAULT '',
    after TEXT NOT NULL DEFAULT '',
    quote TEXT NOT NULL DEFAULT '',
    question_json TEXT,
    undo_json TEXT,
    undone_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX memory_log_run ON memory_log(run_id);
  CREATE INDEX memory_log_created ON memory_log(created_at);
  CREATE INDEX memory_log_scene ON memory_log(scene_id, created_at);
  CREATE INDEX memory_log_entry ON memory_log(entry_id, created_at);
  `,
  // 3: World Memory Overhaul, part A (2026-10-08; the reason is in docs/ARCHITECTURE.md, "Facts follow their words").
  // A link whose words were edited ('changed') remembers when that happened and how many reads since have left its
  // fact unconfirmed, so a text fact the memory model says nothing about goes after one more read.
  `
  ALTER TABLE source_links ADD COLUMN changed_at TEXT;
  ALTER TABLE source_links ADD COLUMN checks INTEGER NOT NULL DEFAULT 0;
  UPDATE source_links SET changed_at = updated_at WHERE state = 'changed';
  `,
  // 4: World Memory Overhaul, part B1 (2026-10-08; the reason is in docs/ARCHITECTURE.md, "Facts with a start and an
  // end"). A change can stop being true at a later scene ("lost her knife" ends where she finds it again), with the
  // story's words for when, who ended it, and the words that say so (so the end follows them). Columns only: every
  // existing change keeps holding, as before.
  `
  ALTER TABLE changes ADD COLUMN until_scene_id TEXT;
  ALTER TABLE changes ADD COLUMN until_when TEXT NOT NULL DEFAULT '';
  ALTER TABLE changes ADD COLUMN until_origin TEXT;
  ALTER TABLE changes ADD COLUMN until_quote TEXT NOT NULL DEFAULT '';
  ALTER TABLE changes ADD COLUMN until_paragraph_id TEXT;
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
