// The memory keeper against an in-memory world and the fake provider (whose memory replies follow
// the rules at the top of tests/fake-provider/server.mjs: "<Name> lost her <thing>." is a change,
// "<Name>'s eyes were <colour>." a detail, "<Name> learned that <x>." something they know).

import type Database from 'better-sqlite3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ID, MemoryStatus } from '@shared/types'
import { memoryWorld } from '../../../tests/unit/helpers'
import { startFakeProvider, type FakeProvider } from '../../../tests/fake-provider/server.mjs'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import * as hist from '../db/history'
import * as kdb from '../db/keeper'
import * as gens from '../db/generations'
import type { MemoryModel } from './model'
import { runScene, type RunOutcome } from './run'
import { answerItem, undoItem } from './undo'
import { nextRollUp, sceneSummaryDue, writeRollUp, writeSceneSummary } from './summaries'
import { Keeper } from './engine'

let fake: FakeProvider
beforeAll(async () => {
  fake = await startFakeProvider({ delayMs: 0, slowWords: 3000, slowDelayMs: 30 })
})
afterAll(() => fake.close())

function modelFor(modelId = 'fake/writer', contextLength: number | null = 32000): MemoryModel {
  return {
    target: { id: 'p1', name: 'Fake', kind: 'custom', baseUrl: fake.url, apiKey: 'test' },
    choice: { providerId: 'p1', modelId, label: modelId, contextLength, promptPrice: null, completionPrice: null }
  }
}

interface World {
  db: Database.Database
  storyId: ID
  chapterId: ID
  sceneId: ID
}

function world(): World {
  const db = memoryWorld()
  const story = repo.listStories(db)[0]
  const o = repo.getOutline(db, story.id)
  return { db, storyId: story.id, chapterId: o.chapters[0].id, sceneId: o.scenes[0].id }
}

/** Saves a scene as the editor would: paragraphs with stable ids, plain text with blank lines between. */
function save(db: Database.Database, sceneId: ID, paras: [string, string][]): void {
  const doc = {
    type: 'doc',
    content: paras.map(([pid, text]) => ({ type: 'paragraph', attrs: { pid }, content: text ? [{ type: 'text', text }] : [] }))
  }
  repo.saveSceneText(db, sceneId, doc, paras.map(([, t]) => t).join('\n\n'))
  kdb.noteSceneSaved(db, sceneId)
}

const read = (db: Database.Database, sceneId: ID, model: MemoryModel | null = modelFor()): Promise<RunOutcome> =>
  runScene({ db, model, signal: new AbortController().signal, closed: () => false, retryDelays: [0, 0] }, sceneId)

const entryNamed = (db: Database.Database, name: string) => repo.listEntries(db).find((e) => e.name === name) ?? null
const memoryCalls = (db: Database.Database): number =>
  (db.prepare("SELECT COUNT(*) AS n FROM generations WHERE job = 'memory'").get() as { n: number }).n
const lines = (db: Database.Database) => kdb.listLog(db, { limit: 1000 })

