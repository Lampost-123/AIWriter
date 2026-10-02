// Review probes for the memory keeper (spec, "Source links and automatic upkeep").

import type Database from 'better-sqlite3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ID } from '@shared/types'
import { memoryWorld } from '../../../tests/unit/helpers'
import { startFakeProvider, type FakeProvider } from '../../../tests/fake-provider/server.mjs'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import * as hist from '../db/history'
import * as kdb from '../db/keeper'
import type { MemoryModel } from './model'
import { runScene, type RunOutcome } from './run'

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

function world(): { db: Database.Database; storyId: ID; chapterId: ID; sceneId: ID } {
  const db = memoryWorld()
  const story = repo.listStories(db)[0]
  const o = repo.getOutline(db, story.id)
  return { db, storyId: story.id, chapterId: o.chapters[0].id, sceneId: o.scenes[0].id }
}

function save(db: Database.Database, sceneId: ID, paras: [string, string][]): void {
  const doc = {
    type: 'doc',
    content: paras.map(([pid, text]) => ({ type: 'paragraph', attrs: { pid }, content: text ? [{ type: 'text', text }] : [] }))
  }
  repo.saveSceneText(db, sceneId, doc, paras.map(([, t]) => t).join('\n\n'))
  kdb.noteSceneSaved(db, sceneId)
}

/** Reads a scene; `during` runs while the memory model is being asked (Adam working meanwhile). */
const read = (db: Database.Database, sceneId: ID, during?: () => void, model: MemoryModel = modelFor()): Promise<RunOutcome> => {
  let done = false
  const fetchImpl: typeof fetch = (input, init) => {
    if (during && !done) {
      done = true
      during()
    }
    return fetch(input, init)
  }
  return runScene({ db, model, signal: new AbortController().signal, closed: () => false, retryDelays: [0, 0], fetchImpl }, sceneId)
}

const entryNamed = (db: Database.Database, name: string) => repo.listEntries(db).find((e) => e.name === name) ?? null

describe('Adam working while a scene is read', () => {
  it('his edit to another field during the run is kept when a detail is removed', async () => {
    const w = world()
    save(w.db, w.sceneId, [
      ['p1', "Kell's eyes were grey."],
      ['p2', 'Kell lost his hat.']
    ])
    await read(w.db, w.sceneId)
    const kell = entryNamed(w.db, 'Kell')!
    expect(kell.fields.eyes).toBe('grey')
    // The eyes sentence goes and a new paragraph is added; while the model reads it, Adam types Kell's hair.
    save(w.db, w.sceneId, [
      ['p2', 'Kell lost his hat.'],
      ['p3', 'Tobin lost his boots.']
    ])
    await read(w.db, w.sceneId, () => {
      const e = repo.getEntry(w.db, kell.id)
      repo.updateEntry(w.db, kell.id, { fields: { ...e.fields, hair: 'black' } })
    })
    const after = repo.getEntry(w.db, kell.id)
    expect(after.fields.hair).toBe('black')
    expect(after.fieldOrigins.hair).toBe('adam')
    expect(after.fields.eyes ?? '').toBe('')
  })

  it('a field he edits during the run is never removed by it', async () => {
    const w = world()
    save(w.db, w.sceneId, [
      ['p1', "Kell's eyes were grey."],
      ['p2', 'Kell lost his hat.']
    ])
    await read(w.db, w.sceneId)
    const kell = entryNamed(w.db, 'Kell')!
    save(w.db, w.sceneId, [
      ['p2', 'Kell lost his hat.'],
      ['p3', 'Tobin lost his boots.']
    ])
    await read(w.db, w.sceneId, () => {
      const e = repo.getEntry(w.db, kell.id)
      repo.updateEntry(w.db, kell.id, { fields: { ...e.fields, eyes: 'hazel' } })
    })
    expect(repo.getEntry(w.db, kell.id).fields.eyes).toBe('hazel')
  })

  it('a change he edits during the run is never removed by it', async () => {
    const w = world()
    save(w.db, w.sceneId, [
      ['p1', 'Mara lost her left hand.'],
      ['p2', 'The ferry was late.']
    ])
    await read(w.db, w.sceneId)
    const [c] = mem.listAllChanges(w.db)
    save(w.db, w.sceneId, [
      ['p2', 'The ferry was late.'],
      ['p3', 'Tobin lost his boots.']
    ])
    await read(w.db, w.sceneId, () => {
      mem.replaceChange(w.db, c.id, {
        kind: 'update',
        payload: { note: 'lost her left hand to the river' },
        entryId: c.entryId,
        anchor: 'scene',
        sceneId: w.sceneId,
        origin: 'adam'
      })
    })
    const now = mem.getChange(w.db, c.id)
    expect(now.origin).toBe('adam')
    expect(now.kind === 'update' && now.payload.note).toBe('lost her left hand to the river')
  })

  it('a change he deletes during the run doesn’t make the run fail', async () => {
    const w = world()
    save(w.db, w.sceneId, [['p1', 'Mara lost her left hand.']])
    await read(w.db, w.sceneId)
    const [c] = mem.listAllChanges(w.db)
    save(w.db, w.sceneId, [['p1', 'Mara lost her right hand.']])
    const out = await read(w.db, w.sceneId, () => mem.deleteChange(w.db, c.id))
    expect(out.status).toBe('done')
  })

  it('words typed during the run are read next time (the version read is the one marked)', async () => {
    const w = world()
    save(w.db, w.sceneId, [['p1', 'Mara lost her left hand.']])
    await read(w.db, w.sceneId, () =>
      save(w.db, w.sceneId, [
        ['p1', 'Mara lost her left hand.'],
        ['p2', 'Tobin lost his boots.']
      ])
    )
    const s = kdb.keeperScene(w.db, w.sceneId)!
    expect(s.memoryState).toBe('pending')
    expect(kdb.needsReading(w.db, w.sceneId)).toBe(true)
    expect(entryNamed(w.db, 'Tobin')).toBeNull()
    await read(w.db, w.sceneId)
    expect(entryNamed(w.db, 'Tobin')).not.toBeNull()
    expect(kdb.keeperScene(w.db, w.sceneId)!.memoryState).toBe('current')
  })
})

