// A verdict on each pay-off due here (overhaul, 2026-10-19). Live (16 Oct, DeepSeek Flash) threads stayed open after
// their payoff was on the page. Now each reading of a scene asks, for every open thread its card pays off or that is due
// now, whether the words read pay it off, move it on or leave it untouched, with the quote: "paid" closes it (even while a
// later card still plans the payoff, which is flagged instead), "moved" is a step on, and "untouched" on the card's own
// plan becomes a gentle question in Worth a look once the story has moved on past the scene. The fake memory model reads
// "Nobody knew who…", "At last the answer came: …", "In the end, …" and "Things moved on: …"; invented text throughout.

import type Database from 'better-sqlite3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ID } from '@shared/types'
import { emptySceneCard } from '@shared/defaults'
import { memoryWorld } from '../../../tests/unit/helpers'
import { startFakeProvider, type FakeProvider } from '../../../tests/fake-provider/server.mjs'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import * as kdb from '../db/keeper'
import type { MemoryModel } from './model'
import { runScene } from './run'
import { keepMemoryCheck, listMemoryChecks, planThread, removeMemoryCheck, undoMemoryCheck } from './checkQueue'
import { PAYOFF_ASKS, payoffAsks, payoffVerdict } from './oneReading'
import { buildRequest, planChunks, readingBudget } from './request'
import { memoryAt } from './places'
import { ONE_READING_MARKER, PAYOFFS_HEADING } from './prompts'
import { estimateTokens, textParas } from './text'
import { readingReply } from './json'

let fake: FakeProvider
beforeAll(async () => {
  fake = await startFakeProvider({ delayMs: 0 })
})
afterAll(() => fake.close())

type DB = Database.Database

const model = (): MemoryModel => ({
  target: { id: 'p1', name: 'Fake', kind: 'custom', baseUrl: fake.url, apiKey: 'test' },
  choice: { providerId: 'p1', modelId: 'fake/writer', label: 'fake/writer', contextLength: 32000, promptPrice: null, completionPrice: null }
})

/** A story with one chapter of three scenes, and with `chapters`, more chapters of one scene each. */
function world(chapters = 1): { db: DB; storyId: ID; chapters: ID[]; scenes: ID[] } {
  const db = memoryWorld()
  const story = repo.listStories(db)[0]
  const o = repo.getOutline(db, story.id)
  const first = o.chapters[0].id
  const scenes = [o.scenes[0].id, repo.createScene(db, first, { title: 'Two' }).id, repo.createScene(db, first, { title: 'Three' }).id]
  const ids = [first]
  for (let i = 1; i < chapters; i++) {
    const c = repo.createChapter(db, story.id, { title: `Part ${i + 1}` }).id
    ids.push(c)
    scenes.push(repo.createScene(db, c).id)
  }
  return { db, storyId: story.id, chapters: ids, scenes }
}

function save(db: DB, sceneId: ID, paras: [string, string][]): void {
  const doc = {
    type: 'doc',
    content: paras.map(([pid, text]) => ({ type: 'paragraph', attrs: { pid }, content: text ? [{ type: 'text', text }] : [] }))
  }
  repo.saveSceneText(db, sceneId, doc, paras.map(([, t]) => t).join('\n\n'))
  kdb.noteSceneSaved(db, sceneId)
}

const read = (db: DB, sceneId: ID, oneReading?: { summaryDue: () => boolean }) =>
  runScene({ db, model: model(), signal: new AbortController().signal, closed: () => false, retryDelays: [0, 0], ...(oneReading ? { oneReading } : {}) }, sceneId)

/** What the memory model was sent, oldest first. */
const sent = (db: DB): { system: string; user: string }[] =>
  (db.prepare('SELECT messages_json AS m FROM generations ORDER BY rowid').all() as { m: string }[]).map((r) => {
    const ms = JSON.parse(r.m) as { role: string; content: string }[]
    return { system: ms.find((m) => m.role === 'system')?.content ?? '', user: ms.find((m) => m.role === 'user')?.content ?? '' }
  })

