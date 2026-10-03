import Database from 'better-sqlite3'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strToU8, unzipSync, zipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { migrate } from '../db/migrations'
import * as repo from '../db/repo'
import { openHistory } from '../history/open'
import { HistoryStore } from '../history/store'
import { UserError } from '../util'
import { checkManifest, copyWorld, exportWorld, importWorld, isNewerVersion, removeStaleStaging, stagedName, WORLD_FILE_FORMAT } from './worldFile'

let root: string
let library: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'aiwrite-transfer-'))
  library = join(root, 'library')
  mkdirSync(library)
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const TEXT = 'The rain had not stopped since dawn.'

/** A world folder like the app makes: world.db (WAL, as the app keeps it), history.db with one snapshot, a picture. */
function makeWorld(name = 'Northern Reaches', withHistory = true): { folder: string; id: string; sceneId: string } {
  const folder = join(library, name)
  mkdirSync(join(folder, 'images', 'maps'), { recursive: true })
  mkdirSync(join(folder, 'backups'))
  writeFileSync(join(folder, 'backups', 'old.db'), 'a backup')
  writeFileSync(join(folder, 'images', 'maps', 'reach.png'), Buffer.from([1, 2, 3, 4]))
  const db = new Database(join(folder, 'world.db'))
  db.pragma('journal_mode = WAL')
  migrate(db)
  const id = `world-${name}`
  repo.initWorld(db, id, name)
  const [story] = repo.listStories(db)
  const sceneId = repo.getOutline(db, story.id).scenes[0].id
  repo.saveSceneText(db, sceneId, null, TEXT)
  repo.setMeta(db, 'read_aloud', JSON.stringify({ voices: { x: 'deep' } }))
  db.close()
  if (withHistory) {
    const h = openHistory(folder, Date.now())
    if (!h.ok) throw new Error('history did not open')
    new HistoryStore(h.db).take({ sceneId, kind: 'done', label: 'Marked done', doc: null, text: TEXT })
    h.db.close()
  }
  return { folder, id, sceneId }
}

const metaOf = (folder: string, key: string): string | null => {
  const d = new Database(join(folder, 'world.db'), { readonly: true })
  try {
    return repo.getMeta(d, key)
  } finally {
    d.close()
  }
}

const snapshotsIn = (folder: string): string[] => {
  const d = new Database(join(folder, 'history.db'), { readonly: true })
  try {
    return (d.prepare('SELECT text FROM snapshots').all() as { text: string }[]).map((r) => r.text)
  } finally {
    d.close()
  }
}

const sceneText = (folder: string, sceneId: string): string => {
  const d = new Database(join(folder, 'world.db'), { readonly: true })
  try {
    return repo.getScene(d, sceneId).text
  } finally {
    d.close()
  }
}

async function refused(p: Promise<unknown>): Promise<UserError> {
  try {
    await p
  } catch (e) {
    expect(e).toBeInstanceOf(UserError)
    return e as UserError
  }
  throw new Error('expected a refusal')
}