describe('reading a scene', () => {
  it('adds what the text says, linked to its words, and records the call', async () => {
    const w = world()
    save(w.db, w.sceneId, [
      ['p1', 'The ferry was late again.'],
      ['p2', 'Mara lost her left hand.']
    ])
    const out = await read(w.db, w.sceneId)
    expect(out.status).toBe('done')
    const mara = entryNamed(w.db, 'Mara')!
    expect(mara.origin).toBe('text')
    const changes = mem.changesForEntry(w.db, mara.id)
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ kind: 'update', origin: 'text', anchor: 'scene', sceneId: w.sceneId })
    const links = hist.linksForFact(w.db, 'change', changes[0].id)
    expect(links[0]).toMatchObject({ quote: 'Mara lost her left hand.', paragraphId: 'p2', state: 'ok' })
    // Every version is in the memory history, with the run that wrote it.
    expect(hist.entryHistory(w.db, mara.id).every((v) => v.origin === 'text' && v.runId)).toBe(true)
    // The scene is processed; the call is a 'memory' record, left out of the drafts list.
    expect(kdb.keeperScene(w.db, w.sceneId)!.memoryState).toBe('current')
    expect(memoryCalls(w.db)).toBe(1)
    expect(gens.listGenerations(w.db, w.sceneId)).toEqual([])
    const run = kdb.getRun(w.db, (out as { runId: ID }).runId)!
    expect(run).toMatchObject({ status: 'done', modelId: 'fake/writer' })
    expect(run.promptTokens).toBeGreaterThan(0)
    // What changed: the new character and the change, with the words.
    const log = lines(w.db)
    expect(log.map((l) => [l.entryName, l.text])).toEqual([
      ['Mara', 'New character'],
      ['Mara', 'Lost her left hand']
    ])
    expect(log[1].quote).toBe('Mara lost her left hand.')
  })

  it('changes nothing when the same version is read again', async () => {
    const w = world()
    save(w.db, w.sceneId, [['p1', 'Mara lost her left hand.']])
    await read(w.db, w.sceneId)
    const before = { calls: memoryCalls(w.db), log: lines(w.db).length, changes: mem.listAllChanges(w.db).length }
    expect((await read(w.db, w.sceneId)).status).toBe('nothing')
    // Saving the same words again (a new version, nothing different) needs no model either.
    save(w.db, w.sceneId, [['p1', 'Mara lost her left hand.']])
    expect((await read(w.db, w.sceneId)).status).toBe('nothing')
    expect({ calls: memoryCalls(w.db), log: lines(w.db).length, changes: mem.listAllChanges(w.db).length }).toEqual(before)
  })

  it('reads only new and changed paragraphs, and a moved paragraph changes nothing', async () => {
    const w = world()
    save(w.db, w.sceneId, [
      ['p1', 'Mara lost her left hand.'],
      ['p2', 'The ferry was late.']
    ])
    await read(w.db, w.sceneId)
    save(w.db, w.sceneId, [
      ['p2', 'The ferry was late.'],
      ['p1', 'Mara lost her left hand.'],
      ['p3', 'Tobin learned that the ferry was cursed.']
    ])
    await read(w.db, w.sceneId)
    const sent = fake.lastRequest()!.body.messages.find((m) => m.role === 'user')!.content
    expect(sent).toContain('P3: Tobin learned that the ferry was cursed.')
    expect(sent).not.toContain('P2: Mara lost her left hand.')
    expect(mem.listAllChanges(w.db).filter((c) => c.kind === 'update')).toHaveLength(1)
    expect(mem.listAllChanges(w.db).filter((c) => c.kind === 'knowledge')).toHaveLength(1)
  })

  it('updates a fact when its words are edited, and removes it when they are deleted', async () => {
    const w = world()
    save(w.db, w.sceneId, [
      ['p1', 'The ferry was late.'],
      ['p2', 'Mara lost her left hand.']
    ])
    await read(w.db, w.sceneId)
    const mara = entryNamed(w.db, 'Mara')!
    const [change] = mem.changesForEntry(w.db, mara.id)

    save(w.db, w.sceneId, [
      ['p1', 'The ferry was late.'],
      ['p2', 'Mara lost her right hand.']
    ])
    await read(w.db, w.sceneId)
    const updated = mem.getChange(w.db, change.id)
    expect(updated.kind === 'update' && updated.payload.note).toBe('lost her right hand')
    expect(hist.linksForFact(w.db, 'change', change.id)[0]).toMatchObject({ quote: 'Mara lost her right hand.', state: 'ok' })
    expect(lines(w.db)[0]).toMatchObject({ action: 'updated', text: 'Lost her right hand', before: 'Lost her left hand' })

    // Deleting the words: no model needed; the change goes, and so does Mara (her last mention).
    const calls = memoryCalls(w.db)
    save(w.db, w.sceneId, [['p1', 'The ferry was late.']])
    const out = await read(w.db, w.sceneId)
    expect(out.status).toBe('done')
    expect(memoryCalls(w.db)).toBe(calls)
    expect(mem.listAllChanges(w.db)).toHaveLength(0)
    expect(entryNamed(w.db, 'Mara')).toBeNull()
    expect(
      lines(w.db)
        .slice(0, 2)
        .map((l) => l.text)
    ).toEqual(['Lost her right hand: those words were deleted', 'Moved to Trash: no scene mentions it any more'])
  })

  it('a typo fix moves the link without asking the model', async () => {
    const w = world()
    save(w.db, w.sceneId, [['p1', 'Mara lost her left hand in the river.']])
    await read(w.db, w.sceneId)
    const calls = memoryCalls(w.db)
    save(w.db, w.sceneId, [['p1', 'Mara lost her left hand in the rivr.']])
    await read(w.db, w.sceneId)
    expect(memoryCalls(w.db)).toBe(calls)
    const [c] = mem.listAllChanges(w.db)
    expect(hist.linksForFact(w.db, 'change', c.id)[0]).toMatchObject({ state: 'ok', quote: 'Mara lost her left hand in the rivr' })
  })
})

