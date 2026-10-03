// Importing a plan into a world (counts, the document's shape, the memory left unread, Undo) and the import
// catch-up driving the real memory keeper with the fake provider (order, Stop, pausing, carrying on after a restart).

import type Database from 'better-sqlite3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ImportPlan, ManuscriptRun } from '@shared/contracts/importing'
import type { CatchUpState } from '@shared/contracts/importing'
import type { ID } from '@shared/types'
import { memoryWorld } from '../../../tests/unit/helpers'
import { startFakeProvider, type FakeProvider } from '../../../tests/fake-provider/server.mjs'
import * as repo from '../db/repo'
import * as kdb from '../db/keeper'
import * as idb from '../db/importing'
import { listActs } from '../db/acts'
import { Keeper } from '../keeper/engine'
import type { MemoryModel } from '../keeper/model'
import { planRead } from '../keeper/track'
import { importPlan } from './save'
import { sceneDoc } from './doc'
import { CatchUp } from './catchUp'
import { catchUpCost, guessCatchUp } from './estimate'

let fake: FakeProvider
beforeAll(async () => {
  fake = await startFakeProvider({ delayMs: 0 })
})
afterAll(() => fake.close())

const t = (text: string, look: Partial<ManuscriptRun> = {}): ManuscriptRun => ({ text, ...look })

/** A plan of `chapters` chapters, each of `scenes` scenes; scene text names a character, so the memory finds them. */
function plan(chapters: number, scenes: number, extra: Partial<ImportPlan> = {}): ImportPlan {
  return {
    title: 'The Ferry',
    acts: [],
    chapters: Array.from({ length: chapters }, (_, c) => ({
      title: `Chapter ${c + 1}`,
      act: null,
      scenes: Array.from({ length: scenes }, (_, s) => ({
        title: `Scene ${s + 1}`,
        paragraphs: [[t(`Kell${String.fromCharCode(97 + c)}${String.fromCharCode(97 + s)}'s eyes were grey.`)], [t('The ferry left at dawn.')]]
      }))
    })),
    ...extra
  }
}

function modelFor(): MemoryModel {
  return {
    target: { id: 'p1', name: 'Fake', kind: 'custom', baseUrl: fake.url, apiKey: 'test' },
    choice: { providerId: 'p1', modelId: 'fake/writer', label: 'fake/writer', contextLength: 32000, promptPrice: 0.000001, completionPrice: 0.000002 }
  }
}

