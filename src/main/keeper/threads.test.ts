// The memory keeper manages plot threads (2026-10-08): it opens one with its promise and puts it on the scene card's
// "Sets up" (as the AI's), adds clues, notes a step on, and resolves one only when the payoff is on the page (and not
// while Adam's plan puts it later), putting it on "Pays off"; Undo takes a resolve back with its card link and stops the
// same words resolving it again. Adam's own facts and links are never changed. Invented story text throughout; the fake
// provider reads "Nobody knew who…", "A clue: …", "Things moved on: …" and "At last the answer came: …".

import type Database from 'better-sqlite3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ID } from '@shared/types'
import { emptySceneCard } from '@shared/defaults'
import { isAiLink } from '@shared/threadLinks'
import { memoryWorld } from '../../../tests/unit/helpers'
import { startFakeProvider, type FakeProvider } from '../../../tests/fake-provider/server.mjs'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import * as kdb from '../db/keeper'
import type { MemoryModel } from './model'
import { runScene } from './run'
import { undoItem } from './undo'
import { buildRequest, planChunks, readingBudget } from './request'
import { memoryAt } from './places'
import { clueList, lastClue, payoffLater, threadStep } from './threads'
import { textParas } from './text'
import { threadsBoardOf } from '../worldViews'

let fake: FakeProvider
beforeAll(async () => {
  fake = await startFakeProvider({ delayMs: 0 })
})
afterAll(() => fake.close())

const model = (): MemoryModel => ({
  target: { id: 'p1', name: 'Fake', kind: 'custom', baseUrl: fake.url, apiKey: 'test' },
  choice: { providerId: 'p1', modelId: 'fake/writer', label: 'fake/writer', contextLength: 32000, promptPrice: null, completionPrice: null }
})

/** A story with one chapter of three scenes (and, with `chapters`, more chapters of one scene each). */
function world(chapters = 1): { db: Database.Database; storyId: ID; scenes: ID[] } {
  const db = memoryWorld()
  const story = repo.listStories(db)[0]
  const o = repo.getOutline(db, story.id)
  const first = o.chapters[0].id
  const scenes = [o.scenes[0].id, repo.createScene(db, first, { title: 'Two' }).id, repo.createScene(db, first, { title: 'Three' }).id]
  for (let i = 1; i < chapters; i++) scenes.push(repo.createScene(db, repo.createChapter(db, story.id, { title: `Ch ${i + 1}` }).id).id)
  return { db, storyId: story.id, scenes }
}

function save(db: Database.Database, sceneId: ID, paras: [string, string][]): void {
  const doc = {
    type: 'doc',
    content: paras.map(([pid, text]) => ({ type: 'paragraph', attrs: { pid }, content: text ? [{ type: 'text', text }] : [] }))
  }
  repo.saveSceneText(db, sceneId, doc, paras.map(([, t]) => t).join('\n\n'))
  kdb.noteSceneSaved(db, sceneId)
}

const read = (db: Database.Database, sceneId: ID) =>
  runScene({ db, model: model(), signal: new AbortController().signal, closed: () => false, retryDelays: [0, 0] }, sceneId)

const threadNamed = (db: Database.Database, name: string) => repo.listEntries(db).find((e) => e.kind === 'thread' && e.name === name) ?? null
const threadChanges = (db: Database.Database, sceneId: ID) => mem.changesInScene(db, sceneId).filter((c) => c.kind === 'thread')
const card = (db: Database.Database, sceneId: ID) => repo.getScene(db, sceneId).card

const BELL = 'Who rang the drowned bell'
const OPEN = 'Nobody knew who rang the drowned bell.'
const PAYOFF = 'At last the answer came: the ferryman rang it for his drowned son.'