const BELL = 'Who rang the drowned bell'
const OPEN = 'Nobody knew who rang the drowned bell.'
const PAYOFF = 'At last the answer came: the ferryman rang it for his drowned son.'
const ENDED = 'In the end, the ferryman rang it for his drowned son.'
const QUIET = 'Mara listened to the rain on the shutters.'

const bellOf = (db: DB): ID => repo.listEntries(db).find((e) => e.kind === 'thread' && e.name === BELL)!.id
const statuses = (db: DB, sceneId: ID): string[] =>
  mem
    .changesInScene(db, sceneId)
    .filter((c) => c.kind === 'thread')
    .map((c) => (c.kind === 'thread' ? c.payload.status : ''))
/** Scene n of the first chapter, in plain words, as Worth a look says it. */
const at = (db: DB, n: number): string => `${repo.listStories(db)[0].title}, Ch 1, Sc ${n}`
const paysOff = (db: DB, sceneId: ID, threadId: ID): unknown => repo.updateSceneCard(db, sceneId, { ...emptySceneCard(), paysOffIds: [threadId] })
const payoffItems = (db: DB) => listMemoryChecks(db).filter((i) => i.fact.kind === 'promise' && (i.fact.why === 'payoff' || i.fact.why === 'paid-before'))

/** The bell opened in the first scene. */
async function opened(chapters = 1): Promise<ReturnType<typeof world> & { bell: ID }> {
  const w = world(chapters)
  save(w.db, w.scenes[0], [['p1', OPEN]])
  await read(w.db, w.scenes[0])
  return { ...w, bell: bellOf(w.db) }
}

describe('which threads the reading is asked about', () => {
  it('asks about a thread this scene’s card pays off and one due by the end of this chapter, not one due later or dropped', async () => {
    const w = await opened(2)
    const other = repo.createEntry(w.db, 'thread', { name: 'The ferry toll' })
    const later = repo.createEntry(w.db, 'thread', { name: 'The lost ledger' })
    // Each opened in the first scene by Adam (a change pinned there), so they are open threads on the line.
    for (const t of [other, later])
      mem.insertChange(w.db, { kind: 'thread', payload: { status: 'open', note: '' }, entryId: t.id, anchor: 'scene', sceneId: w.scenes[0], origin: 'adam' })
    paysOff(w.db, w.scenes[1], w.bell)
    planThread(w.db, other.id, { payBy: w.chapters[0] })
    planThread(w.db, later.id, { payBy: w.chapters[1] })
    const asks = payoffAsks(w.db, w.scenes[1], repo.getScene(w.db, w.scenes[1]).card, memoryAt(w.db, w.storyId, w.scenes[1]))
    expect(asks).toEqual([
      { threadId: w.bell, why: 'card' },
      { threadId: other.id, why: 'due', overdue: false, dueBy: 'Ch 1' }
    ])
    // Dropped: never asked about.
    planThread(w.db, other.id, { dropped: true })
    expect(payoffAsks(w.db, w.scenes[1], repo.getScene(w.db, w.scenes[1]).card, memoryAt(w.db, w.storyId, w.scenes[1])).map((a) => a.threadId)).toEqual([w.bell])
    expect(PAYOFF_ASKS).toBe(4)
  })

  it('ends the request with a short block naming each by its E id, and sends nothing more when nothing is due', async () => {
    const w = await opened()
    const memory = memoryAt(w.db, w.storyId, w.scenes[1])
    const paras = textParas(QUIET)
    const budget = readingBudget({ contextLength: 32000, maxOutput: null })!
    const chunk = planChunks(paras, paras, [], budget)[0]
    const base = { where: 'Ch 1, Sc 2', title: '', card: emptySceneCard(), chunk, found: [], memory, budget }
    const alone = buildRequest(base)
    expect(alone.messages[1].content).not.toContain(PAYOFFS_HEADING)
    expect(alone.payoffs).toEqual([])
    const asked = buildRequest({ ...base, payoffs: [{ threadId: w.bell, why: 'card' }] })
    const user = asked.messages[1].content
    const id = asked.ids.byEntry.get(w.bell)!
    expect(user.endsWith(`- ${id} "${BELL}": this scene's card says it pays off here`)).toBe(true)
    // Everything before it is the request as it was (a provider's cache serves it), and it costs about a hundred tokens.
    expect(user.startsWith(alone.messages[1].content)).toBe(true)
    expect(estimateTokens(user) - estimateTokens(alone.messages[1].content)).toBeLessThan(130)
    expect(asked.messages[0].content).toBe(alone.messages[0].content)
    expect(asked.blocks.find((b) => b.id === 'payoffs')?.entryIds).toEqual([w.bell])
  })

  it('reads the verdicts forgivingly, and a reply without them is read as before', () => {
    expect(payoffVerdict('paid')).toBe('paid')
    expect(payoffVerdict('Paid off')).toBe('paid')
    expect(payoffVerdict('moved on')).toBe('moved')
    expect(payoffVerdict('untouched')).toBe('untouched')
    expect(payoffVerdict('maybe')).toBeNull()
    const r = readingReply({ facts: [], add: [], clashes: [] })
    expect(r.ok && r.reply).toEqual({ facts: [], add: [], clashes: [] })
    const p = readingReply({ facts: [], add: [], clashes: [], payoffs: [{ id: 'E1', is: 'paid' }, 'junk'] })
    expect(p.ok && p.reply.payoffs).toEqual([{ id: 'E1', is: 'paid' }])
  })
})

