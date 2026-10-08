// World memory follows the words (World Memory Overhaul, part A): what the memory keeper does with facts when the words
// they were read from are added, edited or deleted, when the memory model says nothing about them, and what the writer
// is given meanwhile. All text is invented. The memory model is the fake one (tests/fake-provider), with its reply
// shaped per test: no paid calls.

import Database from 'better-sqlite3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ID } from '@shared/types'
import { defaultWritingPrefs } from '@shared/defaults'
import { memoryWorld } from '../../../tests/unit/helpers'
import { fakeMemoryReply, startFakeProvider, type FakeProvider } from '../../../tests/fake-provider/server.mjs'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import * as hist from '../db/history'
import * as kdb from '../db/keeper'
import { MIGRATIONS, migrate } from '../db/migrations'
import type { MemoryModel } from './model'
import { runScene, type RunOutcome } from './run'
import { READING_MARKER } from './prompts'
import { undoItem } from './undo'
import { sceneMemory } from '../memory/scene'
import { gatherContextInput } from '../ai/gather'
import { mustStayTrue } from '../ai/mustStay'

let fake: FakeProvider
beforeAll(async () => {
  fake = await startFakeProvider({ delayMs: 0 })
})
afterAll(() => fake.close())

type DB = Database.Database

function modelFor(): MemoryModel {
  return {
    target: { id: 'p1', name: 'Fake', kind: 'custom', baseUrl: fake.url, apiKey: 'test' },
    choice: { providerId: 'p1', modelId: 'fake/writer', label: 'fake', contextLength: 32000, promptPrice: null, completionPrice: null }
  }
}

function world() {
  const db = memoryWorld()
  const story = repo.listStories(db)[0]
  const o = repo.getOutline(db, story.id)
  const sceneId = o.scenes[0].id
  // A later scene, for what the writer is given after the first one.
  const later = repo.createScene(db, o.chapters[0].id, { title: 'Scene 2' }).id
  return { db, storyId: story.id, chapterId: o.chapters[0].id, sceneId, later }
}

function save(db: DB, sceneId: ID, paras: [string, string][]): void {
  const doc = {
    type: 'doc',
    content: paras.map(([pid, text]) => ({ type: 'paragraph', attrs: { pid }, content: text ? [{ type: 'text', text }] : [] }))
  }
  repo.saveSceneText(db, sceneId, doc, paras.map(([, t]) => t).join('\n\n'))
  kdb.noteSceneSaved(db, sceneId)
}

const textOf = (c: unknown): string =>
  typeof c === 'string' ? c : Array.isArray(c) ? c.map((p) => (typeof p?.text === 'string' ? p.text : '')).join('') : ''

interface ReadOptions {
  /** 'fake': the fake model's own verdicts; 'none': it gives no verdict on facts whose words changed. */
  verdicts?: 'fake' | 'none'
  /** Items added to its reply, entries named by name (mapped to their short ids when the request lists them). */
  add?: Record<string, unknown>[]
  /** The model reports nothing at all. */
  nothing?: boolean
}

/** Reads a scene with the fake memory model, its reply shaped by `o`. The requests it saw are returned too. */
async function read(db: DB, sceneId: ID, o: ReadOptions = {}): Promise<RunOutcome & { asked: string[] }> {
  const asked: string[] = []
  const fetchImpl: typeof fetch = async (input, init) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { messages?: { role: string; content: unknown }[] }
    const system = textOf(body.messages?.find((m) => m.role === 'system')?.content)
    if (!system.includes(READING_MARKER)) return fetch(input, init)
    const user = textOf(body.messages?.find((m) => m.role === 'user')?.content)
    asked.push(user)
    const reply = o.nothing
      ? { facts: [], add: [], clashes: [] }
      : (JSON.parse(fakeMemoryReply(user)) as { facts: unknown[]; add: Record<string, unknown>[]; clashes: unknown[] })
    if (o.verdicts === 'none') reply.facts = []
    const ids = new Map([...user.matchAll(/^- (E\d+) [a-z]+ "([^"]+)"/gm)].map((m) => [m[2], m[1]]))
    const map = (v: unknown): unknown => (typeof v === 'string' ? (ids.get(v) ?? v) : v)
    for (const a of o.add ?? []) reply.add.push({ ...a, entry: map(a.entry), involved: Array.isArray(a.involved) ? a.involved.map(map) : a.involved })
    const chunk = { choices: [{ index: 0, delta: { content: JSON.stringify(reply) }, finish_reason: 'stop' }] }
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
  }
  const out = await runScene(
    { db, model: modelFor(), signal: new AbortController().signal, closed: () => false, retryDelays: [0, 0], fetchImpl },
    sceneId
  )
  return { ...out, asked }
}