describe('the memory opens a plot thread', () => {
  it('makes it with its promise, pins the opening to the scene and puts it on the card as the AI’s', async () => {
    const w = world()
    save(w.db, w.scenes[0], [['p1', `The marsh was still at dusk. ${OPEN}`]])
    await read(w.db, w.scenes[0])
    const bell = threadNamed(w.db, BELL)!
    expect(bell).toMatchObject({ origin: 'text', fields: { promise: `${BELL}?` } })
    expect(bell.fieldOrigins?.promise ?? bell.origin).toBe('text')
    expect(threadChanges(w.db, w.scenes[0])).toEqual([expect.objectContaining({ entryId: bell.id, payload: { status: 'open', note: '' } })])
    const c = card(w.db, w.scenes[0])
    expect(c.setsUpIds).toEqual([bell.id])
    expect(isAiLink(c, 'setsUp', bell.id)).toBe(true)
    // On the board: open, set up here, found by the AI.
    expect(threadsBoardOf(w.db, w.storyId).threads.find((t) => t.id === bell.id)).toMatchObject({ column: 'open', aiMade: true, resolved: null })
  })

  it('a planned thread of Adam’s gets the opening and an empty promise, but never his own words', async () => {
    const w = world()
    const mine = repo.createEntry(w.db, 'thread', { name: BELL, fields: { promise: 'Mine: who rings it, and why at dusk?' } })
    save(w.db, w.scenes[0], [['p1', OPEN]])
    await read(w.db, w.scenes[0])
    const after = repo.getEntry(w.db, mine.id)
    expect(after.fields.promise).toBe('Mine: who rings it, and why at dusk?')
    expect(threadChanges(w.db, w.scenes[0]).map((c) => c.entryId)).toEqual([mine.id])
    expect(repo.listEntries(w.db).filter((e) => e.kind === 'thread')).toHaveLength(1)
    expect(threadsBoardOf(w.db, w.storyId).threads[0]).toMatchObject({ aiMade: false, column: 'open' })
  })

  it('never takes a link Adam made off his card, and an Undo takes only its own', async () => {
    const w = world()
    const mine = repo.createEntry(w.db, 'thread', { name: BELL })
    repo.updateSceneCard(w.db, w.scenes[0], { ...emptySceneCard(), setsUpIds: [mine.id] })
    save(w.db, w.scenes[0], [['p1', OPEN]])
    await read(w.db, w.scenes[0])
    expect(isAiLink(card(w.db, w.scenes[0]), 'setsUp', mine.id)).toBe(false)
    const line = kdb.listLog(w.db, { sceneId: w.scenes[0] }).find((l) => l.factId && (l.undo as { op?: string })?.op === 'change-added')!
    undoItem(w.db, line.id)
    expect(card(w.db, w.scenes[0]).setsUpIds).toEqual([mine.id])
  })
})

describe('clues and steps on', () => {
  it('adds each clue to the thread’s clues, from the text, and notes a step on', async () => {
    const w = world()
    save(w.db, w.scenes[0], [['p1', OPEN]])
    await read(w.db, w.scenes[0])
    save(w.db, w.scenes[1], [
      ['p1', 'A clue: wet footprints led up the bell tower stair.'],
      ['p2', 'A clue: the rope was still wet at noon.'],
      ['p3', 'Things moved on: the tower door was found barred.']
    ])
    await read(w.db, w.scenes[1])
    const bell = threadNamed(w.db, BELL)!
    expect(clueList(bell.fields.clues)).toEqual(['wet footprints led up the bell tower stair', 'the rope was still wet at noon'])
    expect(bell.fieldOrigins?.clues).toBe('text')
    expect(threadChanges(w.db, w.scenes[1])).toEqual([
      expect.objectContaining({ entryId: bell.id, payload: { status: 'open', note: 'the tower door was found barred' } })
    ])
    // The keeper is shown the open thread with its promise and last clue.
    const memory = memoryAt(w.db, w.storyId, w.scenes[2])
    expect(lastClue(memory.entries.find((e) => e.id === bell.id)!)).toBe('the rope was still wet at noon')
    const paras = textParas('Mara listened.')
    const budget = readingBudget({ contextLength: 32000, maxOutput: null })!
    const req = buildRequest({ where: 'Ch 1, Sc 3', title: '', card: emptySceneCard(), chunk: planChunks(paras, paras, [], budget)[0], found: [], memory, budget })
    expect(req.messages[1].content).toContain(`thread "${BELL}". promise: ${BELL}?; last clue: the rope was still wet at noon`)
  })

  it('Adam’s own clues are never changed: the clue is a note on the thread there instead', async () => {
    const w = world()
    save(w.db, w.scenes[0], [['p1', OPEN]])
    await read(w.db, w.scenes[0])
    const bell = threadNamed(w.db, BELL)!
    repo.updateEntry(w.db, bell.id, { fields: { ...bell.fields, clues: 'My clue: the sexton lies.' } })
    save(w.db, w.scenes[1], [['p1', 'A clue: a coin was left on the bell.']])
    await read(w.db, w.scenes[1])
    expect(repo.getEntry(w.db, bell.id).fields.clues).toBe('My clue: the sexton lies.')
    expect(mem.changesInScene(w.db, w.scenes[1])).toEqual([
      expect.objectContaining({ entryId: bell.id, kind: 'update', payload: expect.objectContaining({ note: 'Clue: a coin was left on the bell' }) })
    ])
  })
})

