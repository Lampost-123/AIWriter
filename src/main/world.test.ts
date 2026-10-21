// The library's world folders as world.ts reads and opens them. A made-up library folder; invented worlds.

import Database from 'better-sqlite3'
import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() }, BrowserWindow: { getAllWindows: () => [] }, dialog: {} }))

const dir = mkdtempSync(join(tmpdir(), 'aiwrite-world-'))
let world: typeof import('./world')
let settings: typeof import('./settings')
let lib = ''

beforeAll(async () => {
  process.env.AIWRITE_DATA_DIR = dir
  delete process.env.AIWRITE_START
  world = await import('./world')
  settings = await import('./settings')
})

beforeEach(() => {
  world.closeWorld()
  lib = mkdtempSync(join(dir, 'library-'))
  settings.updateSettings({ libraryPath: lib })
})

afterAll(() => {
  world.closeWorld()
  delete process.env.AIWRITE_DATA_DIR
  rmSync(dir, { recursive: true, force: true })
})

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Writes straight into a closed world's database. */
function edit(folder: string, fn: (d: Database.Database) => void): void {
  const d = new Database(join(folder, 'world.db'))
  try {
    fn(d)
  } finally {
    d.close()
  }
}

const setSaved = (folder: string, at: string): void =>
  edit(folder, (d) => d.prepare("INSERT INTO meta (key, value) VALUES ('updated_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(at))

describe('two folders holding the same world', () => {
  it('keeps the world in the folder saved last, even when that folder is the newer one', async () => {
    const made = world.createWorld('Harbour')
    world.closeWorld()
    setSaved(made.folder, '2026-01-01T00:00:00.000Z')
    await wait(30)
    // A cloud app downloads the real world again: a newer folder, holding the latest writing.
    const real = join(lib, 'Harbour real')
    cpSync(made.folder, real, { recursive: true })
    setSaved(real, '2026-10-01T00:00:00.000Z')

    const listed = world.listWorlds()
    expect(listed.find((w) => w.folder === real)).toMatchObject({ id: made.id, name: 'Harbour' })
    expect(listed.find((w) => w.folder === made.folder)).toMatchObject({ name: 'Harbour (copy)' })
    expect(listed.find((w) => w.folder === made.folder)?.id).not.toBe(made.id)
  })

  it('keeps the world in the older folder when both were saved at the same time (a copy made by hand)', async () => {
    const made = world.createWorld('Mill')
    world.closeWorld()
    await wait(30)
    const copy = join(lib, 'Mill - Copy')
    cpSync(made.folder, copy, { recursive: true })

    const listed = world.listWorlds()
    expect(listed.find((w) => w.folder === made.folder)).toMatchObject({ id: made.id, name: 'Mill' })
    expect(listed.find((w) => w.folder === copy)).toMatchObject({ name: 'Mill (copy)' })
  })
})

describe('opening a world', () => {
  it('refuses a world saved by a newer AI Write and leaves it as it was', async () => {
    const { MIGRATIONS } = await import('./db/migrations')
    const made = world.createWorld('Lighthouse')
    world.closeWorld()
    edit(made.folder, (d) => d.pragma(`user_version = ${MIGRATIONS.length + 1}`))
    expect(() => world.openWorld(made.id)).toThrow(/newer version of AI Write/)
    expect(world.maybeCurrentWorld()).toBeNull()
    edit(made.folder, (d) => expect(d.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length + 1))
  })
})