const named = (db: DB, name: string) => repo.listEntries(db).find((e) => e.name === name) ?? null
const changesOf = (db: DB, name: string) => {
  const e = named(db, name)
  return e ? mem.changesForEntry(db, e.id) : []
}
const notes = (db: DB, name: string): string[] => changesOf(db, name).map((c) => (c.kind === 'update' ? c.payload.note : c.kind))
const changeLinks = (db: DB, id: ID) => hist.linksForFact(db, 'change', id)
/** What the writer is given for a scene: the briefing's memory, as gathered for a draft. */
const writerMemory = (db: DB, sceneId: ID) =>
  gatherContextInput(db, sceneId, undefined, { prefs: defaultWritingPrefs(), contextLength: 32000, creativity: 'balanced' }).memory
const writerEntry = (db: DB, sceneId: ID, name: string) => writerMemory(db, sceneId).entries.find((e) => e.name === name) ?? null
/** The "must stay true" list the writer would get for these people at a later scene. */
const mustLines = (db: DB, sceneId: ID, names: string[]): string[] => {
  const m = writerMemory(db, sceneId)
  return mustStayTrue({
    stand: null,
    reach: 'later',
    people: names.map((n) => m.entries.find((e) => e.name === n)!).filter(Boolean),
    named: [],
    facts: m.facts,
    sceneId,
    storyTitle: '',
    places: {}
  })
}
const removedLines = (db: DB) => kdb.listLog(db, { limit: 50 }).filter((l) => l.action === 'removed')

const MARA_RIVER = 'Mara lost her knife in the river.'

describe('a fact read from the text', () => {
  it('appears with its origin and a link to its words, and its entry’s summary is linked too', async () => {
    const w = world()
    save(w.db, w.sceneId, [
      ['p1', 'The ferry was late.'],
      ['p2', MARA_RIVER]
    ])
    await read(w.db, w.sceneId)
    const mara = named(w.db, 'Mara')!
    expect(mara.origin).toBe('text')
    const [c] = changesOf(w.db, 'Mara')
    expect(c.origin).toBe('text')
    expect(changeLinks(w.db, c.id).map((l) => [l.state, l.quote, l.paragraphId])).toEqual([['ok', MARA_RIVER, 'p2']])
    const links = hist.linksForEntry(w.db, mara.id)
    expect(links.some((l) => l.factKind === 'entry' && l.state === 'ok')).toBe(true)
    // A2: the summary a new entry is made with has words too.
    expect(links.some((l) => l.factKind === 'summary' && l.field === 'summary' && l.state === 'ok')).toBe(true)
  })

  it('is updated when its words are edited and the model gives the new value', async () => {
    const w = world()
    save(w.db, w.sceneId, [
      ['p1', 'The ferry was late.'],
      ['p2', MARA_RIVER]
    ])
    await read(w.db, w.sceneId)
    save(w.db, w.sceneId, [
      ['p1', 'The ferry was late.'],
      ['p2', 'Mara lost her knife on the bank.']
    ])
    await read(w.db, w.sceneId)
    const [c] = changesOf(w.db, 'Mara')
    expect(notes(w.db, 'Mara')).toEqual(['lost her knife on the bank'])
    expect(changeLinks(w.db, c.id).map((l) => [l.state, l.quote])).toEqual([['ok', 'Mara lost her knife on the bank.']])
  })

  it('goes, with its entry, when its words are deleted (the model is not even asked)', async () => {
    const w = world()
    save(w.db, w.sceneId, [
      ['p1', 'The ferry was late.'],
      ['p2', MARA_RIVER]
    ])
    await read(w.db, w.sceneId)
    save(w.db, w.sceneId, [['p1', 'The ferry was late.']])
    const out = await read(w.db, w.sceneId, { nothing: true })
    expect(out.asked).toEqual([])
    expect(named(w.db, 'Mara')).toBeNull()
    expect(removedLines(w.db).map((l) => l.text)).toEqual(
      expect.arrayContaining(['Lost her knife in the river: those words were deleted', 'Moved to Trash: no scene mentions it any more'])
    )
  })
})