describe('resolving', () => {
  it('resolves it when the payoff is on the page, with the quote on the board, and Undo opens it again for good', async () => {
    const w = world()
    save(w.db, w.scenes[0], [['p1', OPEN]])
    await read(w.db, w.scenes[0])
    save(w.db, w.scenes[2], [['p1', PAYOFF]])
    await read(w.db, w.scenes[2])
    const bell = threadNamed(w.db, BELL)!
    expect(threadChanges(w.db, w.scenes[2])).toEqual([
      expect.objectContaining({ payload: { status: 'resolved', note: 'the ferryman rang it for his drowned son' }, origin: 'text' })
    ])
    expect(isAiLink(card(w.db, w.scenes[2]), 'paysOff', bell.id)).toBe(true)
    const t = threadsBoardOf(w.db, w.storyId).threads.find((x) => x.id === bell.id)!
    expect(t).toMatchObject({ column: 'resolved', resolved: { quote: PAYOFF, byAi: true } })
    expect(t.resolved?.undoId).toBeTruthy()

    // Undo from the board: open again, off the card, and the same words don't resolve it again.
    undoItem(w.db, t.resolved!.undoId!)
    expect(threadsBoardOf(w.db, w.storyId).threads.find((x) => x.id === bell.id)).toMatchObject({ column: 'open' })
    const after = card(w.db, w.scenes[2])
    expect(after.paysOffIds).toEqual([])
    expect(after.threadLinks?.[`paysOff:${bell.id}`]).toBe('undone')
    save(w.db, w.scenes[2], [['p2', PAYOFF]])
    await read(w.db, w.scenes[2])
    expect(threadChanges(w.db, w.scenes[2])).toEqual([])
  })

  it('ignores a resolve while a later scene card of Adam’s pays it off: it has only moved on', async () => {
    const w = world()
    save(w.db, w.scenes[0], [['p1', OPEN]])
    await read(w.db, w.scenes[0])
    const bell = threadNamed(w.db, BELL)!
    repo.updateSceneCard(w.db, w.scenes[2], { ...emptySceneCard(), paysOffIds: [bell.id] })
    save(w.db, w.scenes[1], [['p1', PAYOFF]])
    await read(w.db, w.scenes[1])
    expect(threadChanges(w.db, w.scenes[1])).toEqual([expect.objectContaining({ payload: { status: 'open', note: 'the ferryman rang it for his drowned son' } })])
    expect(card(w.db, w.scenes[1]).paysOffIds).toEqual([])
  })

  it('ignores a resolve while the thread’s payoff says it comes later', async () => {
    const w = world(3)
    save(w.db, w.scenes[0], [['p1', OPEN]])
    await read(w.db, w.scenes[0])
    const bell = threadNamed(w.db, BELL)!
    repo.updateEntry(w.db, bell.id, { fields: { ...bell.fields, payoff: 'In the finale, at the flood.' } })
    save(w.db, w.scenes[1], [['p1', PAYOFF]])
    await read(w.db, w.scenes[1])
    expect(threadChanges(w.db, w.scenes[1]).map((c) => c.payload)).toEqual([{ status: 'open', note: 'the ferryman rang it for his drowned son' }])
    // In the story's last chapter the finale is now.
    save(w.db, w.scenes[4], [['p1', PAYOFF]])
    await read(w.db, w.scenes[4])
    expect(threadChanges(w.db, w.scenes[4]).map((c) => c.payload.status)).toEqual(['resolved'])
  })
})

describe('the rules, by themselves', () => {
  it('reads the step forgivingly', () => {
    expect(threadStep('resolved')).toBe('resolved')
    expect(threadStep('Paid off')).toBe('resolved')
    expect(threadStep('clue')).toBe('clue')
    expect(threadStep('developing')).toBe('developing')
    expect(threadStep('open')).toBe('open')
    expect(threadStep(undefined)).toBe('open')
  })

  it('knows when a payoff comes later', () => {
    const at = { chapter: 3, chapters: 12, book: 1 }
    expect(payoffLater('In chapter 9, at the fair.', at)).toBe(true)
    expect(payoffLater('Chapter two', at)).toBe(false)
    expect(payoffLater('In Book 2', at)).toBe(true)
    expect(payoffLater('In the sequel', at)).toBe(true)
    expect(payoffLater('At the climax, on the bridge.', at)).toBe(true)
    expect(payoffLater('At the climax, on the bridge.', { chapter: 12, chapters: 12, book: 1 })).toBe(false)
    expect(payoffLater('She finds the letter.', at)).toBe(false)
    expect(payoffLater('', at)).toBe(false)
  })

  it('lists clues one a line and finds the last', () => {
    expect(clueList('- a coin\n- a wet rope')).toEqual(['a coin', 'a wet rope'])
    expect(lastClue({ fields: {}, happened: [{ note: 'Clue: a coin', where: '', changeId: 'c' }] })).toBe('a coin')
    expect(lastClue({ fields: { clues: 'a\nb' }, happened: [] })).toBe('b')
  })
})
