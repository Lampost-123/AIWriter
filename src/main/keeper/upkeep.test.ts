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
import * as gens from '../db/generations'
import type { MemoryModel } from './model'
import { runScene, type RunOutcome } from './run'
import { Keeper } from './engine'
import { undoItem } from './undo'
import * as scene from '../memory/scene'

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

function keeperFor(db: Database.Database, model: MemoryModel | null = modelFor(), quietMs = 60_000): Keeper {
  return new Keeper({
    db,
    model: () => model ?? { error: 'Choose a memory model in Settings > Models so the memory can keep up.' },
    emitStatus: () => {},
    emitChanged: () => {},
    quietMs,
    summaries: false,
    retryDelays: [0]
  })
}

const state = (db: Database.Database, id: ID): string => kdb.keeperScene(db, id)!.memoryState

describe('catching up before a draft', () => {
  it('reads only the earlier scenes on the story’s line', async () => {
    const w = world()
    const s2 = repo.createScene(w.db, w.chapterId, { title: 'Scene 2' }).id
    const s3 = repo.createScene(w.db, w.chapterId, { title: 'Scene 3' }).id
    const whatIf = repo.createStory(w.db, { title: 'What if' })
    mem.setStoryPlacement(w.db, whatIf.id, {
      kind: 'own',
      startStoryId: null,
      startAt: 'end',
      startRefId: null,
      endAt: null,
      endRefId: null,
      leadsIntoId: null
    })
    const wiScene = repo.createScene(w.db, repo.createChapter(w.db, whatIf.id, { title: 'One' }).id, { title: 'Other' }).id
    save(w.db, w.sceneId, [['a', 'Mara lost her left hand.']])
    save(w.db, s2, [['b', 'Tobin lost his boots.']])
    save(w.db, s3, [['c', 'Kell lost his hat.']])
    save(w.db, wiScene, [['d', 'Wren lost her ring.']])
    const k = keeperFor(w.db)
    await k.catchUpBefore(s3)
    expect([state(w.db, w.sceneId), state(w.db, s2), state(w.db, s3), state(w.db, wiScene)]).toEqual([
      'current',
      'current',
      'pending',
      'pending'
    ])
    k.stop()
  })
})

describe('Adam typing while the keeper reads', () => {
  it('reads the scene again afterwards, once, with the new words', async () => {
    const w = world()
    save(w.db, w.sceneId, [['p1', 'Mara lost her left hand.']])
    const k = keeperFor(w.db, modelFor(), 30)
    let typed = false
    const slow: typeof fetch = async (input, init) => {
      if (!typed) {
        typed = true
        save(w.db, w.sceneId, [
          ['p1', 'Mara lost her left hand.'],
          ['p2', 'Tobin lost his boots.']
        ])
        k.sceneSaved(w.sceneId)
      }
      return fetch(input, init)
    }
    ;(k as unknown as { deps: { fetchImpl: typeof fetch } }).deps.fetchImpl = slow
    k.sceneLeft(w.sceneId)
    await new Promise((r) => setTimeout(r, 120))
    await k.whenIdle()
    expect(entryNamed(w.db, 'Mara')).not.toBeNull()
    expect(entryNamed(w.db, 'Tobin')).not.toBeNull()
    expect(state(w.db, w.sceneId)).toBe('current')
    const runs = w.db.prepare("SELECT status FROM memory_runs WHERE status = 'done'").all()
    expect(runs).toHaveLength(2)
    k.stop()
  })
})

