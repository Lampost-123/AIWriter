// The search index (search-index.db) never travels with a world: exports, copies and imports leave it out, and it is
// made again wherever the world is opened.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { unzipSync } from 'fflate'
import { migrate } from '../db/migrations'
import * as repo from '../db/repo'
import { copyWorld, exportWorld, stagedName } from '../transfer/worldFile'
import { INDEX_FILE, openSearchIndex } from './store'
import { scenePassages } from './text'

let root = ''
let library = ''
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'aiwrite-index-files-'))
  library = join(root, 'library')
  mkdirSync(library)
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

function makeWorld(): string {
  const folder = join(library, 'Harbour')
  mkdirSync(folder)
  const db = new Database(join(folder, 'world.db'))
  migrate(db)
  repo.initWorld(db, 'world-harbour', 'Harbour')
  db.close()
  const { index } = openSearchIndex(folder)
  index.putScene('s1', 'h', scenePassages('Made-up words for the index.'))
  index.close()
  return folder
}

describe('the search index and world files', () => {
  it('is left out of an exported world file and a copy', async () => {
    const folder = makeWorld()
    expect(existsSync(join(folder, INDEX_FILE))).toBe(true)
    const out = join(root, 'Harbour.aiwrite')
    await exportWorld({ source: { folder, db: null }, out, appVersion: '0.6.29' })
    expect(Object.keys(unzipSync(readFileSync(out)))).not.toContain(INDEX_FILE)
    const copy = await copyWorld({ source: { folder, db: null }, library, name: 'Harbour (copy)' })
    expect(readdirSync(copy.folder)).not.toContain(INDEX_FILE)
  })

  it('is never taken from a world file', () => {
    expect(stagedName(INDEX_FILE)).toBeNull()
  })
})