describe('the .aiwrite file', () => {
  it('exports a world with its history and images (never its backups), and imports it as a new world', async () => {
    const w = makeWorld()
    const out = join(root, 'Northern Reaches.aiwrite')
    const steps: string[] = []
    const exp = await exportWorld({ source: { folder: w.folder, db: null }, out, appVersion: '0.6.0', progress: (s) => steps.push(s) })
    expect(exp).toEqual({ history: 'carried', worldName: 'Northern Reaches' })
    expect(steps).toContain('Packing the file')
    expect(existsSync(`${out}.partial`)).toBe(false)

    const files = unzipSync(readFileSync(out))
    expect(Object.keys(files)).toEqual(['manifest.json', 'world.db', 'history.db', 'images/maps/reach.png'])
    const manifest = JSON.parse(Buffer.from(files['manifest.json']).toString('utf8'))
    expect(manifest).toMatchObject({ format: WORLD_FILE_FORMAT, formatVersion: 1, appVersion: '0.6.0', worldName: 'Northern Reaches', history: true })

    // Imported into another library (another computer): a new folder, a new id, the same scenes and history.
    const other = join(root, 'other')
    const made = await importWorld({ file: out, library: other, appVersion: '0.6.0', takenNames: [] })
    expect(made.name).toBe('Northern Reaches')
    expect(made.id).not.toBe(w.id)
    expect(made.history).toBe(true)
    expect(made.folder).toBe(join(other, 'Northern Reaches'))
    expect(metaOf(made.folder, 'id')).toBe(made.id)
    expect(metaOf(made.folder, 'read_aloud')).toContain('deep')
    expect(sceneText(made.folder, w.sceneId)).toBe(TEXT)
    expect(snapshotsIn(made.folder)).toEqual([TEXT])
    expect(readFileSync(join(made.folder, 'images', 'maps', 'reach.png'))).toEqual(Buffer.from([1, 2, 3, 4]))
    expect(readdirSync(join(made.folder, 'backups'))).toEqual([])
    // Nothing is left half-made in the library.
    expect(readdirSync(other)).toEqual(['Northern Reaches'])
  })

  it('exports the open world from its own connection, with what was written a moment ago', async () => {
    const w = makeWorld()
    const db = new Database(join(w.folder, 'world.db'))
    db.pragma('journal_mode = WAL')
    repo.saveSceneText(db, w.sceneId, null, 'Written just now.')
    const out = join(root, 'open.aiwrite')
    await exportWorld({ source: { folder: w.folder, db }, out, appVersion: '0.6.0' })
    db.close()
    const made = await importWorld({ file: out, library, appVersion: '0.6.0', takenNames: ['Northern Reaches'] })
    // Imported beside the original: a name of its own, so the two can be told apart.
    expect(made.name).toBe('Northern Reaches (imported)')
    expect(made.folder).toBe(join(library, 'Northern Reaches imported'))
    expect(sceneText(made.folder, w.sceneId)).toBe('Written just now.')
    expect(metaOf(w.folder, 'id')).toBe(w.id)
  })

  it('leaves out a damaged history.db, and still exports and imports the world', async () => {
    const w = makeWorld('Damaged', false)
    writeFileSync(join(w.folder, 'history.db'), 'this is not a database at all')
    const out = join(root, 'damaged.aiwrite')
    const exp = await exportWorld({ source: { folder: w.folder, db: null }, out, appVersion: '0.6.0' })
    expect(exp.history).toBe('left-out')
    expect(Object.keys(unzipSync(readFileSync(out)))).not.toContain('history.db')
    const made = await importWorld({ file: out, library: join(root, 'other'), appVersion: '0.6.0', takenNames: [] })
    expect(made.history).toBe(false)
    expect(existsSync(join(made.folder, 'history.db'))).toBe(false)
    expect(sceneText(made.folder, w.sceneId)).toBe(TEXT)
  })

  it('imports a file whose history.db is damaged, without it', async () => {
    const w = makeWorld()
    const out = join(root, 'good.aiwrite')
    await exportWorld({ source: { folder: w.folder, db: null }, out, appVersion: '0.6.0' })
    const files = unzipSync(readFileSync(out))
    files['history.db'] = strToU8('garbage, not SQLite')
    const bad = join(root, 'bad-history.aiwrite')
    writeFileSync(bad, zipSync(files))
    const made = await importWorld({ file: bad, library: join(root, 'other'), appVersion: '0.6.0', takenNames: [] })
    expect(made.history).toBe(false)
    expect(existsSync(join(made.folder, 'history.db'))).toBe(false)
    expect(sceneText(made.folder, w.sceneId)).toBe(TEXT)
  })

  it('refuses a file from a newer AI Write, another kind of file and a damaged one, leaving nothing behind', async () => {
    const w = makeWorld()
    const out = join(root, 'w.aiwrite')
    await exportWorld({ source: { folder: w.folder, db: null }, out, appVersion: '0.9.0' })
    const other = join(root, 'other')

    const newer = await refused(importWorld({ file: out, library: other, appVersion: '0.6.0', takenNames: [] }))
    expect(newer.code).toBe('newer-world-file')
    expect(newer.message).toMatch(/newer AI Write \(0\.9\.0\)\. Update AI Write/)

    const files = unzipSync(readFileSync(out))
    const manifest = JSON.parse(Buffer.from(files['manifest.json']).toString('utf8'))
    files['manifest.json'] = strToU8(JSON.stringify({ ...manifest, appVersion: '0.6.0', formatVersion: 2 }))
    const nextFormat = join(root, 'next.aiwrite')
    writeFileSync(nextFormat, zipSync(files))
    expect((await refused(importWorld({ file: nextFormat, library: other, appVersion: '0.6.0', takenNames: [] }))).code).toBe('newer-world-file')

    const notOurs = join(root, 'notes.aiwrite')
    writeFileSync(notOurs, 'Just some notes, not a zip.')
    expect((await refused(importWorld({ file: notOurs, library: other, appVersion: '0.6.0', takenNames: [] }))).message).toMatch(
      /isn't an AI Write world file/
    )

    const someZip = join(root, 'some.aiwrite')
    writeFileSync(someZip, zipSync({ 'readme.txt': strToU8('hello') }))
    expect((await refused(importWorld({ file: someZip, library: other, appVersion: '0.6.0', takenNames: [] }))).code).toBe('not-a-world-file')

    // Cut short partway through world.db.
    files['manifest.json'] = strToU8(JSON.stringify(manifest))
    const whole = readFileSync(out)
    const cut = join(root, 'cut.aiwrite')
    writeFileSync(cut, whole.subarray(0, Math.floor(whole.length / 2)))
    expect((await refused(importWorld({ file: cut, library: other, appVersion: '0.9.0', takenNames: [] }))).code).toBe('damaged-world-file')

    expect(readdirSync(other)).toEqual([])
  })

  it('takes only its own files from a zip, never a path outside the world folder', () => {
    expect(stagedName('world.db')).toBe('world.db')
    expect(stagedName('images/a/b.png')).toBe('images/a/b.png')
    expect(stagedName('images/../../evil.exe')).toBeNull()
    expect(stagedName('images/..\\evil.exe')).toBeNull()
    expect(stagedName('images/C:/evil')).toBeNull()
    expect(stagedName('backups/old.db')).toBeNull()
    expect(stagedName('../world.db')).toBeNull()
    // Names Windows would change or read as a device.
    expect(stagedName('images/CON')).toBeNull()
    expect(stagedName('images/nul.png')).toBeNull()
    expect(stagedName('images/com1/a.png')).toBeNull()
    expect(stagedName('images/a./b.png')).toBeNull()
    expect(stagedName('images/a.png ')).toBeNull()
    expect(stagedName('images/console.png')).toBe('images/console.png')
  })

  it('clears away an import the app stopped in the middle of, but never one that is already a whole world', () => {
    mkdirSync(join(library, '.aiwrite-import-half'))
    writeFileSync(join(library, '.aiwrite-import-half', 'world.db.incoming'), 'x')
    mkdirSync(join(library, '.aiwrite-copy-whole'))
    writeFileSync(join(library, '.aiwrite-copy-whole', 'world.db'), 'x')
    removeStaleStaging(library, Date.now() + 2 * 60 * 60 * 1000)
    expect(readdirSync(library)).toEqual(['.aiwrite-copy-whole'])
  })

  it('reads versions and manifests', () => {
    expect(isNewerVersion('0.10.0', '0.9.9')).toBe(true)
    expect(isNewerVersion('0.6.0', '0.6.0')).toBe(false)
    expect(isNewerVersion('0.5.9', '0.6.0')).toBe(false)
    expect(() => checkManifest(strToU8('{"format":"something-else"}'), '0.6.0')).toThrow(UserError)
    expect(checkManifest(strToU8(JSON.stringify({ format: WORLD_FILE_FORMAT, formatVersion: 1, appVersion: '0.5.0' })), '0.6.0').appVersion).toBe('0.5.0')
  })
})