describe("Adam's facts", () => {
  it('are never changed: a clash raises an issue instead', async () => {
    const w = world()
    const mara = repo.createEntry(w.db, 'character', { name: 'Mara', fields: { eyes: 'blue' } })
    save(w.db, w.sceneId, [['p1', "Mara's eyes were green."]])
    await read(w.db, w.sceneId)
    expect(repo.getEntry(w.db, mara.id).fields.eyes).toBe('blue')
    const issues = w.db.prepare("SELECT * FROM issues WHERE status = 'open'").all() as { message: string; quote: string }[]
    expect(issues).toHaveLength(1)
    expect(issues[0].message).toContain('Mara')
    expect(issues[0].quote).toBe("Mara's eyes were green.")
    // Read again after another edit: the same issue isn't raised twice.
    save(w.db, w.sceneId, [['p1', "Mara's eyes were green. The ferry was late."]])
    await read(w.db, w.sceneId)
    expect(w.db.prepare("SELECT COUNT(*) AS n FROM issues WHERE status = 'open'").get()).toEqual({ n: 1 })
  })

  it('fills an empty field on his page, but never one he typed', async () => {
    const w = world()
    const mara = repo.createEntry(w.db, 'character', { name: 'Mara' })
    save(w.db, w.sceneId, [['p1', "Mara's eyes were green."]])
    await read(w.db, w.sceneId)
    const after = repo.getEntry(w.db, mara.id)
    expect(after.fields.eyes).toBe('green')
    expect(after.fieldOrigins.eyes).toBe('text')
    expect(after.origin).toBe('adam')
  })

  it('a text fact Adam edited keeps his words; changed words get a question offering a refresh', async () => {
    const w = world()
    save(w.db, w.sceneId, [['p1', 'Mara lost her left hand.']])
    await read(w.db, w.sceneId)
    const [c] = mem.listAllChanges(w.db)
    // Adam edits it on the entry page: it becomes his.
    mem.replaceChange(w.db, c.id, {
      kind: 'update',
      payload: { note: 'lost her left hand to the river' },
      entryId: c.entryId,
      anchor: 'scene',
      sceneId: w.sceneId,
      origin: 'adam'
    })
    save(w.db, w.sceneId, [['p1', 'Mara lost her right hand.']])
    await read(w.db, w.sceneId)
    const now = mem.getChange(w.db, c.id)
    expect(now.origin).toBe('adam')
    expect(now.kind === 'update' && now.payload.note).toBe('lost her left hand to the river')
    const q = lines(w.db).find((l) => l.question)!
    expect(q.question).toMatchObject({ text: 'Keep your words?', answer: 'keep' })
    expect(q.after).toBe('Lost her right hand')
    // Refresh from the scene, then change his mind back.
    answerItem(w.db, q.id, 'refresh')
    const refreshed = mem.getChange(w.db, c.id)
    expect(refreshed.kind === 'update' && refreshed.payload.note).toBe('lost her right hand')
    answerItem(w.db, q.id, 'keep')
    const back = mem.getChange(w.db, c.id)
    expect(back.kind === 'update' && back.payload.note).toBe('lost her left hand to the river')
    expect(back.origin).toBe('adam')
  })

  it('an entry Adam edited is never moved to Trash, even when its last mention goes', async () => {
    const w = world()
    save(w.db, w.sceneId, [['p1', 'Mara lost her left hand.']])
    await read(w.db, w.sceneId)
    const mara = entryNamed(w.db, 'Mara')!
    repo.updateEntry(w.db, mara.id, { summary: 'A ferrywoman.' })
    save(w.db, w.sceneId, [['p1', 'The ferry was late.']])
    await read(w.db, w.sceneId)
    expect(entryNamed(w.db, 'Mara')).not.toBeNull()
  })
})