describe('when the model says nothing', () => {
  it('about new words: nothing is added and the scene still counts as read', async () => {
    const w = world()
    save(w.db, w.sceneId, [['p1', MARA_RIVER]])
    const out = await read(w.db, w.sceneId, { nothing: true })
    expect(out.status).toBe('done')
    expect(repo.listEntries(w.db)).toEqual([])
    expect(kdb.keeperScene(w.db, w.sceneId)!.memoryState).toBe('current')
  })

  it('about edited words: the fact is weakened (kept for now, left out for the writer), then goes after one more read', async () => {
    const w = world()
    save(w.db, w.sceneId, [
      ['p1', 'Mara laughed at the ferryman.'],
      ['p2', MARA_RIVER]
    ])
    await read(w.db, w.sceneId)
    const [c] = changesOf(w.db, 'Mara')
    expect(writerEntry(w.db, w.later, 'Mara')!.fields.marks).toContain('knife')

    // Edited so the fact's words are gone, and the model gives no verdict.
    save(w.db, w.sceneId, [
      ['p1', 'Mara laughed at the ferryman.'],
      ['p2', 'The knife slipped from her belt into the reeds.']
    ])
    const first = await read(w.db, w.sceneId, { verdicts: 'none' })
    // It was asked about, with an id it could answer to.
    expect(first.asked.join('\n')).toMatch(/^- F\d+ change E\d+: lost her knife in the river.*\| words, no longer in the scene/m)
    expect(changesOf(w.db, 'Mara').map((x) => x.id)).toEqual([c.id])
    const [link] = changeLinks(w.db, c.id)
    expect(link.state).toBe('changed')
    expect(link.checks).toBe(1)
    expect(link.changedAt).toBeTruthy()
    // The writer isn't told it while it is unconfirmed.
    expect(writerEntry(w.db, w.later, 'Mara')!.fields.marks ?? '').not.toContain('knife')
    expect(mustLines(w.db, w.later, ['Mara']).join('\n')).not.toContain('knife')
    // The memory itself (what the keeper and Adam see) still has it.
    expect(sceneMemory(w.db, w.later).entries.find((e) => e.name === 'Mara')!.fields.marks).toContain('knife')

    // One more read (another paragraph edited), still no verdict: it goes, with Undo.
    save(w.db, w.sceneId, [
      ['p1', 'Mara laughed at the old ferryman.'],
      ['p2', 'The knife slipped from her belt into the reeds.']
    ])
    const second = await read(w.db, w.sceneId, { verdicts: 'none' })
    expect(second.asked.join('\n')).toMatch(/^- F\d+ change E\d+: lost her knife in the river/m)
    expect(changesOf(w.db, 'Mara')).toEqual([])
    const line = removedLines(w.db).find((l) => l.factId === c.id)!
    expect(line.text).toMatch(/^Lost her knife in the river: /)
    expect(named(w.db, 'Mara')).not.toBeNull()

    // Undo brings it back, and it isn't taken away again by the next read.
    undoItem(w.db, line.id)
    expect(changesOf(w.db, 'Mara').map((x) => x.id)).toEqual([c.id])
    save(w.db, w.sceneId, [
      ['p1', 'Mara laughed at the ferryman again.'],
      ['p2', 'The knife slipped from her belt into the reeds.']
    ])
    await read(w.db, w.sceneId, { verdicts: 'none' })
    expect(changesOf(w.db, 'Mara').map((x) => x.id)).toEqual([c.id])
  })

  it('a fact left unconfirmed goes when its words are then deleted', async () => {
    const w = world()
    save(w.db, w.sceneId, [
      ['p1', 'Mara laughed at the ferryman.'],
      ['p2', MARA_RIVER]
    ])
    await read(w.db, w.sceneId)
    save(w.db, w.sceneId, [
      ['p1', 'Mara laughed at the ferryman.'],
      ['p2', 'The knife slipped from her belt into the reeds.']
    ])
    await read(w.db, w.sceneId, { nothing: true })
    expect(notes(w.db, 'Mara')).toEqual(['lost her knife in the river'])
    // The edited paragraph is deleted.
    save(w.db, w.sceneId, [['p1', 'Mara laughed at the ferryman.']])
    await read(w.db, w.sceneId, { nothing: true })
    expect(notes(w.db, 'Mara')).toEqual([])
    // And when Mara's last words go, so does she.
    save(w.db, w.sceneId, [['p1', 'The ferryman laughed.']])
    await read(w.db, w.sceneId, { nothing: true })
    expect(named(w.db, 'Mara')).toBeNull()
  })

  it('a keep verdict whose words aren’t in the scene leaves the fact unconfirmed', async () => {
    const w = world()
    save(w.db, w.sceneId, [
      ['p1', 'Mara laughed at the ferryman.'],
      ['p2', MARA_RIVER]
    ])
    await read(w.db, w.sceneId)
    const [c] = changesOf(w.db, 'Mara')
    save(w.db, w.sceneId, [
      ['p1', 'Mara laughed at the ferryman.'],
      ['p2', 'The knife slipped from her belt into the reeds.']
    ])
    // The model says keep, but gives words that aren't in the scene at all.
    const fetchFacts = (user: string) => [...user.matchAll(/^- (F\d+) change/gm)].map((m) => ({ id: m[1], do: 'keep', quote: 'She lost it.' }))
    const asked: string[] = []
    await runScene(
      {
        db: w.db,
        model: modelFor(),
        signal: new AbortController().signal,
        closed: () => false,
        retryDelays: [0, 0],
        fetchImpl: async (_input, init) => {
          const body = JSON.parse(String(init?.body ?? '{}')) as { messages: { role: string; content: unknown }[] }
          const user = textOf(body.messages.find((m) => m.role === 'user')?.content)
          asked.push(user)
          const reply = { facts: fetchFacts(user), add: [], clashes: [] }
          const chunk = { choices: [{ index: 0, delta: { content: JSON.stringify(reply) }, finish_reason: 'stop' }] }
          return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
        }
      },
      w.sceneId
    )
    expect(asked).toHaveLength(1)
    const [link] = changeLinks(w.db, c.id)
    expect([link.state, link.checks]).toEqual(['changed', 1])
  })
})