describe('importing a plan', () => {
  it('makes the story, chapters and scenes in order, with documents shaped as the editor saves them', () => {
    const db = memoryWorld()
    const before = repo.listStories(db)
    const p = plan(2, 2)
    p.chapters[0].scenes[0].paragraphs = [
      [t('Mara '), t('ran', { bold: true }), t(' to the '), t('dock', { italic: true }), t('.')],
      [],
      [t('Line one\nline two', { bold: true, italic: true })]
    ]
    const r = importPlan(db, p)
    expect(r).toMatchObject({ chapters: 2, scenes: 4, acts: 0 })
    expect(r.words).toBe(5 + 4 + 3 * 9)
    const stories = repo.listStories(db)
    expect(stories).toHaveLength(before.length + 1)
    const o = repo.getOutline(db, r.storyId)
    expect(o.story.title).toBe('The Ferry')
    expect(o.chapters.map((c) => c.title)).toEqual(['Chapter 1', 'Chapter 2'])
    expect(o.scenes.map((s) => s.title)).toEqual(['Scene 1', 'Scene 2', 'Scene 1', 'Scene 2'])
    expect(o.scenes.every((s) => s.status === 'drafted')).toBe(true)
    expect(r.sceneId).toBe(o.scenes[0].id)

    const scene = repo.getScene(db, r.sceneId)
    expect(scene.text).toBe('Mara ran to the dock.\n\n* * *\n\nLine one\nline two')
    const doc = scene.doc as { content: { type: string; attrs?: { pid: string }; content?: unknown[] }[] }
    expect(doc.content.map((n) => n.type)).toEqual(['paragraph', 'horizontalRule', 'paragraph'])
    expect(doc.content[0].content).toEqual([
      { type: 'text', text: 'Mara ' },
      { type: 'text', text: 'ran', marks: [{ type: 'bold' }] },
      { type: 'text', text: ' to the ' },
      { type: 'text', text: 'dock', marks: [{ type: 'italic' }] },
      { type: 'text', text: '.' }
    ])
    const both = [{ type: 'bold' }, { type: 'italic' }]
    expect(doc.content[2].content).toEqual([
      { type: 'text', text: 'Line one', marks: both },
      { type: 'hardBreak', marks: both },
      { type: 'text', text: 'line two', marks: both }
    ])
    const pids = doc.content.filter((n) => n.attrs).map((n) => n.attrs!.pid)
    expect(pids.every((id) => /^[a-z0-9]{8}$/.test(id))).toBe(true)
    expect(new Set(pids).size).toBe(pids.length)
  })

  it('leaves the scenes unread by the memory: nothing waits, until the catch-up asks', () => {
    const db = memoryWorld()
    const r = importPlan(db, plan(1, 2))
    expect(kdb.scenesToRead(db)).toEqual([])
    expect(kdb.memoryCounts(db).behind).toBe(0)
    expect(idb.unreadCounts(db)).toEqual({ [r.storyId]: 2 })
    // The keeper reads every paragraph once asked, using the editor's paragraph ids.
    idb.markWaiting(db, [r.sceneId])
    expect(kdb.scenesToRead(db)).toEqual([r.sceneId])
    const read = planRead(db, kdb.keeperScene(db, r.sceneId)!)
    expect(read.toRead).toHaveLength(2)
    expect(read.toRead.every((p) => p.pid && p.id === p.pid)).toBe(true)
    // An edit makes it wait as any edited scene does.
    const other = repo.getOutline(db, r.storyId).scenes[1].id
    repo.saveSceneText(db, other, null, 'Changed.')
    kdb.noteSceneSaved(db, other)
    expect(idb.unreadCounts(db)).toEqual({})
  })

  it('puts chapters into their acts, chapters before the first act in none', () => {
    const db = memoryWorld()
    const p = plan(3, 1, { acts: [{ title: 'Part One' }, { title: 'Part Two' }] })
    p.chapters[1].act = 0
    p.chapters[2].act = 1
    const r = importPlan(db, p)
    const acts = listActs(db, r.storyId)
    expect(acts.map((a) => a.title)).toEqual(['Part One', 'Part Two'])
    const o = repo.getOutline(db, r.storyId)
    expect(o.chapters.map((c) => [c.title, c.actId])).toEqual([
      ['Chapter 1', null],
      ['Chapter 2', acts[0].id],
      ['Chapter 3', acts[1].id]
    ])
  })

  it("in a world made for the book, takes the empty first story's place; in any other world, goes after the last story", () => {
    const fresh = memoryWorld()
    importPlan(fresh, plan(1, 1, { newWorld: true }))
    expect(repo.listStories(fresh).map((s) => s.title)).toEqual(['The Ferry'])
    expect(repo.listStories(fresh)[0].startStoryId).toBeNull()

    const used = memoryWorld()
    const first = repo.listStories(used)[0]
    repo.saveSceneText(used, repo.getOutline(used, first.id).scenes[0].id, null, 'Written.')
    const r = importPlan(used, plan(1, 1, { newWorld: true }))
    const stories = repo.listStories(used)
    expect(stories.map((s) => s.title)).toEqual(['Book 1', 'The Ferry'])
    expect(repo.getStory(used, r.storyId).startStoryId).toBe(first.id)
  })

  it('is all or nothing, and Undo (deleting the story) takes the whole import back', () => {
    const db = memoryWorld()
    const before = repo.listStories(db).length
    expect(() => importPlan(db, { title: 'X', acts: [], chapters: [] })).toThrow(/nothing to import/)
    expect(repo.listStories(db)).toHaveLength(before)
    const r = importPlan(db, plan(2, 2))
    repo.deleteStory(db, r.storyId)
    expect(repo.listStories(db)).toHaveLength(before)
    expect(idb.unreadCounts(db)).toEqual({})
    repo.restoreDeleted(db, 'story', r.storyId)
    expect(repo.getOutline(db, r.storyId).scenes).toHaveLength(4)
  })

  it('cleans what it is sent: long titles cut, blank ones numbered, odd runs dropped', () => {
    const db = memoryWorld()
    const r = importPlan(db, {
      title: '   ',
      acts: [],
      chapters: [
        {
          title: 'x'.repeat(500),
          act: 7,
          scenes: [{ title: '', paragraphs: [[t('Fine.'), { nope: 1 } as unknown as ManuscriptRun], 'junk' as unknown as ManuscriptRun[]] }]
        }
      ]
    })
    const o = repo.getOutline(db, r.storyId)
    expect(o.story.title).toBe('Imported story')
    expect(o.chapters[0].title.length).toBe(200)
    expect(o.chapters[0].actId).toBeNull()
    expect(o.scenes[0].title).toBe('Scene 1')
    expect(repo.getScene(db, r.sceneId).text).toBe('Fine.')
  })

  it('writes a scene with no words as an empty scene', () => {
    expect(sceneDoc([[], [t('  ')]])).toEqual({ doc: null, text: '' })
  })
})

