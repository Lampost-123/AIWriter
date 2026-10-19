// The story index in the open world, through the handlers as the window makes them and the real memory keeper, against
// the fake provider (tests/fake-provider/server.mjs; where things stand: everyone named "in the scene", "in her grey
// cloak" worn): built for every story when a world opens, then the last two chapters' details worked out in the
// background; kept current after a memory read, a card saved, a scene deleted and brought back; and "Fill in the whole
// story" with its estimate, progress in the memory's status, Stop, and a quiet note when done. A made-up library folder,
// invented words.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ID } from '@shared/types'
import type { StoryFillDone } from '@shared/contracts/storyIndex'
import { startFakeProvider, type FakeProvider } from '../../../tests/fake-provider/server.mjs'

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  BrowserWindow: { getAllWindows: () => [] },
  safeStorage: { isEncryptionAvailable: () => false }
}))

const dir = mkdtempSync(join(tmpdir(), 'aiwrite-indexing-'))
let fake: FakeProvider
let world: typeof import('../world')
let keeper: typeof import('./index')
let indexing: typeof import('./indexing')
let repo: typeof import('../db/repo')
let sidx: typeof import('../db/storyIndex')
let fill: typeof import('../storyIndex/fill')
let coreHandlers: (typeof import('../ipc/core'))['coreHandlers']
let fillHandlers: (typeof import('../ipc/storyIndex'))['storyIndexHandlers']
const done: StoryFillDone[] = []

beforeAll(async () => {
  fake = await startFakeProvider({ delayMs: 0 })
  process.env.AIWRITE_DATA_DIR = dir
  process.env.AIWRITE_KEEPER_QUIET_MS = '60'
  process.env.AIWRITE_INDEX_OPEN_MS = '5'
  process.env.AIWRITE_INDEX_WAIT_MS = '10'
  delete process.env.AIWRITE_START
  world = await import('../world')
  keeper = await import('./index')
  indexing = await import('./indexing')
  repo = await import('../db/repo')
  sidx = await import('../db/storyIndex')
  fill = await import('../storyIndex/fill')
  coreHandlers = (await import('../ipc/core')).coreHandlers
  fillHandlers = (await import('../ipc/storyIndex')).storyIndexHandlers
  const providers = await import('../ai/providers')
  const settings = await import('../settings')
  const p = providers.saveProvider({ name: 'Fake', kind: 'custom', baseUrl: fake.url, apiKey: '' })
  settings.updateSettings({
    models: {
      writer: {
        providerId: p.id,
        modelId: 'fake/writer',
        label: 'Fake writer',
        contextLength: 32000,
        promptPrice: null,
        completionPrice: null
      }
    }
  })
  ;(await import('../events')).onPhoneEvent((event, payload) => {
    if (event === 'storyFill:done') done.push(payload as StoryFillDone)
  })
  keeper.initKeeper()
})

afterAll(async () => {
  world.closeWorld()
  await fake.close()
  for (const k of ['AIWRITE_DATA_DIR', 'AIWRITE_KEEPER_QUIET_MS', 'AIWRITE_INDEX_OPEN_MS', 'AIWRITE_INDEX_WAIT_MS']) delete process.env[k]
  rmSync(dir, { recursive: true, force: true })
})

/** The memory, the index and the fill have done what they had to. */
async function settled(): Promise<void> {
  for (let i = 0; i < 2; i++) {
    await keeper.currentKeeper()!.whenIdle()
    await indexing.whenIndexIdle(world.db())
  }
}

const doc = (text: string): unknown => ({
  type: 'doc',
  content: [{ type: 'paragraph', attrs: { pid: 'p1' }, content: [{ type: 'text', text }] }]
})