describe('what Adam made himself', () => {
  it('survives every edit and deletion of the words, and the writer always has it', async () => {
    const w = world()
    const oskar = repo.createEntry(w.db, 'character', { name: 'Oskar', summary: 'A lamplighter.', fields: { eyes: 'brown' } })
    const own = mem.insertChange(w.db, {
      kind: 'update',
      payload: { note: 'burned his hand', fields: { marks: 'burned right hand' } },
      entryId: oskar.id,
      anchor: 'scene',
      sceneId: w.sceneId,
      origin: 'adam'
    })
    save(w.db, w.sceneId, [
      ['p1', "Oskar's eyes were green."],
      ['p2', 'Oskar burned his hand on the lamp.']
    ])
    await read(w.db, w.sceneId)
    save(w.db, w.sceneId, [
      ['p1', "Oskar's eyes were grey."],
      ['p2', 'Oskar warmed his hands at the lamp.']
    ])
    await read(w.db, w.sceneId, { verdicts: 'none' })
    save(w.db, w.sceneId, [['p3', 'The street was dark.']])
    await read(w.db, w.sceneId, { verdicts: 'none' })
    save(w.db, w.sceneId, [['p3', 'The street was dark and empty.']])
    await read(w.db, w.sceneId, { verdicts: 'none' })
    const after = named(w.db, 'Oskar')!
    expect(after.id).toBe(oskar.id)
    expect(after.summary).toBe('A lamplighter.')
    expect(after.fields.eyes).toBe('brown')
    expect(mem.getChange(w.db, own.id).payload).toEqual({ note: 'burned his hand', fields: { marks: 'burned right hand' } })
    expect(writerEntry(w.db, w.later, 'Oskar')!.fields.marks).toBe('burned right hand')
    expect(mustLines(w.db, w.later, ['Oskar']).join('\n')).toContain('burned right hand')
  })
})