describe('"paid" closes the thread', () => {
  it('closes it where the words pay it off though a later card still plans it, and flags that card instead', async () => {
    const w = await opened()
    paysOff(w.db, w.scenes[1], w.bell)
    paysOff(w.db, w.scenes[2], w.bell)
    save(w.db, w.scenes[1], [['p1', PAYOFF]])
    await read(w.db, w.scenes[1])
    // Before, the later card's plan held it open (a note that it moved on); now the words win.
    expect(statuses(w.db, w.scenes[1])).toEqual(['resolved'])
    const [flag] = payoffItems(w.db)
    expect(flag).toMatchObject({
      group: 'promise',
      entryId: w.bell,
      entryName: BELL,
      fact: { kind: 'promise', threadId: w.bell, why: 'paid-before' },
      text: `Paid off in ${at(w.db, 2)}, though the scene card of ${at(w.db, 3)} still plans its pay-off. Take it off that card, or undo this pay-off on the board if it comes there instead.`,
      sceneId: w.scenes[1],
      quote: PAYOFF,
      canRemove: false
    })
    // Keep dismisses it (with Undo); taking the thread off the later card also settles it.
    const undo = keepMemoryCheck(w.db, flag.fact)
    expect(payoffItems(w.db)).toEqual([])
    undoMemoryCheck(w.db, undo)
    expect(payoffItems(w.db)).toHaveLength(1)
    repo.updateSceneCard(w.db, w.scenes[2], emptySceneCard())
    expect(payoffItems(w.db)).toEqual([])
  })

  it('closes a thread due now that the model read only as a step on', async () => {
    const w = await opened()
    planThread(w.db, w.bell, { payBy: w.chapters[0] })
    save(w.db, w.scenes[1], [['p1', ENDED]])
    await read(w.db, w.scenes[1])
    expect(statuses(w.db, w.scenes[1])).toEqual(['resolved'])
    const asked = sent(w.db).at(-1)!.user
    expect(asked).toContain(`"${BELL}": due by the end of this chapter`)
  })

  it('does the same in the one reading that also says where things stand and writes the summary', async () => {
    const w = await opened()
    paysOff(w.db, w.scenes[1], w.bell)
    save(w.db, w.scenes[1], [['p1', ENDED]])
    await read(w.db, w.scenes[1], { summaryDue: () => true })
    const last = sent(w.db).at(-1)!
    expect(last.system).toContain(ONE_READING_MARKER)
    expect(last.user).toContain(PAYOFFS_HEADING)
    expect(statuses(w.db, w.scenes[1])).toEqual(['resolved'])
    // One call for the scene: the verdict rode in the reading already made.
    expect(sent(w.db)).toHaveLength(2)
  })

  it('a step on of a thread due now stays a step on, with no question', async () => {
    const w = await opened()
    planThread(w.db, w.bell, { payBy: w.chapters[0] })
    save(w.db, w.scenes[1], [['p1', 'Things moved on: the tower door was found barred.']])
    await read(w.db, w.scenes[1])
    expect(statuses(w.db, w.scenes[1])).toEqual(['open'])
    expect(kdb.openPayoffNotes(w.db)).toEqual([])
  })
})

