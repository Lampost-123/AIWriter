// One reading of a scene in the open world (keeper/index.ts, through the handlers as the window makes them): before a
// draft, where things stand as the scenes before end is worked out once their reading is done, since it says it too, so
// the scene just written is read once, not by the keeper and the tracker side by side; Recall is told. The fake provider
// (tests/fake-provider/server.mjs); a made-up library folder, invented words.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ID } from '@shared/types'
import { startFakeProvider, type FakeProvider } from '../../../tests/fake-provider/server.mjs'

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  BrowserWindow: { getAllWindows: () => [] },
  safeStorage: { isEncryptionAvailable: () => false }
}))

const dir = mkdtempSync(join(tmpdir(), 'aiwrite-one-reading-'))
let fake: FakeProvider
let world: typeof import('../world')
let keeper: typeof import('./index')
let repo: typeof import('../db/repo')
let kdb: typeof import('../db/keeper')
let gather: typeof import('../ai/gather')
let tracker: typeof import('../continuity/tracker')
let coreHandlers: (typeof import('../ipc/core'))['coreHandlers']
const recall: ID[] = []

beforeAll(async () => {
  fake = await startFakeProvider({ delayMs: 0 })
  process.env.AIWRITE_DATA_DIR = dir
  // Nothing is read by itself after a save: only when a draft asks.
  process.env.AIWRITE_KEEPER_QUIET_MS = '600000'
  process.env.AIWRITE_INDEX_OPEN_MS = '5'
  process.env.AIWRITE_INDEX_FILL = 'off'
  delete process.env.AIWRITE_START
  world = await import('../world')
  keeper = await import('./index')
  repo = await import('../db/repo')
  kdb = await import('../db/keeper')
  gather = await import('../ai/gather')
  tracker = await import('../continuity/tracker')
  coreHandlers = (await import('../ipc/core')).coreHandlers
  const providers = await import('../ai/providers')
  const settings = await import('../settings')
  const p = providers.saveProvider({ name: 'Fake', kind: 'custom', baseUrl: fake.url, apiKey: '' })
  settings.updateSettings({
    models: { writer: { providerId: p.id, modelId: 'fake/writer', label: 'Fake writer', contextLength: 32000, promptPrice: null, completionPrice: null } }
  })
  ;(await import('../events')).onPhoneEvent((event, payload) => {
    if (event === 'recall:changed') recall.push((payload as { sceneId: ID }).sceneId)
  })
  keeper.initKeeper()
})

afterAll(async () => {
  world.closeWorld()
  await fake.close()
  for (const k of ['AIWRITE_DATA_DIR', 'AIWRITE_KEEPER_QUIET_MS', 'AIWRITE_INDEX_OPEN_MS', 'AIWRITE_INDEX_FILL']) delete process.env[k]
  rmSync(dir, { recursive: true, force: true })
})

const doc = (text: string): unknown => ({
  type: 'doc',
  content: [{ type: 'paragraph', attrs: { pid: 'p1' }, content: [{ type: 'text', text }] }]
})

/** The memory model's calls so far, by the first line of what each was told to do. */
function jobs(): string[] {
  return (world.db().prepare('SELECT messages_json AS m FROM generations ORDER BY rowid').all() as { m: string }[]).map((r) => {
    const ms = JSON.parse(r.m) as { role: string; content: string }[]
    const system = ms.find((m) => m.role === 'system')?.content ?? ''
    const user = ms.find((m) => m.role === 'user')?.content ?? ''
    if (system.includes('[AIWRITE-CONTINUITY')) return 'where things stand'
    if (system.includes('[AIWRITE-ONE-READING')) return 'one reading'
    if (system.includes('[AIWRITE-MEMORY-KEEPER')) return 'reading'
    return user.split('\n')[0].slice(0, 30)
  })
}

describe('one reading of a scene before a draft', () => {
  it('reads the scene just written once for the memory, where things stand and its summary', async () => {
    world.createWorld('One reading')
    const db = world.db()
    const book = repo.listStories(db)[0].id
    const o = repo.getOutline(db, book)
    const one = o.scenes[0].id
    const two = repo.createScene(db, o.chapters[0].id).id
    repo.createEntry(db, 'character', { name: 'Mara' })
    const text =
      'Mara came in from the rain in her grey cloak, and the door was barred behind her. She stood by the fire a long time, ' +
      'counting the shutters, listening to the wind off the sea, and saying nothing to anyone in the room about the road.'
    coreHandlers.saveSceneText(one, doc(text), text)
    // Before the next scene is drafted: the memory catches up with the scene before, and where things stand as it ends.
    await gather.catchUpBeforeDraft(db, two)
    await keeper.currentKeeper()!.whenIdle()
    await expect.poll(() => recall.includes(one), { timeout: 5000 }).toBe(true)
    expect(jobs().filter((j) => !j.startsWith('Summarise this chapter'))).toEqual(['one reading'])
    expect(tracker.storedState(db, one)).toMatchObject({ current: true })
    expect(tracker.keptStateBefore(db, two)?.characters.map((c) => c.name)).toEqual(['Mara'])
    // Its summary came with the reading.
    expect(kdb.summaryRow(db, 'scene', one)).toMatchObject({ origin: 'text', stale: false })
  })

  it("holds the summary of the scene Adam is still writing until he leaves it (the AI overhaul, 2026-10-19)", async () => {
    world.createWorld('Still writing')
    const db = world.db()
    const book = repo.listStories(db)[0].id
    const one = repo.getOutline(db, book).scenes[0].id
    repo.createEntry(db, 'character', { name: 'Tobin' })
    const text =
      'Tobin came up the stair with the lamp held high, and the shadows of the banister ran along the wall beside him. ' +
      'He stopped at the landing to listen, heard nothing but the house settling, and went on to the door at the end.'
    coreHandlers.saveSceneText(one, doc(text), text)
    const before = jobs().length
    // Writing on in the same scene (Add below, Continue): the memory reads its words, its summary waits.
    await gather.catchUpBeforeDraft(db, one)
    await keeper.currentKeeper()!.whenIdle()
    expect(jobs().slice(before)).toEqual(['one reading'])
    expect(kdb.summaryRow(db, 'scene', one)).toBeFalsy()
    // Adam leaves the scene: its summary is written then, once.
    keeper.currentKeeper()!.sceneLeft(one)
    await expect.poll(() => kdb.summaryRow(db, 'scene', one)?.origin ?? null, { timeout: 5000 }).toBe('text')
  })
})