describe('Make a copy', () => {
  it('copies a world with its history and images, as a world of its own named "(copy)"', async () => {
    const w = makeWorld()
    const made = await copyWorld({ source: { folder: w.folder, db: null }, library, name: 'Northern Reaches (copy)' })
    expect(made.folder).toBe(join(library, 'Northern Reaches copy'))
    expect(made.history).toBe('carried')
    expect(metaOf(made.folder, 'id')).toBe(made.id)
    expect(made.id).not.toBe(w.id)
    expect(metaOf(made.folder, 'name')).toBe('Northern Reaches (copy)')
    expect(sceneText(made.folder, w.sceneId)).toBe(TEXT)
    expect(snapshotsIn(made.folder)).toEqual([TEXT])
    expect(existsSync(join(made.folder, 'images', 'maps', 'reach.png'))).toBe(true)
    // Its own empty backups folder; the original is untouched.
    expect(readdirSync(join(made.folder, 'backups'))).toEqual([])
    expect(metaOf(w.folder, 'id')).toBe(w.id)
    expect(metaOf(w.folder, 'name')).toBe('Northern Reaches')
    // A second copy gets a folder of its own.
    const again = await copyWorld({ source: { folder: w.folder, db: null }, library, name: 'Northern Reaches (copy)' })
    expect(again.folder).toBe(join(library, 'Northern Reaches copy 2'))
    expect(readdirSync(library).sort()).toEqual(['Northern Reaches', 'Northern Reaches copy', 'Northern Reaches copy 2'])
  })

  it('copies a world whose history.db is damaged, without it', async () => {
    const w = makeWorld('Worn', false)
    writeFileSync(join(w.folder, 'history.db'), 'not a database')
    const made = await copyWorld({ source: { folder: w.folder, db: null }, library, name: 'Worn (copy)' })
    expect(made.history).toBe('left-out')
    expect(existsSync(join(made.folder, 'history.db'))).toBe(false)
    expect(sceneText(made.folder, w.sceneId)).toBe(TEXT)
  })

  it('refuses a world whose world.db is damaged in plain words, leaving nothing behind', async () => {
    const w = makeWorld('Broken', false)
    const file = join(w.folder, 'world.db')
    const bytes = readFileSync(file)
    // Its header stays, its pages are scribbled over.
    bytes.fill(0x5a, 100)
    writeFileSync(file, bytes)
    const e = await refused(copyWorld({ source: { folder: w.folder, db: null }, library, name: 'Broken (copy)' }))
    expect(e.code).toBe('damaged-world')
    expect(readdirSync(library)).toEqual(['Broken'])
  })
})