describe('"untouched" on the card’s own plan asks, gently', () => {
  it('asks "Did this scene pay it off?" once the story moves past the scene, and Keep leaves the thread open', async () => {
    const w = await opened()
    paysOff(w.db, w.scenes[1], w.bell)
    save(w.db, w.scenes[1], [['p1', QUIET]])
    await read(w.db, w.scenes[1])
    expect(statuses(w.db, w.scenes[1])).toEqual([])
    expect(kdb.openPayoffNotes(w.db)).toHaveLength(1)
    // Still the scene being written: not asked yet.
    expect(payoffItems(w.db)).toEqual([])
    save(w.db, w.scenes[2], [['p1', 'The tide came in.']])
    const [ask] = payoffItems(w.db)
    expect(ask).toMatchObject({
      group: 'promise',
      entryName: BELL,
      fact: { kind: 'promise', threadId: w.bell, why: 'payoff' },
      text: `Did ${at(w.db, 2)} pay this off? Its scene card plans the pay-off there, but the memory didn’t find it in the words.`,
      sceneId: w.scenes[1],
      where: at(w.db, 1),
      quote: '',
      canRemove: true
    })
    expect(ask.later?.map((c) => c.id)).toEqual([w.chapters[0]])
    keepMemoryCheck(w.db, ask.fact)
    expect(payoffItems(w.db)).toEqual([])
    // Read again whole: not asked again.
    save(w.db, w.scenes[1], [['p1', `${QUIET} Nothing else.`]])
    await read(w.db, w.scenes[1])
    expect(payoffItems(w.db)).toEqual([])
    expect(kdb.openPayoffNotes(w.db)).toEqual([])
  })

  it('goes once the words pay it off, and Mark as dropped drops the thread', async () => {
    const w = await opened()
    paysOff(w.db, w.scenes[1], w.bell)
    save(w.db, w.scenes[1], [['p1', QUIET]])
    await read(w.db, w.scenes[1])
    kdb.markSceneDone(w.db, w.scenes[1])
    const [ask] = payoffItems(w.db)
    expect(ask.fact).toMatchObject({ why: 'payoff' })
    const undo = removeMemoryCheck(w.db, ask.fact)
    expect(payoffItems(w.db)).toEqual([])
    undoMemoryCheck(w.db, undo)
    expect(payoffItems(w.db)).toHaveLength(1)
    // Adam adds the payoff below: only the new words are read, and they pay it off.
    save(w.db, w.scenes[1], [
      ['p1', QUIET],
      ['p2', PAYOFF]
    ])
    await read(w.db, w.scenes[1])
    expect(statuses(w.db, w.scenes[1])).toEqual(['resolved'])
    expect(payoffItems(w.db)).toEqual([])
    expect(kdb.openPayoffNotes(w.db)).toEqual([])
  })

  it('never asks from a reading of only some of the scene’s paragraphs', async () => {
    const w = await opened()
    save(w.db, w.scenes[1], [
      ['p1', QUIET],
      ['p2', 'The lamp guttered.']
    ])
    await read(w.db, w.scenes[1])
    // The card plans the pay-off here only now, and an edit of one paragraph is read alone.
    paysOff(w.db, w.scenes[1], w.bell)
    save(w.db, w.scenes[1], [
      ['p1', QUIET],
      ['p2', 'The lamp guttered and went out.']
    ])
    await read(w.db, w.scenes[1])
    expect(sent(w.db).at(-1)!.user).toContain(PAYOFFS_HEADING)
    expect(kdb.openPayoffNotes(w.db)).toEqual([])
  })
})