describe('undo', () => {
  it('undoing twice is the same as once, and an undone removal stays undone after the next run', async () => {
    const w = world()
    save(w.db, w.sceneId, [
      ['p1', 'Mara lost her left hand.'],
      ['p2', 'Tobin lost his boots.']
    ])
    await read(w.db, w.sceneId)
    const mara = entryNamed(w.db, 'Mara')!
    const [c] = mem.changesForEntry(w.db, mara.id)
    // Delete Mara's words: the change goes. Undo that: it comes back, and stays.
    save(w.db, w.sceneId, [['p2', 'Tobin lost his boots. Mara walked away.']])
    await read(w.db, w.sceneId)
    expect(mem.changesForEntry(w.db, mara.id)).toHaveLength(0)
    const removed = kdb.listLog(w.db).find((l) => l.action === 'removed' && l.factId === c.id)!
    w.db.transaction(() => undoItem(w.db, removed.id))()
    w.db.transaction(() => undoItem(w.db, removed.id))()
    expect(mem.changesForEntry(w.db, mara.id)).toHaveLength(1)
    save(w.db, w.sceneId, [['p2', 'Tobin lost his boots. Mara walked away. The ferry was late.']])
    await read(w.db, w.sceneId)
    expect(mem.changesForEntry(w.db, mara.id)).toHaveLength(1)
  })

  it('an undone change stays undone when the scene is read again unchanged', async () => {
    const w = world()
    save(w.db, w.sceneId, [['p1', 'Mara lost her left hand.']])
    await read(w.db, w.sceneId)
    const line = kdb.listLog(w.db).find((l) => l.text === 'Lost her left hand')!
    w.db.transaction(() => undoItem(w.db, line.id))()
    // The same text saved again (and a re-read forced): nothing comes back.
    save(w.db, w.sceneId, [['p1', 'Mara lost her left hand.']])
    w.db.prepare("UPDATE scenes SET memory_paragraphs_json = '[]' WHERE id = ?").run(w.sceneId)
    await read(w.db, w.sceneId)
    expect(mem.listAllChanges(w.db)).toHaveLength(0)
  })
})

describe('the Trash', () => {
  it('keeps a text entry another scene still mentions, even one not read since', async () => {
    const w = world()
    const s2 = repo.createScene(w.db, w.chapterId, { title: 'Scene 2' }).id
    save(w.db, s2, [['q1', 'Kell sat by the fire.']])
    await read(w.db, s2) // nothing to add: Kell isn't an entry yet
    save(w.db, w.sceneId, [['p1', 'Kell lost his hat.']])
    await read(w.db, w.sceneId)
    const kell = entryNamed(w.db, 'Kell')!
    save(w.db, w.sceneId, [['p1', 'The ferry was late.']])
    await read(w.db, w.sceneId)
    expect(entryNamed(w.db, 'Kell')?.id).toBe(kell.id)
    // Linked to the words that still name him, so it goes when those do.
    expect(hist.linksForEntry(w.db, kell.id).filter((l) => l.state === 'ok')).toMatchObject([{ sceneId: s2, quote: 'Kell' }])
    save(w.db, s2, [['q1', 'The fire was out.']])
    await read(w.db, s2)
    expect(entryNamed(w.db, 'Kell')).toBeNull()
  })
})