describe('links follow their words', () => {
  it('through a split, a merge and a move, and deleting the paragraph marks them gone', async () => {
    const w = world()
    save(w.db, w.sceneId, [
      ['p1', 'The ferry was late. Mara lost her left hand.'],
      ['p2', 'Tobin lost his boots.']
    ])
    await read(w.db, w.sceneId)
    const changes = () => mem.listAllChanges(w.db)
    expect(changes()).toHaveLength(2)
    const mara = changes().find((c) => c.kind === 'update' && c.payload.note === 'lost her left hand')!
    // Split p1: the words move to the new paragraph.
    save(w.db, w.sceneId, [
      ['p1', 'The ferry was late.'],
      ['p9', 'Mara lost her left hand.'],
      ['p2', 'Tobin lost his boots.']
    ])
    await read(w.db, w.sceneId)
    expect(hist.linksForFact(w.db, 'change', mara.id)[0]).toMatchObject({ paragraphId: 'p9', state: 'ok' })
    // Merge p9 into p2, and move p1 to the end.
    save(w.db, w.sceneId, [
      ['p2', 'Mara lost her left hand. Tobin lost his boots.'],
      ['p1', 'The ferry was late.']
    ])
    await read(w.db, w.sceneId)
    expect(hist.linksForFact(w.db, 'change', mara.id)[0]).toMatchObject({ paragraphId: 'p2', state: 'ok' })
    expect(changes()).toHaveLength(2)
    // Undo-like churn: back to the split, then the merge again.
    save(w.db, w.sceneId, [
      ['p1', 'The ferry was late.'],
      ['p9', 'Mara lost her left hand.'],
      ['p2', 'Tobin lost his boots.']
    ])
    save(w.db, w.sceneId, [
      ['p2', 'Mara lost her left hand. Tobin lost his boots.'],
      ['p1', 'The ferry was late.']
    ])
    await read(w.db, w.sceneId)
    expect(changes()).toHaveLength(2)
    // Delete the paragraph: both go.
    save(w.db, w.sceneId, [['p1', 'The ferry was late.']])
    await read(w.db, w.sceneId)
    expect(changes()).toHaveLength(0)
    expect(
      hist
        .linksInScene(w.db, w.sceneId)
        .filter((l) => l.factKind === 'change')
        .every((l) => l.state === 'gone')
    ).toBe(true)
  })
})

describe('two details of one entry lost in one run', () => {
  it('both go (removing the second doesn’t bring back the first)', async () => {
    const w = world()
    save(w.db, w.sceneId, [
      ['p1', 'Kell walked in.'],
      ['p2', 'His eyes were grey.'],
      ['p3', 'His hair was black.']
    ])
    await read(w.db, w.sceneId)
    const kell = repo.createEntry(w.db, 'character', { name: 'Kell', fields: { eyes: 'grey', hair: 'black' } }, { origin: 'text' })
    const link = (field: string, paragraphId: string, quote: string): void =>
      void hist.addLink(w.db, {
        factKind: 'field',
        factId: kell.id,
        field,
        sceneId: w.sceneId,
        sceneVersion: 1,
        paragraphId,
        start: 0,
        end: quote.length,
        quote
      })
    hist.addLink(w.db, {
      factKind: 'entry',
      factId: kell.id,
      field: null,
      sceneId: w.sceneId,
      sceneVersion: 1,
      paragraphId: 'p1',
      start: 0,
      end: 4,
      quote: 'Kell'
    })
    link('eyes', 'p2', 'His eyes were grey.')
    link('hair', 'p3', 'His hair was black.')
    save(w.db, w.sceneId, [['p1', 'Kell walked in.']])
    await read(w.db, w.sceneId)
    const after = repo.getEntry(w.db, kell.id)
    expect(after.fields.eyes ?? '').toBe('')
    expect(after.fields.hair ?? '').toBe('')
  })
})

describe('the "Memory updated" note and the What changed list', () => {
  it('names the newest run that changed something, and filters by scene', async () => {
    const w = world()
    const second = repo.createScene(w.db, w.chapterId, { title: 'Scene 2' }).id
    save(w.db, w.sceneId, [['p1', 'Mara lost her left hand.']])
    await read(w.db, w.sceneId)
    save(w.db, second, [['q1', 'Tobin lost his boots. Tobin learned that the ferry was cursed.']])
    const out = (await read(w.db, second)) as { runId: ID }
    // A failure afterwards doesn't count as an update.
    save(w.db, w.sceneId, [['p1', 'Mara lost her left hand. Kell lost his hat.']])
    await read(w.db, w.sceneId, undefined, modelFor('fake/memory-junk'))
    expect(kdb.lastUpdate(w.db)).toMatchObject({ runId: out.runId, changes: 3 })
    expect(kdb.listLog(w.db, { sceneId: w.sceneId }).map((l) => l.action)).toEqual(['failed', 'added', 'added'])
    expect(kdb.listLog(w.db, { sceneId: second }).every((l) => l.runId === out.runId)).toBe(true)
  })
})