describe('what was read from the text and then edited by Adam', () => {
  it('keeps his words while the source words are there, and goes when they go', async () => {
    const w = world()
    save(w.db, w.sceneId, [
      ['p1', "Kell's eyes were grey."],
      ['p2', MARA_RIVER],
      ['p3', 'The ferry was late.']
    ])
    await read(w.db, w.sceneId)
    const kell = named(w.db, 'Kell')!
    repo.updateEntry(w.db, kell.id, { fields: { ...kell.fields, eyes: 'grey-green' } })
    const [c] = changesOf(w.db, 'Mara')
    mem.replaceChange(w.db, c.id, {
      kind: 'update',
      payload: { note: 'lost her knife in the river Sel', fields: { marks: 'knife lost' } },
      entryId: c.entryId,
      anchor: 'scene',
      sceneId: w.sceneId,
      origin: 'adam'
    })
    // A read of something else leaves his values as they are, and the writer has them.
    save(w.db, w.sceneId, [
      ['p1', "Kell's eyes were grey."],
      ['p2', MARA_RIVER],
      ['p3', 'The ferry was very late.']
    ])
    await read(w.db, w.sceneId)
    expect(named(w.db, 'Kell')!.fields.eyes).toBe('grey-green')
    expect(writerEntry(w.db, w.later, 'Kell')!.fields.eyes).toBe('grey-green')
    expect(writerEntry(w.db, w.later, 'Mara')!.fields.marks).toBe('knife lost')
    // The words go: so do his edited values (with Undo), and the entries nothing mentions any more.
    save(w.db, w.sceneId, [['p3', 'The ferry was very late.']])
    await read(w.db, w.sceneId)
    expect(mem.listAllChanges(w.db).some((x) => x.id === c.id)).toBe(false)
    expect(named(w.db, 'Kell')?.fields.eyes ?? '').toBe('')
    expect(named(w.db, 'Kell')).toBeNull()
    expect(named(w.db, 'Mara')).toBeNull()
    expect(kdb.listLog(w.db).filter((l) => l.question)).toEqual([])
  })
})

describe('a text fact Adam edited whose words now say something else', () => {
  it('keeps his words with a question, rests on the new words, and isn’t asked about again at every read', async () => {
    const w = world()
    save(w.db, w.sceneId, [
      ['p1', MARA_RIVER],
      ['p2', 'The ferry was late.']
    ])
    await read(w.db, w.sceneId)
    const [c] = changesOf(w.db, 'Mara')
    mem.replaceChange(w.db, c.id, {
      kind: 'update',
      payload: { note: 'lost her knife in the river Sel' },
      entryId: c.entryId,
      anchor: 'scene',
      sceneId: w.sceneId,
      origin: 'adam'
    })
    save(w.db, w.sceneId, [
      ['p1', 'Mara lost her knife on the bank.'],
      ['p2', 'The ferry was late.']
    ])
    await read(w.db, w.sceneId)
    expect(notes(w.db, 'Mara')).toEqual(['lost her knife in the river Sel'])
    expect(kdb.listLog(w.db).filter((l) => l.question).map((l) => l.question!.text)).toEqual(['Keep your words?'])
    expect(changeLinks(w.db, c.id).map((l) => [l.state, l.quote])).toEqual([['ok', 'Mara lost her knife on the bank.']])
    save(w.db, w.sceneId, [
      ['p1', 'Mara lost her knife on the bank.'],
      ['p2', 'The ferry was very late.']
    ])
    const next = await read(w.db, w.sceneId)
    expect(next.asked.join('\n')).not.toMatch(/Facts whose words changed/)
    expect(notes(w.db, 'Mara')).toEqual(['lost her knife in the river Sel'])
  })
})