describe('what the memory model is told', () => {
  it('nothing from a later scene, or from a what-if story', async () => {
    const w = world()
    const s2 = repo.createScene(w.db, w.chapterId, { title: 'Scene 2' }).id
    save(w.db, s2, [['q1', 'Mara lost her left hand.']])
    await read(w.db, s2)
    const whatIf = repo.createStory(w.db, { title: 'What if' })
    mem.setStoryPlacement(w.db, whatIf.id, {
      kind: 'own',
      startStoryId: w.storyId,
      startAt: 'end',
      startRefId: null,
      endAt: null,
      endRefId: null,
      leadsIntoId: null
    })
    const wiScene = repo.createScene(w.db, repo.createChapter(w.db, whatIf.id, { title: 'One' }).id, { title: 'Other' }).id
    save(w.db, wiScene, [['d', 'Mara learned that the Duke was dead.']])
    await read(w.db, wiScene)
    save(w.db, w.sceneId, [['p1', 'Mara walked to the ferry. Mara learned that the river was high.']])
    await read(w.db, w.sceneId)
    const sent = fake.lastRequest()!.body.messages.find((m) => m.role === 'user')!.content
    expect(sent).toContain('Mara')
    expect(sent).not.toContain('left hand')
    expect(sent).not.toContain('Duke')
  })

  it('a detail read in a what-if story or a prequel stays there', async () => {
    const w = world()
    const mara = repo.createEntry(w.db, 'character', { name: 'Mara' })
    const tobin = repo.createEntry(w.db, 'character', { name: 'Tobin' })
    const place = (kind: 'own' | 'prequel', title: string): ID => {
      const s = repo.createStory(w.db, { title })
      mem.setStoryPlacement(w.db, s.id, {
        kind,
        startStoryId: w.storyId,
        startAt: kind === 'own' ? 'end' : 'pre',
        startRefId: null,
        endAt: null,
        endRefId: null,
        leadsIntoId: kind === 'prequel' ? w.storyId : null
      })
      return repo.createScene(w.db, repo.createChapter(w.db, s.id, { title: 'One' }).id, { title: 'Opening' }).id
    }
    const whatIf = place('own', 'What if')
    const prequel = place('prequel', 'Before')
    const next = (id: ID): ID => repo.createScene(w.db, repo.sceneLocation(w.db, id).chapter.id, { title: 'Next' }).id
    const whatIfNext = next(whatIf)
    const prequelNext = next(prequel)
    // Book 1 has a second scene, after both stories were read.
    const book1Next = repo.createScene(w.db, w.chapterId, { title: 'Next' }).id
    save(w.db, whatIf, [['d', "Mara's eyes were green."]])
    await read(w.db, whatIf)
    save(w.db, prequel, [['e', "Tobin's eyes were brown."]])
    await read(w.db, prequel)
    // The entries as Book 1 sees them are untouched...
    expect(repo.getEntry(w.db, mara.id).fields.eyes ?? '').toBe('')
    expect(repo.getEntry(w.db, tobin.id).fields.eyes ?? '').toBe('')
    const book1 = scene.sceneMemory(w.db, book1Next).entries
    expect(book1.find((e) => e.id === mara.id)?.fields.eyes ?? '').toBe('')
    expect(book1.find((e) => e.id === tobin.id)?.fields.eyes ?? '').toBe('')
    // ...while each story knows its own, from that scene on.
    expect(scene.sceneMemory(w.db, whatIfNext).entries.find((e) => e.id === mara.id)?.fields.eyes).toBe('green')
    expect(scene.sceneMemory(w.db, prequelNext).entries.find((e) => e.id === tobin.id)?.fields.eyes).toBe('brown')
    expect(kdb.listLog(w.db).find((l) => l.entryId === mara.id)).toMatchObject({ action: 'added', text: 'Eyes: green' })
  })
})

describe('cost', () => {
  it('a small edit in a big world sends the changed words, not every name in the world', async () => {
    const w = world()
    const duke = repo.createEntry(w.db, 'character', { name: 'Duke Aldric' })
    w.db.transaction(() => {
      for (let i = 0; i < 1500; i++)
        repo.createEntry(w.db, i % 3 ? 'character' : 'place', { name: `Name${i} Surname${i}`, summary: 'Someone of note in the north.' })
    })()
    const paras: [string, string][] = Array.from({ length: 60 }, (_, i) => [
      `p${i}`,
      `The quay was wet and the gulls were loud, morning ${i}.`
    ])
    save(w.db, w.sceneId, paras)
    await read(w.db, w.sceneId, undefined, modelFor('fake/writer', 200_000))
    paras[30] = ['p30', 'The Duke rode in at noon.']
    save(w.db, w.sceneId, paras)
    await read(w.db, w.sceneId, undefined, modelFor('fake/writer', 200_000))
    const id = (w.db.prepare("SELECT id FROM generations WHERE job = 'memory' ORDER BY rowid DESC LIMIT 1").get() as { id: ID }).id
    const g = gens.getGeneration(w.db, id)
    expect(g.budget.used).toBeLessThan(4000)
    const sent = g.messages.find((m) => m.role === 'user')!.content
    expect(sent).toContain('P31: The Duke rode in at noon.')
    expect(sent).toContain('morning 29') // a little surrounding text
    expect(sent).not.toContain('morning 10')
    // A name sharing a word with the new words goes first, so the model can reuse that entry.
    expect(sent).toContain('"Duke Aldric"')
    expect(g.entries.map((e) => e.entryId)).toContain(duke.id)
    expect(g.entries.length).toBeLessThan(200)
  })
})