describe('the last-link rule', () => {
  it('a detail read from two scenes stays until the words in both are gone', async () => {
    const w = world()
    const second = repo.createScene(w.db, w.chapterId, { title: 'Scene 2' }).id
    save(w.db, w.sceneId, [['a1', "Kell's eyes were grey."]])
    await read(w.db, w.sceneId)
    save(w.db, second, [['b1', "Kell's eyes were grey, like the river."]])
    await read(w.db, second)
    const kell = entryNamed(w.db, 'Kell')!
    expect(kell.fields.eyes).toBe('grey')
    expect(hist.linksForEntry(w.db, kell.id).filter((l) => l.factKind === 'field')).toHaveLength(2)

    save(w.db, w.sceneId, [['a1', 'The ferry was late.']])
    await read(w.db, w.sceneId)
    expect(repo.getEntry(w.db, kell.id).fields.eyes).toBe('grey')

    save(w.db, second, [['b1', 'The river was high.']])
    await read(w.db, second)
    // Both sets of words are gone: the detail goes, and with no mention left, Kell too.
    expect(entryNamed(w.db, 'Kell')).toBeNull()
  })
})

describe('undo', () => {
  it('restores what was there and does not add it again from the same words', async () => {
    const w = world()
    save(w.db, w.sceneId, [['p1', 'Mara lost her left hand.']])
    await read(w.db, w.sceneId)
    const line = lines(w.db).find((l) => l.text === 'Lost her left hand')!
    w.db.transaction(() => undoItem(w.db, line.id))()
    expect(mem.listAllChanges(w.db)).toHaveLength(0)
    expect(kdb.getLog(w.db, line.id)!.undone).toBe(true)

    // The paragraph is read again (more words in it): the same words don't bring it back.
    save(w.db, w.sceneId, [['p1', 'Mara lost her left hand. The ferry was late.']])
    await read(w.db, w.sceneId)
    expect(mem.listAllChanges(w.db)).toHaveLength(0)

    // New words do.
    save(w.db, w.sceneId, [['p1', 'Mara lost her left arm. The ferry was late.']])
    await read(w.db, w.sceneId)
    expect(mem.listAllChanges(w.db)).toHaveLength(1)
  })

  it('undoing an update goes back to the earlier version', async () => {
    const w = world()
    save(w.db, w.sceneId, [['p1', 'Mara lost her left hand.']])
    await read(w.db, w.sceneId)
    save(w.db, w.sceneId, [['p1', 'Mara lost her right hand.']])
    await read(w.db, w.sceneId)
    const [c] = mem.listAllChanges(w.db)
    const line = lines(w.db).find((l) => l.action === 'updated')!
    w.db.transaction(() => undoItem(w.db, line.id))()
    const back = mem.getChange(w.db, c.id)
    expect(back.kind === 'update' && back.payload.note).toBe('lost her left hand')
  })

  it('undoing a new character moves it to Trash with its changes', async () => {
    const w = world()
    save(w.db, w.sceneId, [['p1', 'Mara lost her left hand.']])
    await read(w.db, w.sceneId)
    const line = lines(w.db).find((l) => l.text === 'New character')!
    w.db.transaction(() => undoItem(w.db, line.id))()
    expect(entryNamed(w.db, 'Mara')).toBeNull()
    expect(mem.listAllChanges(w.db)).toHaveLength(0)
    expect(lines(w.db).every((l) => l.undone)).toBe(true)
  })

  it('Adam removing a change by hand stops it coming back from the same words', async () => {
    const w = world()
    save(w.db, w.sceneId, [['p1', 'Mara lost her left hand.']])
    await read(w.db, w.sceneId)
    const [c] = mem.listAllChanges(w.db)
    kdb.suppressFact(w.db, 'change', c.id)
    mem.deleteChange(w.db, c.id, { origin: 'adam' })
    save(w.db, w.sceneId, [['p1', 'Mara lost her left hand. The ferry was late.']])
    await read(w.db, w.sceneId)
    expect(mem.listAllChanges(w.db)).toHaveLength(0)
  })
})

