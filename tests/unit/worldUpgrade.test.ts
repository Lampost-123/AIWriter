// Worlds made by the released app (0.8.1, e3bb8dc1) open in this version with nothing lost (Adam, 2026-10-19: "existing
// stories must be converted to the new system"). Each fixture (tests/fixtures/worlds, README there) is copied into a
// throwaway library and opened the way the app opens a world (world.ts: the safety copy, then the migrations), and then:
// - the safety copy was written before anything changed, and holds the world exactly as it was;
// - the database is at this version's layout;
// - every table the world had keeps exactly the same columns and rows (each row compared whole, by a hash of every
//   column; no column is left out: opening a world in world.ts changes nothing in it but the layout);
// - scenes' words and word counts, entries, the world's meta (the continuity store, story briefs, preference overrides)
//   read the same through the app's own functions;
// - the story index is built for every story, answers look-ups, and building it changes nothing else.
// Invented stories only: the sample world and the trap harness's story.

import Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() }, BrowserWindow: { getAllWindows: () => [] }, dialog: {} }))

const FIXTURES = join(__dirname, '..', 'fixtures', 'worlds')
/** The layout the released app wrote (its migration count). */
const RELEASED_LAYOUT = 4
/** The tables this version adds, built from the rest of the world (migration 5). */
const NEW_TABLES = ['index_scenes', 'index_facts', 'index_threads']

const dir = mkdtempSync(join(tmpdir(), 'aiwrite-upgrade-'))
const lib = join(dir, 'library')
let world: typeof import('../../src/main/world')
let repo: typeof import('../../src/main/db/repo')
let brief: typeof import('../../src/main/storyBuilder/brief')
let migrations: typeof import('../../src/main/db/migrations')
let storyIndex: typeof import('../../src/main/storyIndex')
let backupFiles: typeof import('../../src/main/services/backupFiles')

beforeAll(async () => {
  process.env.AIWRITE_DATA_DIR = dir
  delete process.env.AIWRITE_START
  world = await import('../../src/main/world')
  repo = await import('../../src/main/db/repo')
  brief = await import('../../src/main/storyBuilder/brief')
  migrations = await import('../../src/main/db/migrations')
  storyIndex = await import('../../src/main/storyIndex')
  backupFiles = await import('../../src/main/services/backupFiles')
})

afterAll(() => {
  world.closeWorld()
  delete process.env.AIWRITE_DATA_DIR
  rmSync(dir, { recursive: true, force: true })
})

type Row = Record<string, unknown>
interface TableShot {
  columns: string[]
  rows: number
  /** A hash of every row, all its columns, sorted. */
  hashes: string[]
}
interface Shot {
  version: number
  tables: Record<string, TableShot>
  scenes: Map<string, { text: string; words: number }>
  meta: Map<string, string>
}

const cell = (v: unknown): unknown => (Buffer.isBuffer(v) ? `blob:${v.toString('base64')}` : v)

/** Everything in a world database: each table's columns and rows, and its scenes' words and meta, read directly. */
function shoot(d: Database.Database): Shot {
  const names = (d.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Row[]).map(
    (r) => r.name as string
  )
  const tables: Record<string, TableShot> = {}
  for (const t of names) {
    const columns = (d.prepare(`PRAGMA table_info("${t}")`).all() as Row[]).map((c) => c.name as string)
    const all = d.prepare(`SELECT * FROM "${t}"`).all() as Row[]
    const hashes = all
      .map((r) => createHash('sha1').update(JSON.stringify(columns.map((c) => [c, cell(r[c])]))).digest('hex'))
      .sort()
    tables[t] = { columns, rows: all.length, hashes }
  }
  const scenes = new Map(
    (d.prepare('SELECT id, text, word_count FROM scenes').all() as Row[]).map((r) => [r.id as string, { text: r.text as string, words: r.word_count as number }])
  )
  const meta = new Map((d.prepare('SELECT key, value FROM meta').all() as Row[]).map((r) => [r.key as string, r.value as string]))
  return { version: d.pragma('user_version', { simple: true }) as number, tables, scenes, meta }
}

function shootFile(file: string): Shot {
  const d = new Database(file, { readonly: true, fileMustExist: true })
  try {
    return shoot(d)
  } finally {
    d.close()
  }
}

/** Every table the released world had is still there with the same columns and exactly the same rows. */
function expectSameTables(before: Shot, after: Shot): { tables: number; rows: number } {
  let rows = 0
  for (const [t, was] of Object.entries(before.tables)) {
    const now = after.tables[t]
    expect(now, `table ${t} is still there`).toBeDefined()
    expect(now.columns, `table ${t} keeps its columns`).toEqual(was.columns)
    expect(now.rows, `table ${t} keeps its row count`).toBe(was.rows)
    expect(now.hashes, `table ${t} keeps every row as it was`).toEqual(was.hashes)
    rows += was.rows
  }
  return { tables: Object.keys(before.tables).length, rows }
}

