// Adam's own edits to the story record, through the open world's handlers as the window makes them, bring the
// end-of-chapter snapshots and roll-up marks up to date as a read does (long story memory fix 15, review 2026-10-16):
// a change on an entry page, its removal, a scene card and an undo in What changed. A made-up library folder, no model
// (snapshots need none), invented words.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ID } from '@shared/types'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() }, BrowserWindow: { getAllWindows: () => [] } }))

const dir = mkdtempSync(join(tmpdir(), 'aiwrite-record-'))
let world: typeof import('../world')
let keeper: typeof import('./index')
let repo: typeof import('../db/repo')
let mem: typeof import('../db/memory')
let kdb: typeof import('../db/keeper')
let snapshots: typeof import('../db/snapshots')
let summaries: typeof import('./summaries')
let memoryHandlers: (typeof import('../ipc/memory'))['memoryHandlers']
let keeperHandlers: (typeof import('../ipc/keeper'))['keeperHandlers']
let coreHandlers: (typeof import('../ipc/core'))['coreHandlers']

beforeAll(async () => {
  process.env.AIWRITE_DATA_DIR = dir
  delete process.env.AIWRITE_START
  world = await import('../world')
  keeper = await import('./index')
  repo = await import('../db/repo')
  mem = await import('../db/memory')
  kdb = await import('../db/keeper')
  snapshots = await import('../db/snapshots')
  summaries = await import('./summaries')
  memoryHandlers = (await import('../ipc/memory')).memoryHandlers
  keeperHandlers = (await import('../ipc/keeper')).keeperHandlers
  coreHandlers = (await import('../ipc/core')).coreHandlers
  keeper.initKeeper()
})

afterAll(() => {
  world.closeWorld()
  delete process.env.AIWRITE_DATA_DIR
  rmSync(dir, { recursive: true, force: true })
})

/** The open world's keeper has done what it had to (snapshots, marks), with no model. */
async function settled(): Promise<void> {
  await keeper.currentKeeper()!.whenIdle()
}

describe('a hand edit of the record, through the handlers', () => {
  let storyId: ID
  let chapters: ID[]
  let scenes: ID[]
  let mara: ID
  let mill: ID

  it('a world opens and each chapter gets its snapshot', async () => {
    world.createWorld('Record')
    const db = world.db()
    storyId = repo.listStories(db)[0].id
    const o = repo.getOutline(db, storyId)
    chapters = [o.chapters[0].id, repo.createChapter(db, storyId).id]
    scenes = [o.scenes[0].id, repo.createScene(db, chapters[1]).id]
    mara = repo.createEntry(db, 'character', { name: 'Mara' }).id
    mill = repo.createEntry(db, 'place', { name: 'The Mill' }).id
    for (const id of scenes) {
      repo.saveSceneText(db, id, null, 'The river ran high under the bridge, and nobody on the quay spoke of the weir.')
      repo.updateSceneCard(db, id, { ...repo.getScene(db, id).card, povId: mara, when: 'Day 1' })
      mem.putSummary(db, { level: 'scene', targetId: id, text: 'By the end, the river is high.', origin: 'text' })
    }
    // Opened again, so the keeper starts on what is there.
    const id = world.getWorld()!.id
    world.closeWorld()
    world.openWorld(id)
    await settled()
    expect(snapshots.storedSnapshots(world.db()).size).toBe(2)
  })

  it('a change Adam adds on an entry page, and removes again, is in the chapter’s snapshot and then gone', async () => {
    const c = await memoryHandlers.createChange({ kind: 'update', payload: { note: 'lost her knife' }, entryId: mara, anchor: 'scene', sceneId: scenes[0] })
    await settled()
    const notes = () => snapshots.storedSnapshots(world.db()).get(chapters[0])!.snapshot!.changed.map((x) => x.note)
    expect(notes()).toEqual(['lost her knife'])
    memoryHandlers.deleteChange(c.id)
    await settled()
    expect(notes()).toEqual([])
  })

  it('a chapter summary made from the record before it is marked as being brought up to date', async () => {
    const db = world.db()
    // A chapter summary made from what is there now (as the keeper would have written it).
    const r = summaries.nextRollUp(db, [storyId], () => 'Ch 2', { choice: { contextLength: 32000 } } as never)!
    expect(r.targetId).toBe(chapters[0])
    mem.putSummary(db, { level: 'chapter', targetId: chapters[0], text: 'By the end, the river is high.', origin: 'text', sourceHash: r.sourceHash })
    expect(kdb.summaryRow(db, 'chapter', chapters[0])!.stale).toBe(false)
    memoryHandlers.createChange({ kind: 'update', payload: { note: 'broke the ferry chain' }, entryId: mara, anchor: 'scene', sceneId: scenes[0] })
    await settled()
    expect(kdb.summaryRow(db, 'chapter', chapters[0])!.stale).toBe(true)
  })

  it('a scene card saved by hand (who is there and where) is in the snapshot', async () => {
    coreHandlers.updateSceneCard(scenes[1], { ...repo.getScene(world.db(), scenes[1]).card, locationId: mill })
    await settled()
    expect(snapshots.storedSnapshots(world.db()).get(chapters[1])!.snapshot!.people.find((p) => p.who === mara)?.at).toBe(mill)
  })

  it('an undo in What changed is in the snapshot', async () => {
    const db = world.db()
    // A line the memory wrote for a change it read, as a read would (its Undo removes the change).
    const c = mem.insertChange(db, { kind: 'update', payload: { note: 'cut her hand on the latch' }, entryId: mara, anchor: 'scene', sceneId: scenes[1], origin: 'text' })
    const runId = kdb.startRun(db, scenes[1], 1)
    kdb.insertLog(db, {
      runId,
      sceneId: scenes[1],
      entryName: 'Mara',
      text: 'Cut her hand on the latch',
      before: '',
      after: 'cut her hand on the latch',
      action: 'added',
      what: 'change',
      entryId: mara,
      factId: c.id,
      quote: '',
      question: null,
      undo: { op: 'change-added', changeId: c.id } as never
    })
    keeper.currentKeeper()!.recordEdited([storyId])
    await settled()
    const notes = () => snapshots.storedSnapshots(db).get(chapters[1])!.snapshot!.changed.map((x) => x.note)
    expect(notes()).toContain('cut her hand on the latch')
    const line = kdb.listLog(db).find((l) => l.factId === c.id)!
    keeperHandlers.undoMemoryItem(line.id)
    await settled()
    expect(notes()).not.toContain('cut her hand on the latch')
  })
})