describe('failures', () => {
  it('a broken reply is retried once, saying what was wrong', async () => {
    const w = world()
    fake.reset()
    save(w.db, w.sceneId, [['p1', 'Mara lost her left hand.']])
    const out = await read(w.db, w.sceneId, modelFor('fake/memory-bad-json'))
    expect(out.status).toBe('done')
    expect(memoryCalls(w.db)).toBe(2)
    const retry = fake.lastRequest()!.body.messages
    expect(retry[retry.length - 1].content).toContain("Your reply couldn't be used")
    expect(entryNamed(w.db, 'Mara')).not.toBeNull()
  })

  it('a reply that stays broken leaves the memory as it was and says so once', async () => {
    const w = world()
    save(w.db, w.sceneId, [['p1', 'Mara lost her left hand.']])
    const out = await read(w.db, w.sceneId, modelFor('fake/memory-junk'))
    expect(out.status).toBe('failed')
    const scene = kdb.keeperScene(w.db, w.sceneId)!
    expect(scene.memoryState).toBe('failed')
    expect(scene.memoryError).toBe(
      "The memory couldn't read Book 1, Ch 1, Sc 1: the memory model's reply wasn't in the right format. It will try again; or pick another memory model in Settings > Models."
    )
    expect(repo.listEntries(w.db)).toHaveLength(0)
    expect(lines(w.db).map((l) => l.action)).toEqual(['failed'])
    await read(w.db, w.sceneId, modelFor('fake/memory-junk'))
    expect(lines(w.db)).toHaveLength(1)
    // The next try that works clears it.
    expect((await read(w.db, w.sceneId)).status).toBe('done')
    expect(kdb.keeperScene(w.db, w.sceneId)!.memoryState).toBe('current')
    expect(kdb.memoryCounts(w.db)).toEqual({ behind: 0, failed: 0 })
  })

  it('a provider error is reported in plain words for the memory model', async () => {
    const w = world()
    save(w.db, w.sceneId, [['p1', 'Mara lost her left hand.']])
    const out = await read(w.db, w.sceneId, modelFor('fake/credit'))
    expect(out.status).toBe('failed')
    expect((out as { error: string }).error).toMatch(/^The memory couldn't read Book 1, Ch 1, Sc 1\. /)
    expect((out as { error: string }).error).not.toContain('writer')
  })

  it('without a memory model the scene waits (it is not failed)', async () => {
    const w = world()
    save(w.db, w.sceneId, [['p1', 'Mara lost her left hand.']])
    expect((await read(w.db, w.sceneId, null)).status).toBe('no-model')
    expect(kdb.keeperScene(w.db, w.sceneId)!.memoryState).toBe('pending')
  })

  it('stops cleanly when the world closes mid-read, writing nothing after', async () => {
    const w = world()
    save(w.db, w.sceneId, [['p1', 'Mara lost her left hand.']])
    const controller = new AbortController()
    let closed = false
    const running = runScene(
      { db: w.db, model: modelFor('fake/slow'), signal: controller.signal, closed: () => closed, retryDelays: [0] },
      w.sceneId
    )
    await new Promise((r) => setTimeout(r, 150))
    closed = true
    controller.abort()
    w.db.close()
    expect((await running).status).toBe('stopped')
  })
})

describe('long scenes and small models', () => {
  it('reads a long scene in several requests that each fit a small model', async () => {
    const w = world()
    const filler = 'The water rose along the old quay while the gulls argued over the nets and the bells rang out across the town. '.repeat(
      12
    )
    const paras: [string, string][] = []
    for (let i = 0; i < 12; i++)
      paras.push([`p${i}`, `${filler}${i === 3 ? 'Mara lost her left hand.' : ''}${i === 9 ? 'Tobin lost his hat.' : ''}`])
    save(w.db, w.sceneId, paras)
    fake.reset()
    const out = await read(w.db, w.sceneId, modelFor('fake/small', 3000))
    expect(out.status).toBe('done')
    expect(fake.requestCounts()['fake/small']).toBeGreaterThan(1)
    for (const id of (w.db.prepare("SELECT id FROM generations WHERE job = 'memory'").all() as { id: string }[]).map((r) => r.id)) {
      const g = gens.getGeneration(w.db, id)
      expect(g.budget.used).toBeLessThan(3000)
    }
    expect(entryNamed(w.db, 'Mara')).not.toBeNull()
    expect(entryNamed(w.db, 'Tobin')).not.toBeNull()
  })
})

describe('first seen elsewhere', () => {
  it('links a name from a later story instead of making a duplicate, and offers the alternatives', async () => {
    const w = world()
    const book2 = repo.createStory(w.db, { title: 'Book 2' })
    const ch2 = repo.createChapter(w.db, book2.id, { title: 'One' })
    const s2 = repo.createScene(w.db, ch2.id, { title: 'Opening' }).id
    save(w.db, s2, [['x1', 'Kell lost his hat.']])
    await read(w.db, s2)
    const kell = entryNamed(w.db, 'Kell')!
    // Book 1 mentions Kell before Book 2 does.
    save(w.db, w.sceneId, [['p1', 'Kell walked down to the ferry.']])
    await read(w.db, w.sceneId)
    expect(repo.listEntries(w.db).filter((e) => e.name === 'Kell')).toHaveLength(1)
    const points = mem.listExistsPoints(w.db, kell.id)
    expect(points.some((p) => p.sceneId === w.sceneId)).toBe(true)
    const line = lines(w.db).find((l) => l.question?.text === 'Is this the same one?')!
    expect(line.question!.options.map((o) => o.id)).toEqual(['link', 'new'])
    expect(line.question!.answer).toBe('link')

    // "Make a new character": a separate Kell for this scene.
    answerItem(w.db, line.id, 'new')
    expect(repo.listEntries(w.db).filter((e) => e.name === 'Kell')).toHaveLength(2)
    expect(mem.listExistsPoints(w.db, kell.id).some((p) => p.sceneId === w.sceneId)).toBe(false)
    // And back again.
    answerItem(w.db, line.id, 'link')
    expect(repo.listEntries(w.db).filter((e) => e.name === 'Kell')).toHaveLength(1)
    expect(mem.listExistsPoints(w.db, kell.id).some((p) => p.sceneId === w.sceneId)).toBe(true)
  })
})

describe('summaries', () => {
  const longText = (n: number): string =>
    Array.from({ length: n }, (_, i) => `Mara walked along the quay for the ${i + 1}th time and thought about the ferry.`).join(' ')

  it('writes a scene summary, and never replaces one Adam wrote', async () => {
    const w = world()
    save(w.db, w.sceneId, [['p1', longText(8)]])
    expect(sceneSummaryDue(w.db, w.sceneId, false)).toBe(true)
    const o = { db: w.db, model: modelFor(), signal: new AbortController().signal, closed: () => false }
    expect(await writeSceneSummary(o, w.sceneId, null, 'Book 1, Ch 1, Sc 1')).toBe(true)
    const s = mem.getSummary(w.db, 'scene', w.sceneId)!
    expect(s.origin).toBe('text')
    expect(s.text).toMatch(/^This part of the story begins: Mara walked/)
    expect(sceneSummaryDue(w.db, w.sceneId, true)).toBe(false)
    expect(w.db.prepare("SELECT COUNT(*) AS n FROM generations WHERE job = 'summary'").get()).toEqual({ n: 1 })

    mem.putSummary(w.db, { level: 'scene', targetId: w.sceneId, text: 'My own words.', origin: 'adam' })
    save(w.db, w.sceneId, [['p1', longText(30)]])
    expect(sceneSummaryDue(w.db, w.sceneId, true)).toBe(false)
    expect(await writeSceneSummary(o, w.sceneId, null, '')).toBe(false)
    expect(mem.getSummary(w.db, 'scene', w.sceneId)!.text).toBe('My own words.')
  })

  it('rolls scene summaries up into the chapter and the story, never over Adam’s', async () => {
    const w = world()
    mem.putSummary(w.db, { level: 'scene', targetId: w.sceneId, text: 'Mara crossed the river.', origin: 'text' })
    const o = { db: w.db, model: modelFor(), signal: new AbortController().signal, closed: () => false }
    const label = (): string => 'Book 1, Ch 1'
    const first = nextRollUp(w.db, [w.storyId], label, o.model)!
    expect(first.level).toBe('chapter')
    expect(await writeRollUp(o, first)).toBe(true)
    const second = nextRollUp(w.db, [w.storyId], label, o.model)!
    expect(second.level).toBe('story')
    mem.putSummary(w.db, { level: 'story', targetId: w.storyId, text: 'Adam’s story summary.', origin: 'adam' })
    expect(nextRollUp(w.db, [w.storyId], label, o.model)?.level).not.toBe('story')
    expect(await writeRollUp(o, second)).toBe(false)
    expect(mem.getSummary(w.db, 'story', w.storyId)!.text).toBe('Adam’s story summary.')
  })

  it('undoing a summary brings back the old one and it is not written again from the same text', async () => {
    const w = world()
    save(w.db, w.sceneId, [['p1', longText(8)]])
    const o = { db: w.db, model: modelFor(), signal: new AbortController().signal, closed: () => false }
    await writeSceneSummary(o, w.sceneId, null, '')
    const line = lines(w.db).find((l) => l.what === 'summary')!
    w.db.transaction(() => undoItem(w.db, line.id))()
    expect(mem.getSummary(w.db, 'scene', w.sceneId)).toBeNull()
    expect(sceneSummaryDue(w.db, w.sceneId, true)).toBe(false)
  })
})

describe('the keeper', () => {
  function keeper(db: Database.Database, o: { quietMs?: number; model?: MemoryModel | null } = {}) {
    const statuses: MemoryStatus[] = []
    const changed: { sceneId: ID | null; entryIds: ID[] }[] = []
    const model = o.model === undefined ? modelFor() : o.model
    const k = new Keeper({
      db,
      model: () => model ?? { error: 'Choose a memory model in Settings > Models so the memory can keep up.' },
      emitStatus: (s) => statuses.push(s),
      emitChanged: (p) => changed.push(p),
      quietMs: o.quietMs ?? 20,
      summaries: false,
      retryDelays: [0]
    })
    return { k, statuses, changed }
  }

  it('reads a scene once there has been no save for a while, and says what it is doing', async () => {
    const w = world()
    const { k, statuses, changed } = keeper(w.db)
    k.start()
    const doc = (t: string) => ({
      type: 'doc',
      content: [{ type: 'paragraph', attrs: { pid: 'p1' }, content: [{ type: 'text', text: t }] }]
    })
    repo.saveSceneText(w.db, w.sceneId, doc('Mara lost'), 'Mara lost')
    k.sceneSaved(w.sceneId)
    repo.saveSceneText(w.db, w.sceneId, doc('Mara lost her left hand.'), 'Mara lost her left hand.')
    k.sceneSaved(w.sceneId)
    await new Promise((r) => setTimeout(r, 60))
    await k.whenIdle()
    expect(entryNamed(w.db, 'Mara')).not.toBeNull()
    expect(memoryCalls(w.db)).toBe(1)
    expect(statuses.some((s) => s.reading?.sceneId === w.sceneId)).toBe(true)
    expect(statuses[statuses.length - 1]).toMatchObject({ behind: 0, failed: 0, reading: null, error: null })
    expect(statuses[statuses.length - 1].lastUpdate?.changes).toBe(2)
    expect(changed.some((c) => c.sceneId === w.sceneId)).toBe(true)
    k.stop()
  })

  it('reads scenes left behind at start, and catches up earlier scenes before a draft', async () => {
    const w = world()
    const s2 = repo.createScene(w.db, w.chapterId, { title: 'Scene 2' }).id
    save(w.db, w.sceneId, [['p1', 'Mara lost her left hand.']])
    const { k } = keeper(w.db, { quietMs: 60_000 })
    await k.catchUpBefore(s2)
    expect(kdb.keeperScene(w.db, w.sceneId)!.memoryState).toBe('current')
    expect(entryNamed(w.db, 'Mara')).not.toBeNull()
    k.stop()

    const w2 = world()
    save(w2.db, w2.sceneId, [['p1', 'Tobin lost his hat.']])
    const second = keeper(w2.db)
    second.k.start()
    await second.k.whenIdle()
    expect(entryNamed(w2.db, 'Tobin')).not.toBeNull()
    second.k.stop()
  })

  it('without a memory model, says how to choose one', async () => {
    const w = world()
    save(w.db, w.sceneId, [['p1', 'Mara lost her left hand.']])
    const { k, statuses } = keeper(w.db, { model: null })
    k.start()
    await k.whenIdle()
    expect(statuses[statuses.length - 1]).toMatchObject({
      behind: 1,
      error: 'Choose a memory model in Settings > Models so the memory can keep up.'
    })
    k.stop()
  })

  it('marking a scene done reads it now', async () => {
    const w = world()
    save(w.db, w.sceneId, [['p1', 'Mara lost her left hand.']])
    const { k } = keeper(w.db, { quietMs: 60_000 })
    const meta = k.markDone(w.sceneId)
    expect(meta.status).toBe('done')
    expect(meta.acceptedAt).not.toBeNull()
    await k.whenIdle()
    expect(entryNamed(w.db, 'Mara')).not.toBeNull()
    k.stop()
  })

  it('stopping while a scene is read finishes its records and writes nothing after', async () => {
    const w = world()
    save(w.db, w.sceneId, [['p1', 'Mara lost her left hand.']])
    const { k } = keeper(w.db, { model: modelFor('fake/slow') })
    k.sceneLeft(w.sceneId)
    await new Promise((r) => setTimeout(r, 150))
    k.stop()
    const rows = w.db.prepare('SELECT status FROM generations').all() as { status: string }[]
    expect(rows.every((r) => r.status === 'stopped')).toBe(true)
    expect((w.db.prepare('SELECT status FROM memory_runs').all() as { status: string }[]).map((r) => r.status)).toEqual(['stopped'])
    w.db.close()
    await k.whenIdle()
  })
})
