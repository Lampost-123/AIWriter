// The start screen in a real (made-up) library folder: every world with its stories, where Adam left off,
// renaming in open and closed worlds, and deleting a world into Recently deleted, restoring it, emptying it
// and removing it after 30 days. Test words are invented; no real world is read.

import Database from 'better-sqlite3'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() }, BrowserWindow: { getAllWindows: () => [] } }))

const dir = mkdtempSync(join(tmpdir(), 'aiwrite-library-'))
const lib = join(dir, 'library')
const trash = join(lib, 'Recently deleted')
let world: typeof import('../world')
let library: typeof import('./index')
let settings: typeof import('../settings')
let repo: typeof import('../db/repo')
let mem: typeof import('../db/memory')

beforeAll(async () => {
  process.env.AIWRITE_DATA_DIR = dir
  delete process.env.AIWRITE_START
  world = await import('../world')
  library = await import('./index')
  settings = await import('../settings')
  repo = await import('../db/repo')
  mem = await import('../db/memory')
})

afterAll(() => {
  world.closeWorld()
  delete process.env.AIWRITE_DATA_DIR
  rmSync(dir, { recursive: true, force: true })
})

const DAY = 24 * 60 * 60 * 1000

/** Fills the open world: Book 1 (two chapters), a prequel to it and a side story during it, plus things deleted. */
function fillOpenWorld(): { book1: string; prequel: string; side: string; sideScene: string; gone: string } {
  const db = world.db()
  const [book1] = repo.listStories(db)
  const outline = repo.getOutline(db, book1.id)
  repo.saveSceneText(db, outline.scenes[0].id, null, 'The lamp went out over the harbour.') // 7 words
  const ch2 = repo.createChapter(db, book1.id, { title: 'Chapter 2' })
  const s2 = repo.createScene(db, ch2.id, { title: 'The quay' })
  repo.saveSceneText(db, s2.id, null, 'Gulls argued on the roof.') // 5 words
  const s3 = repo.createScene(db, ch2.id, { title: 'Cut' })
  repo.saveSceneText(db, s3.id, null, 'one two three four five six seven eight nine ten')
  repo.deleteScene(db, s3.id) // deleted scenes don't count
  const ch3 = repo.createChapter(db, book1.id, { title: 'Gone chapter' })
  const s4 = repo.createScene(db, ch3.id, { title: 'Gone' })
  repo.saveSceneText(db, s4.id, null, 'one two three')
  repo.deleteChapter(db, ch3.id) // nor scenes in a deleted chapter

  const side = repo.createStory(db, { title: 'Harbour Lights' })
  mem.setStoryPlacement(db, side.id, {
    kind: 'side',
    startStoryId: book1.id,
    startAt: 'end',
    startRefId: null,
    endAt: null,
    endRefId: null,
    leadsIntoId: null
  })
  const sideCh = repo.createChapter(db, side.id, { title: 'Chapter 1' })
  const sideScene = repo.createScene(db, sideCh.id, { title: 'Night ferry' })
  repo.saveSceneText(db, sideScene.id, null, 'Rain on the deck.') // 4 words

  const prequel = repo.createStory(db, { title: 'Before the Lamp' })
  mem.setStoryPlacement(db, prequel.id, {
    kind: 'prequel',
    startStoryId: book1.id,
    startAt: 'pre',
    startRefId: null,
    endAt: null,
    endRefId: null,
    leadsIntoId: book1.id
  })

  const gone = repo.createStory(db, { title: 'Abandoned' })
  repo.deleteStory(db, gone.id)
  return { book1: book1.id, prequel: prequel.id, side: side.id, sideScene: sideScene.id, gone: gone.id }
}