describe('an entry’s summary whose words are deleted while the entry is still mentioned (Adam, 2026-10-08)', () => {
  it('is kept, the writer still sees it, and the next read asks the model once to revise it from what is left', async () => {
    const w = world()
    const lamps = 'Oskar lit the harbour lamps every night.'
    save(w.db, w.sceneId, [
      ['p1', lamps],
      ['p2', 'Oskar waited by the gate.']
    ])
    await read(w.db, w.sceneId, {
      add: [{ type: 'entry', kind: 'character', name: 'Oskar', summary: 'A lamplighter at the harbour.', quote: lamps }]
    })
    const oskar = named(w.db, 'Oskar')!
    const summaryLinks = () => hist.linksForEntry(w.db, oskar.id).filter((l) => l.factKind === 'summary')
    expect(summaryLinks().map((l) => l.state)).toEqual(['ok'])
    // The words the summary rests on go; Oskar is still in the scene.
    save(w.db, w.sceneId, [['p2', 'Oskar waited by the gate.']])
    await read(w.db, w.sceneId)
    expect(named(w.db, 'Oskar')!.summary).toBe('A lamplighter at the harbour.')
    expect(writerEntry(w.db, w.later, 'Oskar')!.summary).toBe('A lamplighter at the harbour.')
    expect(summaryLinks().map((l) => [l.state, l.paragraphId])).toEqual([['changed', 'p2']])
    expect(removedLines(w.db).filter((l) => l.entryId === oskar.id)).toEqual([])
    // The next read asks about it; the model doesn't revise it, so the old one stays (now resting on no words).
    save(w.db, w.sceneId, [['p2', 'Oskar waited by the old gate.']])
    const next = await read(w.db, w.sceneId)
    expect(next.asked.join('\n')).toMatch(/^- F\d+ summary E\d+: A lamplighter at the harbour/m)
    expect(named(w.db, 'Oskar')!.summary).toBe('A lamplighter at the harbour.')
    expect(summaryLinks()).toEqual([])
    // And it isn't asked about again.
    save(w.db, w.sceneId, [['p2', 'Oskar waited by the old gate again.']])
    expect((await read(w.db, w.sceneId)).asked.join('\n')).not.toMatch(/summary E\d+/)
  })
})