/** Unpacks a fixture into its own world folder in the library. */
function placeFixture(name: string, folderName: string): string {
  const folder = join(lib, folderName)
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, 'world.db'), gunzipSync(readFileSync(join(FIXTURES, name))))
  return folder
}

const liveStoryScenes = (d: Database.Database, storyId: string): string[] =>
  (
    d
      .prepare(
        `SELECT s.id FROM scenes s JOIN chapters c ON c.id = s.chapter_id
         WHERE c.story_id = ? AND s.deleted_at IS NULL AND c.deleted_at IS NULL ORDER BY c.position, s.position`
      )
      .all(storyId) as Row[]
  ).map((r) => r.id as string)

const report: string[] = []

describe.each([
  { fixture: 'sample-0.8.1.db.gz', folder: 'Sample from 0.8.1', expect: { pins: 3, issues: 1, changes: 12, deletedScenes: 1 } },
  { fixture: 'trap-story-0.8.1.db.gz', folder: 'Trap story from 0.8.1', expect: { scenes: 30, generations: 180, continuity: true } }
])('a world saved by AI Write 0.8.1 ($folder)', ({ fixture, folder: folderName, expect: want }) => {
  let folder: string
  let before: Shot
  let id: string

  beforeAll(() => {
    folder = placeFixture(fixture, folderName)
    // Read as the released app left it, from a copy, so the world itself is untouched until the app opens it.
    const copy = join(dir, `${folderName}.before.db`)
    writeFileSync(copy, readFileSync(join(folder, 'world.db')))
    before = shootFile(copy)
    id = before.meta.get('id')!
  })

  it('is the released layout, with something in every table the fixture is there for', () => {
    expect(before.version).toBe(RELEASED_LAYOUT)
    for (const t of NEW_TABLES) expect(before.tables[t]).toBeUndefined()
    if (want.pins) expect(before.tables.pins.rows).toBe(want.pins)
    if (want.issues) expect(before.tables.issues.rows).toBe(want.issues)
    if (want.changes) expect(before.tables.changes.rows).toBe(want.changes)
    if (want.scenes) expect(before.tables.scenes.rows).toBe(want.scenes)
    if (want.generations) expect(before.tables.generations.rows).toBe(want.generations)
    if (want.continuity) expect(before.meta.get('continuity')?.length).toBeGreaterThan(1000)
  })

  it('opens as the app opens it: a safety copy first, then the new layout, with every row kept', () => {
    expect(world.listWorlds().some((w) => w.id === id)).toBe(true)
    const opened = world.openWorld(id)
    expect(opened.id).toBe(id)
    const d = world.db()

    // The safety copy, made before the layout changed, holds the world exactly as the released app left it.
    const backups = backupFiles.listBackupFiles(join(folder, 'backups'))
    expect(backups.map((b) => b.reason)).toEqual(['before-migration'])
    const copy = shootFile(backups[0].file)
    expect(copy.version).toBe(RELEASED_LAYOUT)
    expectSameTables(before, copy)
    expect(Object.keys(copy.tables).sort()).toEqual(Object.keys(before.tables).sort())

    // This version's layout, with its new tables, empty until the index is built.
    const after = shoot(d)
    expect(after.version).toBe(migrations.MIGRATIONS.length)
    expect(after.version).toBeGreaterThan(RELEASED_LAYOUT)
    for (const t of NEW_TABLES) expect(after.tables[t], `${t} is made`).toBeDefined()
    expect(Object.keys(after.tables).sort()).toEqual([...Object.keys(before.tables), ...NEW_TABLES].sort())

    const kept = expectSameTables(before, after)
    report.push(`${folderName}: ${kept.tables} tables, ${kept.rows} rows compared, all kept`)
  })

  it('reads the same through the app: words, word counts, entries, meta, briefs', () => {
    const d = world.db()
    const now = shoot(d)
    // Every scene's words and count, deleted ones too (Recently deleted).
    expect(now.scenes.size).toBe(before.scenes.size)
    for (const [sid, s] of before.scenes) expect(now.scenes.get(sid), `scene ${sid}`).toEqual(s)
    const live = (d.prepare('SELECT id FROM scenes WHERE deleted_at IS NULL').all() as Row[]).map((r) => r.id as string)
    for (const sid of live) {
      const scene = repo.getScene(d, sid)
      expect(scene.text).toBe(before.scenes.get(sid)!.text)
      expect(scene.wordCount).toBe(before.scenes.get(sid)!.words)
    }
    if (want.deletedScenes) expect(before.scenes.size - live.length).toBe(want.deletedScenes)
    // The world's meta, every key: the continuity store (where things stand), briefs, snapshots, preference overrides.
    expect(new Map([...now.meta])).toEqual(before.meta)
    for (const story of repo.listStories(d)) {
      const raw = before.meta.get(`story_brief:${story.id}`)
      if (raw) expect(brief.readBrief(d, story.id)).toEqual(brief.cleanBrief(JSON.parse(raw)))
    }
    // Entries the app lists are the live rows the world had.
    const liveEntries = (d.prepare('SELECT COUNT(*) AS n FROM entries WHERE deleted_at IS NULL').get() as Row).n
    expect(repo.listEntries(d).length).toBe(liveEntries)
  })

  it('opening it again makes no second safety copy and changes nothing', () => {
    world.closeWorld()
    world.openWorld(id)
    const backups = backupFiles.listBackupFiles(join(folder, 'backups'))
    expect(backups.filter((b) => b.reason === 'before-migration')).toHaveLength(1)
    expectSameTables(before, shoot(world.db()))
  })

  it('builds the story index for every story, which answers look-ups and changes nothing else', () => {
    const d = world.db()
    const stories = repo.listStories(d)
    expect(stories.length).toBeGreaterThan(0)
    let facts = 0
    for (const story of stories) {
      const scenes = liveStoryScenes(d, story.id)
      // Once the index is wired in, opening the world builds it; until then it is built here, as the app will.
      const build = storyIndex.buildStoryIndex(d, story.id)
      expect(build.scenes).toBe(scenes.length)
      const rows = (d.prepare('SELECT COUNT(*) AS n FROM index_scenes WHERE story_id = ?').get(story.id) as Row).n
      expect(rows).toBe(scenes.length)
      facts += (d.prepare('SELECT COUNT(*) AS n FROM index_facts WHERE story_id = ?').get(story.id) as Row).n as number
      if (!scenes.length) continue

      // Who is in each scene; someone is somewhere.
      const present = scenes.map((sid) => storyIndex.presentAt(d, sid))
      expect(present.every((p) => p !== null)).toBe(true)
      const someone = present.flatMap((p) => p!.present)[0]
      expect(someone, 'someone is in a scene').toBeDefined()
      // What is true of them at the story's last scene, by name.
      const last = scenes[scenes.length - 1]
      const state = storyIndex.stateOf(d, story.id, someone.name, last)
      expect(state?.entryId).toBe(someone.id)
      expect(state?.lines.length).toBeGreaterThan(0)
      expect(storyIndex.timeline(d, story.id).scenes).toHaveLength(scenes.length)
      // Built again with nothing changed, nothing is built.
      expect(storyIndex.buildStoryIndex(d, story.id).built).toBe(0)
    }
    expect(facts).toBeGreaterThan(0)
    report.push(`${folderName}: index built for ${stories.length} stories, ${facts} facts`)
    // The index only adds its own rows.
    expectSameTables(before, shoot(d))
  })

  it("the app's own tidy-ups on opening a world (unchanged since 0.8.1) change only what they always did", async () => {
    // What else runs as a world opens (world.onWorldOpened listeners) and can write: drafts left streaming by a crash
    // become stopped (ai/index.ts), the empty starter story goes once the world has another (ipc/stories.ts), and, once
    // per world, wording-only clashes are set aside and `clashRule` is noted in meta (keeper/index.ts). The trash older
    // than 30 days goes too (services/backups.ts), left out here because it depends on today's date.
    const { stopInterrupted } = await import('../../src/main/db/generations')
    const { retireStarterStory } = await import('../../src/main/db/stories')
    const { setAsideWordingClashes } = await import('../../src/main/keeper/wordingClashes')
    const d = world.db()
    expect(stopInterrupted(d, new Date().toISOString())).toBe(0)
    expect(retireStarterStory(d)).toBe(false)
    expect(setAsideWordingClashes(d)).toBe(0)
    const now = shoot(d)
    const { meta, ...rest } = before.tables
    const { meta: metaNow, ...restNow } = now.tables
    expectSameTables({ ...before, tables: rest }, { ...now, tables: restNow })
    // meta: only the once-per-world note, when the released app hadn't written it yet.
    const added = [...now.meta.keys()].filter((k) => !before.meta.has(k))
    expect(added).toEqual(before.meta.has('clashRule') ? [] : ['clashRule'])
    for (const [k, v] of before.meta) expect(now.meta.get(k), `meta ${k}`).toBe(v)
    expect(metaNow.rows).toBe(meta.rows + added.length)
  })
})

afterAll(() => {
  if (process.env.UPGRADE_REPORT) console.info(report.join('\n'))
})