describe('the import catch-up', () => {
  function keeperFor(db: Database.Database, fetchImpl?: typeof fetch): Keeper {
    const k = new Keeper({ db, model: modelFor, emitStatus: () => {}, emitChanged: () => {}, quietMs: 20, summaries: false, retryDelays: [0], fetchImpl })
    k.start()
    return k
  }

  function catchUpFor(db: Database.Database, k: () => Keeper | null, model: () => MemoryModel | { error: string } = modelFor) {
    const states: CatchUpState[] = []
    const c = new CatchUp({ db, keeper: k, model, emit: (s) => states.push(s) })
    return { c, states }
  }

  /** The scenes the keeper finished reading, in the order it read them. */
  const readOrder = (db: Database.Database): ID[] =>
    (db.prepare("SELECT scene_id FROM memory_runs WHERE status = 'done' AND scene_id <> '' ORDER BY rowid").all() as { scene_id: string }[]).map(
      (r) => r.scene_id
    )

  it('reads the story in reading order, chapter by chapter, and builds the memory', async () => {
    const db = memoryWorld()
    const r = importPlan(db, plan(3, 2))
    const k = keeperFor(db)
    const { c, states } = catchUpFor(db, () => k)
    c.start(r.storyId)
    await c.whenIdle()
    await k.whenIdle()
    const scenes = repo.getOutline(db, r.storyId).scenes.map((s) => s.id)
    expect(readOrder(db)).toEqual(scenes)
    expect(idb.unreadCounts(db)).toEqual({})
    expect(idb.getCatchUpRecord(db)).toBeNull()
    // The memory has learned what the text says.
    expect(repo.listEntries(db).map((e) => e.name)).toContain('Kellaa')
    expect(repo.listEntries(db).find((e) => e.name === 'Kellcb')?.fields.eyes).toBe('grey')
    // It said how it went, chapter by chapter.
    const chapters = states.map((s) => s.running?.chapter).filter((n): n is number => !!n)
    expect(chapters[0]).toBe(1)
    expect(Math.max(...chapters)).toBe(3)
    expect(states.at(-1)).toMatchObject({ running: null, finished: { storyId: r.storyId, storyTitle: 'The Ferry', missed: 0 } })
    k.stop()
  })

  it('carries on after a restart from where it was', async () => {
    const db = memoryWorld()
    const r = importPlan(db, plan(2, 3))
    let n = 0
    let held: (() => void) | null = null
    const holding = new Promise<void>((res) => (held = res))
    // The third reading request hangs until the "app" closes.
    const slow: typeof fetch = async (input, init) => {
      if (++n === 3) {
        held!()
        await new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))))
      }
      return fetch(input, init)
    }
    const k1 = keeperFor(db, slow)
    const first = catchUpFor(db, () => k1)
    first.c.start(r.storyId)
    await holding
    // The app quits: the world closes the catch-up, then the keeper.
    first.c.close()
    k1.stop()
    await first.c.whenIdle()
    expect(idb.getCatchUpRecord(db)).toEqual({ storyIds: [r.storyId] })
    expect(readOrder(db)).toHaveLength(2)

    // The app starts again.
    const k2 = keeperFor(db)
    const second = catchUpFor(db, () => k2)
    second.c.resume()
    await second.c.whenIdle()
    await k2.whenIdle()
    const scenes = repo.getOutline(db, r.storyId).scenes.map((s) => s.id)
    expect(readOrder(db)).toEqual(scenes)
    expect(idb.getCatchUpRecord(db)).toBeNull()
    k2.stop()
  })

  it('stops at once: the scene being read stops and the rest go back to unread', async () => {
    const db = memoryWorld()
    const r = importPlan(db, plan(2, 2))
    let held: (() => void) | null = null
    const holding = new Promise<void>((res) => (held = res))
    let n = 0
    const slow: typeof fetch = async (input, init) => {
      if (++n === 2) {
        held!()
        await new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))))
      }
      return fetch(input, init)
    }
    const k = keeperFor(db, slow)
    const { c } = catchUpFor(db, () => k)
    c.start(r.storyId)
    await holding
    await c.stop()
    await k.whenIdle()
    expect(readOrder(db)).toHaveLength(1)
    expect(idb.unreadCounts(db)).toEqual({ [r.storyId]: 3 })
    expect(kdb.scenesToRead(db)).toEqual([])
    expect(idb.getCatchUpRecord(db)).toBeNull()
    expect(c.state().running).toBeNull()
    k.stop()
  })

  it('pauses, saying why, when there is no memory model, and carries on when asked again', async () => {
    const db = memoryWorld()
    const r = importPlan(db, plan(1, 2))
    const k = keeperFor(db)
    let model: MemoryModel | { error: string } = { error: 'Choose a writer model in Settings › Models to keep the memory up to date.' }
    const { c } = catchUpFor(db, () => k, () => model)
    c.start(r.storyId)
    await c.whenIdle()
    expect(c.state().running).toMatchObject({ status: 'paused', error: /Settings › Models/, read: 0, scenes: 2 })
    expect(idb.getCatchUpRecord(db)).toEqual({ storyIds: [r.storyId] })
    model = modelFor()
    c.start(r.storyId)
    await c.whenIdle()
    await k.whenIdle()
    expect(idb.unreadCounts(db)).toEqual({})
    expect(c.state().running).toBeNull()
    k.stop()
  })

  it('passes over a story deleted meanwhile (an import undone)', async () => {
    const db = memoryWorld()
    const r = importPlan(db, plan(1, 2))
    repo.deleteStory(db, r.storyId)
    const k = keeperFor(db)
    const { c } = catchUpFor(db, () => k)
    c.start(r.storyId)
    await c.whenIdle()
    expect(readOrder(db)).toEqual([])
    expect(c.state()).toMatchObject({ running: null, finished: null })
    k.stop()
  })

  it('works out roughly what it costs', () => {
    const g = guessCatchUp(
      Array.from({ length: 100 }, () => ({ chars: 9000, words: 1500 })),
      25,
      { contextLength: 32000, maxOutput: null },
      'off'
    )
    expect(g.input).toBeGreaterThan(100 * 2500)
    expect(g.output).toBeGreaterThan(100 * 200)
    expect(catchUpCost(g, { promptPrice: 0.000001, completionPrice: 0.000002 })).toBeGreaterThan(0.3)
    expect(catchUpCost(g, { promptPrice: null, completionPrice: 0.000002 })).toBeNull()
    expect(guessCatchUp([{ chars: 9000, words: 1500 }], 1, { contextLength: 32000, maxOutput: null }, 'high').output).toBeGreaterThan(
      guessCatchUp([{ chars: 9000, words: 1500 }], 1, { contextLength: 32000, maxOutput: null }, 'off').output
    )
  })
})