describe('an event', () => {
  const event = (summary: string, quote: string) => ({ type: 'event', name: 'The river crossing', summary, involved: ['Mara'], quote })

  it('gets a link for its summary, which follows the words when the event is reported again', async () => {
    const w = world()
    save(w.db, w.sceneId, [
      ['p1', 'The ferry was late.'],
      ['p2', MARA_RIVER]
    ])
    await read(w.db, w.sceneId, { add: [event('Mara lost her knife in the river.', MARA_RIVER)] })
    const ev = named(w.db, 'The river crossing')!
    expect(hist.linksForEntry(w.db, ev.id).filter((l) => l.factKind === 'summary').map((l) => [l.state, l.quote])).toEqual([['ok', MARA_RIVER]])
    save(w.db, w.sceneId, [
      ['p1', 'The ferry was late.'],
      ['p2', 'Mara lost her knife on the bank.']
    ])
    await read(w.db, w.sceneId, { add: [event('Mara dropped her knife on the bank.', 'Mara lost her knife on the bank.')] })
    const after = named(w.db, 'The river crossing')!
    expect(after.id).toBe(ev.id)
    expect(after.summary).toBe('Mara dropped her knife on the bank.')
    const links = hist.linksForEntry(w.db, ev.id)
    expect(links.filter((l) => l.factKind === 'summary').map((l) => [l.state, l.quote])).toEqual([['ok', 'Mara lost her knife on the bank.']])
    expect(links.filter((l) => l.factKind === 'entry').every((l) => l.state === 'ok')).toBe(true)
    expect(kdb.listLog(w.db).some((l) => l.entryId === ev.id && l.action === 'updated' && l.after === 'Mara dropped her knife on the bank.')).toBe(true)
  })

  it('has its summary revised when the model says so', async () => {
    const w = world()
    save(w.db, w.sceneId, [
      ['p1', 'The ferry was late.'],
      ['p2', MARA_RIVER]
    ])
    await read(w.db, w.sceneId, { add: [event('Mara lost her knife in the river.', MARA_RIVER)] })
    save(w.db, w.sceneId, [
      ['p1', 'The ferry was late.'],
      ['p2', 'Mara lost her knife in the reeds.']
    ])
    const out = await read(w.db, w.sceneId, {
      add: [{ type: 'summary', entry: 'The river crossing', summary: 'Mara lost her knife in the reeds.', quote: 'Mara lost her knife in the reeds.' }]
    })
    // The model is told about the summary whose words changed, and that it may revise one.
    expect(out.asked.join('\n')).toMatch(/^- F\d+ summary E\d+: Mara lost her knife in the river/m)
    expect(named(w.db, 'The river crossing')!.summary).toBe('Mara lost her knife in the reeds.')
  })

  it('goes to the Trash when its words go, even after an edit it wasn’t reported for', async () => {
    const w = world()
    save(w.db, w.sceneId, [
      ['p1', 'The ferry was late. Mara watched the water.'],
      ['p2', MARA_RIVER]
    ])
    await read(w.db, w.sceneId, { add: [event('Mara lost her knife in the river.', MARA_RIVER)] })
    save(w.db, w.sceneId, [
      ['p1', 'The ferry was late. Mara watched the water.'],
      ['p2', 'The water rose over the steps.']
    ])
    await read(w.db, w.sceneId, { verdicts: 'none' })
    save(w.db, w.sceneId, [['p1', 'The ferry was late. Mara watched the water.']])
    await read(w.db, w.sceneId, { verdicts: 'none' })
    expect(named(w.db, 'The river crossing')).toBeNull()
    expect(named(w.db, 'Mara')).not.toBeNull()
  })

  it('goes to the Trash when its words go after it was reported again for an edit', async () => {
    const w = world()
    save(w.db, w.sceneId, [
      ['p1', 'The ferry was late.'],
      ['p2', MARA_RIVER]
    ])
    await read(w.db, w.sceneId, { add: [event('Mara lost her knife in the river.', MARA_RIVER)] })
    save(w.db, w.sceneId, [
      ['p1', 'The ferry was late.'],
      ['p2', 'Mara lost her knife on the bank.']
    ])
    await read(w.db, w.sceneId, { add: [event('Mara dropped her knife on the bank.', 'Mara lost her knife on the bank.')] })
    save(w.db, w.sceneId, [['p1', 'The ferry was late.']])
    await read(w.db, w.sceneId)
    expect(named(w.db, 'The river crossing')).toBeNull()
    expect(named(w.db, 'Mara')).toBeNull()
  })
})

describe('the world file', () => {
  it('gains the link columns when an older world opens, and a link already marked changed counts as changed since then', () => {
    const db = new Database(':memory:')
    db.exec(MIGRATIONS[0])
    db.exec(MIGRATIONS[1])
    db.pragma('user_version = 2')
    db.prepare(
      `INSERT INTO source_links (id, fact_kind, fact_id, field, scene_id, scene_version, paragraph_id, start, end, quote, state, created_at, updated_at)
       VALUES ('l1', 'change', 'c1', NULL, 's1', 1, 'p1', 0, 5, 'words', 'changed', '2026-01-01', '2026-01-02')`
    ).run()
    migrate(db)
    const cols = (db.prepare('PRAGMA table_info(source_links)').all() as { name: string }[]).map((c) => c.name)
    expect(cols).toEqual(expect.arrayContaining(['changed_at', 'checks']))
    const [l] = hist.linksForFact(db, 'change', 'c1')
    expect([l.state, l.checks, l.changedAt]).toEqual(['changed', 0, '2026-01-02'])
    db.close()
  })
})