describe('the start screen', () => {
  let alder: string
  let birch: string
  let ids: ReturnType<typeof fillOpenWorld>

  it('shows the start screen once per run of the app', () => {
    expect(library.startScreenAtLaunch()).toBe(true)
    expect(library.startScreenAtLaunch()).toBe(false) // a reload of the window is not a launch
    expect(library.startsAtStartScreen('start', undefined)).toBe(true)
    expect(library.startsAtStartScreen('last', undefined)).toBe(false)
    expect(library.startsAtStartScreen('start', 'off')).toBe(false)
  })

  it('lists every world with its live stories in reading order, their kinds, words and last change', async () => {
    alder = world.createWorld('Alder').id
    ids = fillOpenWorld()
    birch = world.createWorld('Birch').id // closing Alder notes when it was last open
    expect(settings.getSettings().worldsSeenAt[alder]).toBeTruthy()

    const overview = await library.getLibrary()
    expect(overview.reachable).toBe(true)
    expect(overview.deleted).toEqual([])
    const a = overview.worlds.find((w) => w.id === alder)!
    expect(a.name).toBe('Alder')
    expect(a.sample).toBe(false)
    expect(a.stories.map((s) => s.title)).toEqual(['Before the Lamp', 'Book 1', 'Harbour Lights'])
    expect(a.stories.map((s) => s.kind)).toEqual(['Prequel to Book 1', '', 'Side story during Book 1, after its end'])
    expect(a.stories.map((s) => s.words)).toEqual([0, 12, 4])
    expect(a.words).toBe(16)
    for (const s of a.stories) expect(s.editedAt).toMatch(/^\d{4}-\d\d-\d\dT/)
    expect(a.stories.some((s) => s.id === ids.gone)).toBe(false)
    expect(a.openedAt).toBe(settings.getSettings().worldsSeenAt[alder])

    // The open world (Birch) is read through its own connection: a fresh world has Book 1 and no words.
    const b = overview.worlds.find((w) => w.id === birch)!
    expect(b.stories.map((s) => [s.title, s.words])).toEqual([['Book 1', 0]])
  })

  it('orders worlds by when Adam last had them open, newest first', async () => {
    world.closeWorld() // the open world always comes first (checked below)
    settings.updateSettings({ worldsSeenAt: { [alder]: '2026-09-02T10:00:00.000Z', [birch]: '2026-09-01T10:00:00.000Z' } })
    expect((await library.getLibrary()).worlds.map((w) => w.id)).toEqual([alder, birch])
    settings.updateSettings({ worldsSeenAt: { [birch]: '2026-09-03T10:00:00.000Z' } })
    expect((await library.getLibrary()).worlds.map((w) => w.id)).toEqual([birch, alder])
    world.openWorld(birch)
  })

  it('says where Adam left off: the last world, story and scene, with their titles', async () => {
    settings.updateSettings({ lastWorldId: alder, lastStoryId: ids.side, lastSceneId: 'no-such-scene' })
    let last = (await library.getLibrary()).last!
    expect(last).toMatchObject({ worldId: alder, worldName: 'Alder', storyId: ids.side, storyTitle: 'Harbour Lights' })
    // The scene asked for isn't in that story: its first scene.
    expect(last).toMatchObject({ sceneId: ids.sideScene, sceneTitle: 'Night ferry' })
    expect(last.at).toBe(settings.getSettings().worldsSeenAt[alder])

    // No last story: the world's own last place, else its first story.
    settings.updateSettings({ lastStoryId: null, lastSceneId: null, lastPlaces: { [alder]: { storyId: ids.book1, sceneId: null } } })
    last = (await library.getLibrary()).last!
    expect(last.storyTitle).toBe('Book 1')
    expect(last.sceneTitle).toBe('Scene 1')

    settings.updateSettings({ lastWorldId: 'a-world-that-is-gone' })
    expect((await library.getLibrary()).last).toBeNull()
    settings.updateSettings({ lastWorldId: birch })
  })

  it('renames worlds and stories, open or not, and keeps the old name for a blank one', async () => {
    library.renameWorldIn(birch, '  Birchwood  ') // open
    library.renameWorldIn(alder, 'Alderney') // closed
    library.renameWorldIn(alder, '   ')
    library.renameStoryIn(alder, ids.side, 'Harbour Nights') // closed
    library.renameStoryIn(alder, ids.side, '')
    const birchBook = repo.listStories(world.db())[0].id
    library.renameStoryIn(birch, birchBook, 'Rings') // open
    const overview = await library.getLibrary()
    const a = overview.worlds.find((w) => w.id === alder)!
    expect(a.name).toBe('Alderney')
    expect(a.stories.find((s) => s.id === ids.side)!.title).toBe('Harbour Nights')
    const b = overview.worlds.find((w) => w.id === birch)!
    expect(b.name).toBe('Birchwood')
    expect(b.stories[0].title).toBe('Rings')
    expect(world.getWorld()!.name).toBe('Birchwood')

    expect(() => library.renameStoryIn(alder, ids.gone, 'Back')).toThrow(/no longer exists/)
    expect(() => library.renameWorldIn('nowhere', 'X')).toThrow(/could not be found/)
  })

  it('never changes a closed world from an older AI Write: it asks for it to be opened first', () => {
    const folder = world.listWorlds().find((w) => w.id === alder)!.folder
    const raw = new Database(join(folder, 'world.db'))
    const version = raw.pragma('user_version', { simple: true }) as number
    raw.pragma(`user_version = ${version - 1}`)
    raw.close()
    try {
      expect(() => library.renameWorldIn(alder, 'Older')).toThrow(/needs to be opened once/)
    } finally {
      const back = new Database(join(folder, 'world.db'))
      back.pragma(`user_version = ${version}`)
      back.close()
    }
  })

  it('never makes a world folder called Recently deleted, and never lists that folder', () => {
    const made = world.createWorld('Recently deleted')
    expect(made.folder).toBe(join(lib, 'Recently deleted 2'))
    mkdirSync(trash, { recursive: true })
    expect(world.listWorlds().some((w) => w.folder === trash)).toBe(false)
    world.openWorld(birch)
    rmSync(made.folder, { recursive: true, force: true })
  })

  it('moves a closed world into Recently deleted with a note of what it was, and back again', async () => {
    const alderFolder = world.listWorlds().find((w) => w.id === alder)!.folder
    const gone = await library.deleteWorld(alder)
    expect(gone).toMatchObject({ trashId: 'Alder', worldId: alder, name: 'Alderney', stories: 3, words: 16 })
    expect(Date.parse(gone.purgeAt) - Date.parse(gone.deletedAt)).toBe(30 * DAY)
    expect(existsSync(alderFolder)).toBe(false)
    const note = JSON.parse(readFileSync(join(trash, 'Alder', 'deleted.json'), 'utf8'))
    expect(note).toMatchObject({ worldId: alder, name: 'Alderney', stories: 3, words: 16, originalFolder: 'Alder' })
    expect(existsSync(join(trash, 'Alder', 'world.db'))).toBe(true)

    const overview = await library.getLibrary()
    expect(overview.worlds.map((w) => w.id)).toEqual([birch])
    expect(overview.deleted).toEqual([gone])

    // Its old folder name was taken meanwhile: it comes back beside it.
    mkdirSync(join(lib, 'Alder'))
    const back = await library.restoreWorld('Alder')
    expect(back).toMatchObject({ id: alder, name: 'Alderney', folder: join(lib, 'Alder 2') })
    expect(existsSync(join(lib, 'Alder 2', 'deleted.json'))).toBe(false)
    expect(existsSync(trash)).toBe(false) // nothing left in it
    rmSync(join(lib, 'Alder'), { recursive: true })
    const after = await library.getLibrary()
    expect(after.deleted).toEqual([])
    expect(after.worlds.find((w) => w.id === alder)!.words).toBe(16)
  })

  it('closes the open world before deleting it, and forgets it as the last world and the setup’s world', async () => {
    settings.updateSettings({ lastWorldId: birch, firstRun: { worldId: birch, step: 'connect', sceneId: null } })
    const gone = await library.deleteWorld(birch)
    expect(world.maybeCurrentWorld()).toBeNull()
    expect(gone.name).toBe('Birchwood')
    const s = settings.getSettings()
    expect(s.lastWorldId).toBeNull()
    expect(s.lastStoryId).toBeNull()
    expect(s.firstRun).toBeNull()
    expect(s.worldsSeenAt[birch]).toBeTruthy()
    expect((await library.getLibrary()).last).toBeNull()
    // Two deleted worlds from folders of one name each keep their own place.
    world.openWorld(alder)
    world.createWorld('Birch')
    const second = await library.deleteWorld(world.maybeCurrentWorld()!.id)
    expect(second.trashId).toBe('Birch 2')
    expect((await library.getLibrary()).deleted.map((d) => d.trashId).sort()).toEqual(['Birch', 'Birch 2'])
  })

  it('empties one deleted world or all of them, and only ever inside Recently deleted', async () => {
    const outside = join(dir, 'keep-me')
    mkdirSync(outside, { recursive: true })
    writeFileSync(join(outside, 'world.db'), 'x')
    for (const bad of ['..', '../keep-me', '..\\keep-me', 'Birch/..', '', '.', 'C:\\Windows']) {
      await expect(library.emptyDeletedWorlds(bad)).rejects.toThrow(/no longer in Recently deleted/)
      await expect(library.restoreWorld(bad)).rejects.toThrow(/no longer in Recently deleted/)
    }
    expect(existsSync(join(outside, 'world.db'))).toBe(true)
    await expect(library.restoreWorld('Nothing here')).rejects.toThrow(/no longer in Recently deleted/)

    await library.emptyDeletedWorlds('Birch 2')
    expect((await library.getLibrary()).deleted.map((d) => d.trashId)).toEqual(['Birch'])
    await library.emptyDeletedWorlds()
    expect((await library.getLibrary()).deleted).toEqual([])
    expect(existsSync(trash)).toBe(false)
  })

  it('removes a deleted world for good after 30 days, and takes in a world folder left there by hand', async () => {
    world.createWorld('Cedar')
    const cedar = world.maybeCurrentWorld()!.id
    world.createWorld('Damson')
    const damson = world.maybeCurrentWorld()!.id
    world.openWorld(alder)
    await library.deleteWorld(cedar)
    await library.deleteWorld(damson)
    const age = (trashId: string, days: number): void => {
      const file = join(trash, trashId, 'deleted.json')
      const note = JSON.parse(readFileSync(file, 'utf8'))
      writeFileSync(file, JSON.stringify({ ...note, deletedAt: new Date(Date.now() - days * DAY).toISOString() }))
    }
    age('Cedar', 31)
    age('Damson', 29)
    // A stray folder that holds no world is never listed nor removed.
    mkdirSync(join(trash, 'notes'))
    writeFileSync(join(trash, 'notes', 'a.txt'), 'x')

    const overview = await library.getLibrary()
    expect(overview.deleted.map((d) => d.trashId)).toEqual(['Damson'])
    expect(existsSync(join(trash, 'Cedar'))).toBe(false)
    expect(existsSync(join(trash, 'notes', 'a.txt'))).toBe(true)

    // A world folder put in by hand (no deleted.json) gets its full 30 days from now.
    rmSync(join(trash, 'Damson', 'deleted.json'))
    const again = (await library.getLibrary()).deleted
    expect(again).toHaveLength(1)
    expect(again[0]).toMatchObject({ trashId: 'Damson', worldId: damson, name: 'Damson', stories: 1 })
    expect(Date.now() - Date.parse(again[0].deletedAt)).toBeLessThan(60_000)
    expect(existsSync(join(trash, 'Damson', 'deleted.json'))).toBe(true)
    expect(readdirSync(trash).sort()).toEqual(['Damson', 'notes'])
  })

  // Windows refuses to move a folder while a file in it is open (here, the world's database held by another
  // connection, as antivirus or a sync app would): nothing is lost and the world is open again.
  it.skipIf(process.platform !== 'win32')('keeps the world, open again, when its folder is in use', async () => {
    const folder = world.maybeCurrentWorld()!.folder
    const holder = new Database(join(folder, 'world.db'), { readonly: true })
    holder.prepare('SELECT 1 FROM meta').get()
    try {
      await expect(library.deleteWorld(alder)).rejects.toMatchObject({ code: 'world-in-use' })
    } finally {
      holder.close()
    }
    expect(world.maybeCurrentWorld()?.id).toBe(alder)
    expect(existsSync(join(folder, 'deleted.json'))).toBe(false)
    expect((await library.getLibrary()).worlds.some((w) => w.id === alder)).toBe(true)
  }, 15_000)

  // The world's history.db (drafts and snapshots) closes with the world, so the whole folder can move.
  it('moves the open world with its history.db, which closes with it', async () => {
    const { initHistory } = await import('../history')
    initHistory()
    const folder = world.reopenCurrent().folder
    expect(existsSync(join(folder, 'history.db'))).toBe(true)
    const gone = await library.deleteWorld(alder)
    expect(existsSync(folder)).toBe(false)
    expect(existsSync(join(trash, gone.trashId, 'history.db'))).toBe(true)
  })
})