describe('the story index in the open world', () => {
  let book: ID
  let chapters: ID[]
  let scenes: ID[]
  let inn: ID
  let tobin: ID

  it('is built for every story once a world opens, and the last two chapters get their details in the background', async () => {
    world.createWorld('Index')
    const db = world.db()
    book = repo.listStories(db)[0].id
    const o = repo.getOutline(db, book)
    chapters = [o.chapters[0].id, repo.createChapter(db, book).id, repo.createChapter(db, book).id]
    scenes = [o.scenes[0].id, repo.createScene(db, chapters[1]).id, repo.createScene(db, chapters[2]).id]
    repo.createEntry(db, 'character', { name: 'Mara' })
    tobin = repo.createEntry(db, 'character', { name: 'Tobin' }).id
    inn = repo.createEntry(db, 'place', { name: 'The Swan' }).id
    repo.saveSceneText(db, scenes[0], doc('Mara waited on the quay.'), 'Mara waited on the quay.')
    repo.saveSceneText(db, scenes[1], doc('Mara stood at the rail in her grey cloak.'), 'Mara stood at the rail in her grey cloak.')
    repo.saveSceneText(db, scenes[2], doc('Mara climbed to the mill in her grey cloak.'), 'Mara climbed to the mill in her grey cloak.')
    // The memory has read every scene already, so only the index's own work is left when the world opens again.
    db.prepare("UPDATE scenes SET memory_version = text_version, memory_status = 'current'").run()
    const id = world.getWorld()!.id
    world.closeWorld()
    world.openWorld(id)
    await settled()
    const rows = sidx.indexScenes(world.db(), book)
    expect(rows.map((r) => [r.sceneId, r.label])).toEqual([
      [scenes[0], 'Ch 1, Sc 1'],
      [scenes[1], 'Ch 2, Sc 1'],
      [scenes[2], 'Ch 3, Sc 1']
    ])
    // Ch 1 is older than the last two chapters: free part only, until a look-up or Adam's fill wants it.
    expect(rows.map((r) => r.filled)).toEqual(['free', 'ai', 'ai'])
    expect(scenes.map((s) => fill.stageFilled(world.db(), s))).toEqual([false, true, true])
  })

  it('follows a scene card saved by hand', async () => {
    coreHandlers.updateSceneCard(scenes[0], { ...repo.getScene(world.db(), scenes[0]).card, locationId: inn })
    await settled()
    expect(sidx.indexScene(world.db(), scenes[0])?.placeEntryId).toBe(inn)
  })

  it('follows a memory read of new words, with where things stand as the scene ends', async () => {
    const text = 'Mara met Tobin on the quay in her grey cloak.'
    coreHandlers.saveSceneText(scenes[0], doc(text), text)
    await expect.poll(() => fill.stageFilled(world.db(), scenes[0]), { timeout: 15_000 }).toBe(true)
    await settled()
    const row = sidx.indexScene(world.db(), scenes[0])!
    expect(row.present).toContain(tobin)
    expect(row.filled).toBe('ai')
  })

  it('takes a deleted scene out, and puts it back when it is brought back', async () => {
    coreHandlers.deleteScene(scenes[1])
    await settled()
    expect(sidx.indexScene(world.db(), scenes[1])).toBeNull()
    expect(sidx.indexScene(world.db(), scenes[2])?.label).toBe('Ch 3, Sc 1')
    coreHandlers.restoreDeleted('scene', scenes[1])
    await settled()
    expect(sidx.indexScene(world.db(), scenes[1])?.label).toBe('Ch 2, Sc 1')
  })

  it('fills in the whole story when asked: an estimate first, progress in the memory’s status, a note when done', async () => {
    const db = world.db()
    const more = [repo.createScene(db, chapters[0]).id, repo.createScene(db, chapters[0]).id]
    for (const id of more) repo.saveSceneText(db, id, null, 'Tobin counted the boats twice.')
    const e = fillHandlers.estimateStoryFill(book) as Awaited<ReturnType<typeof fillHandlers.estimateStoryFill>>
    expect(e).toMatchObject({ storyId: book, total: 5, scenes: 2, words: 10, free: true, cost: 0, model: 'Fake writer', problem: null })
    fillHandlers.startStoryFill(book)
    expect(keeper.memoryStatus().filling).toMatchObject({ storyId: book, title: 'Book 1', total: 2 })
    await settled()
    expect(done.at(-1)).toEqual({ storyId: book, title: 'Book 1', total: 2, filled: 2, failed: 0, stopped: false, problem: null })
    expect(keeper.memoryStatus().filling).toBeUndefined()
    expect(more.map((id) => sidx.indexScene(db, id)?.filled)).toEqual(['ai', 'ai'])
    expect(() => fillHandlers.startStoryFill(book)).toThrow('Every scene of this story is filled in already.')
  })

  it('stops when Adam says, keeping what was filled in', async () => {
    const db = world.db()
    const late = repo.createScene(db, chapters[0]).id
    repo.saveSceneText(db, late, null, 'Tobin slept badly.')
    fillHandlers.startStoryFill(book)
    fillHandlers.stopStoryFill()
    await settled()
    expect(done.at(-1)).toMatchObject({ storyId: book, total: 1, stopped: true })
    expect(keeper.memoryStatus().filling).toBeUndefined()
  })
})