describe('the Recently deleted folder name', () => {
  it('is never given to a new world folder, by any way of making one', async () => {
    const { freeFolder } = await import('../transfer/worldFile')
    rmSync(trash, { recursive: true, force: true }) // a clean library: no Recently deleted yet
    expect(freeFolder(lib, 'Recently deleted')).toBe(join(lib, 'Recently deleted 2'))
    expect(freeFolder(lib, 'recently DELETED')).toBe(join(lib, 'recently DELETED 2'))
  })

  it('lists the world open right now first, then the rest by when they were last open', async () => {
    world.createWorld('Elm')
    const elm = world.maybeCurrentWorld()!.id
    world.createWorld('Fir')
    const fir = world.maybeCurrentWorld()!.id
    world.openWorld(elm)
    settings.updateSettings({ worldsSeenAt: { [elm]: '2020-01-01T00:00:00.000Z', [fir]: '2026-09-30T00:00:00.000Z' } })
    const listed = (await library.getLibrary()).worlds.map((w) => w.id)
    expect(listed[0]).toBe(elm)
    expect(listed.indexOf(fir)).toBeGreaterThan(0)
    expect((await library.getLibrary()).worlds[0].openedAt).toBe('2020-01-01T00:00:00.000Z')
  })

  it('moves a live world found in a folder called Recently deleted aside before deleting into it', async () => {
    // A world left in that folder (by hand, or by an older AI Write): a world like any other.
    world.createWorld('Gorse')
    const gorse = world.maybeCurrentWorld()!.id
    const gorseFolder = world.maybeCurrentWorld()!.folder
    world.createWorld('Holly')
    const holly = world.maybeCurrentWorld()!.id
    renameSync(gorseFolder, trash)
    expect(world.listWorlds().find((w) => w.id === gorse)!.folder).toBe(trash)

    // Nothing in it is listed, restored or removed while it is a live world.
    const overview = await library.getLibrary()
    expect(overview.deleted).toEqual([])
    expect(overview.worlds.some((w) => w.id === gorse)).toBe(true)
    await library.emptyDeletedWorlds()
    await expect(library.restoreWorld('images')).rejects.toThrow(/no longer in Recently deleted/)
    expect(existsSync(join(trash, 'world.db'))).toBe(true)

    // Deleting another world (the open one) moves Gorse aside first.
    const gone = await library.deleteWorld(holly)
    expect(gone.trashId).toBe('Holly')
    expect(existsSync(join(trash, 'world.db'))).toBe(false)
    const aside = world.listWorlds().find((w) => w.id === gorse)!
    expect(aside.folder).toBe(join(lib, 'Recently deleted 2'))
    expect((await library.getLibrary()).deleted.map((d) => d.trashId)).toEqual(['Holly'])

    // And Gorse itself, open in that folder, can be deleted too: it is closed, moved aside, then deleted.
    await library.emptyDeletedWorlds()
    world.closeWorld()
    renameSync(join(lib, 'Recently deleted 2'), trash)
    world.openWorld(gorse)
    const gorseGone = await library.deleteWorld(gorse)
    expect(world.maybeCurrentWorld()).toBeNull()
    expect(gorseGone).toMatchObject({ worldId: gorse, trashId: 'Recently deleted 2' })
    expect(existsSync(join(trash, 'world.db'))).toBe(false)
    expect(world.listWorlds().some((w) => w.id === gorse)).toBe(false)
    const back = await library.restoreWorld('Recently deleted 2')
    expect(back).toMatchObject({ id: gorse, folder: join(lib, 'Recently deleted 2') })
  })

  // While a delete waits for a folder another program holds, emptying Recently deleted in the meantime never
  // takes the folder away from under it.
  it.skipIf(process.platform !== 'win32')('keeps Recently deleted while a delete is still moving a world into it', async () => {
    world.createWorld('Ivy')
    const ivy = world.maybeCurrentWorld()!.id
    const ivyFolder = world.maybeCurrentWorld()!.folder
    world.closeWorld()
    const holder = new Database(join(ivyFolder, 'world.db'), { readonly: true })
    holder.prepare('SELECT 1 FROM meta').get()
    const deleting = library.deleteWorld(ivy)
    await new Promise((r) => setTimeout(r, 300))
    await library.emptyDeletedWorlds() // nothing to remove yet; must not take Recently deleted away
    expect(existsSync(trash)).toBe(true)
    holder.close()
    const gone = await deleting
    expect(gone).toMatchObject({ worldId: ivy, trashId: 'Ivy' })
    expect(existsSync(join(trash, 'Ivy', 'world.db'))).toBe(true)
  }, 15_000)
})
