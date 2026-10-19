// The check of new words against the scene's contract (long story memory fix 13), in check and repair's own call: each
// item answered kept, broken, not yet or untouched; what the words go against is asked with a rewrite of that sentence
// to review (never mended without asking), what must change and doesn't show yet is asked, and how each item came out
// is kept with the scene's check report. The model is a stand-in; the text is invented.
import type Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import type { ID } from '@shared/types'
import { memoryWorld } from '../../../tests/unit/helpers'
import * as repo from '../db/repo'
import * as gens from '../db/generations'
import * as cdb from '../db/checks'
import type { MemoryModel } from '../keeper/model'
import type { SceneContract } from '../ai/contract'
import { checkReport, saveReport } from '../checks/report'
import { checkNewWords, noteContract, resetRepairsForTests } from './index'
import { repairSystem, REPAIR_MARKER, REPAIR_SEND_ORDER } from './prompts'
import { NOT_SHOWN_RULE, SECOND_MARKER, secondRequest, SECOND_SYSTEM, secondSystem } from './second'
import {
  CONTRACT_RULES,
  contractCounts,
  contractResults,
  contractSection,
  judgeContract,
  notYetMessage,
  readContractAnswers,
  type ContractAnswer
} from './contract'

const model: MemoryModel = {
  target: { id: 'p1', name: 'Fake', kind: 'custom', baseUrl: 'http://127.0.0.1:9/v1', apiKey: 'test' },
  choice: { providerId: 'p1', modelId: 'fake/writer', label: 'fake', contextLength: 32000, promptPrice: null, completionPrice: null }
}

const ADAMS = 'Mara set the survey case on the sill.'
const AI = 'Tobin spoke at last. “The letter is real,” Ash said from the doorway.\n\nMara looked out at the weir.'

const CONTRACT: SceneContract = {
  asks: 'scene',
  items: [
    { code: 'C1', part: 'start', text: 'Mara is holding: nothing; the survey case on the sill', check: 'continuity', entryIds: [] },
    { code: 'C2', part: 'change', text: 'Tobin tells Mara the letter is forged', check: 'facts', entryIds: [] },
    { code: 'C3', part: 'change', text: 'Mara decides to go back to the mill', check: 'facts', entryIds: [] },
    { code: 'C4', part: 'keep', text: 'Ash is dead: drowned at the weir (since Ch 1, Sc 2)', check: 'facts', entryIds: ['ash'] }
  ]
}

const ANSWERS = {
  claims: [],
  contract: [
    { item: 'C1', result: 'untouched', quote: '' },
    { item: 'C2', result: 'not yet', quote: '' },
    { item: 'C3', result: 'not yet', quote: '' },
    {
      item: 'C4',
      result: 'broken',
      quote: '“The letter is real,” Ash said from the doorway.',
      why: 'Ash drowned at the weir in Ch 1, but here he speaks.',
      fix: { replace: 'Ash said from the doorway', with: 'Tobin said from the doorway' },
      question: ''
    }
  ]
}

/** The stand-in memory model: answers every request with `reply`, and keeps what it was asked. */
function answering(reply: unknown): typeof fetch & { asked: { system: string; user: string }[] } {
  const asked: { system: string; user: string }[] = []
  const f = (async (_input: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { messages: { content: string }[] }
    asked.push({ system: body.messages[0].content, user: body.messages[1].content })
    const chunk = { choices: [{ index: 0, delta: { content: JSON.stringify(reply) }, finish_reason: 'stop' }] }
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
  }) as typeof fetch & { asked: { system: string; user: string }[] }
  f.asked = asked
  return f
}

function world(ai = AI): { db: Database.Database; sceneId: ID; recordId: ID; ash: ID } {
  const db = memoryWorld()
  const story = repo.listStories(db)[0]
  const sceneId = repo.getOutline(db, story.id).scenes[0].id
  repo.createEntry(db, 'character', { name: 'Mara' })
  repo.createEntry(db, 'character', { name: 'Tobin' })
  const ash = repo.createEntry(db, 'character', { name: 'Ash' }).id
  const text = `${ADAMS}\n\n${ai}`
  repo.saveSceneText(db, sceneId, { type: 'doc', content: text.split('\n\n').map((t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })) }, text)
  const recordId = 'draft-1'
  gens.insertGeneration(db, {
    id: recordId,
    sceneId,
    job: 'draft',
    providerId: 'p1',
    providerName: 'Fake',
    modelId: 'fake/writer',
    params: { temperature: 1, top_p: 1, max_tokens: 1000 },
    direction: '',
    blocks: [],
    messages: [],
    budget: { contextLength: 0, reserved: 0, available: 0, used: 0 },
    entries: [],
    createdAt: '2026-10-16T09:00:00.000Z'
  })
  gens.finishGeneration(db, recordId, { status: 'complete', error: null, response: ai, promptTokens: 1, completionTokens: 1, cost: null, finishedAt: '2026-10-16T09:00:01.000Z' })
  return { db, sceneId, recordId, ash }
}

const landed = (sceneId: ID, recordId: ID, ai = AI) => ({
  sceneId,
  recordId,
  paragraphs: ai.split('\n\n').map((text) => ({ text, from: 0, to: text.length })),
  leadIn: ADAMS
})

const opts = (db: Database.Database, fetchImpl: typeof fetch) => ({ db, model, prefs: {} as never, closed: () => false, fetchImpl, retryDelays: [0] })

/** The contract with Ash's entry id in place of the stand-in's. */
const withAsh = (ash: ID): SceneContract => ({ ...CONTRACT, items: CONTRACT.items.map((i) => (i.code === 'C4' ? { ...i, entryIds: [ash] } : i)) })

afterEach(() => resetRepairsForTests())

describe('the contract in the check', () => {
  it('goes in as C lines, right before where things stand; its rules follow the check’s own, which are otherwise as before', () => {
    const { lines, section } = contractSection(CONTRACT)
    expect(lines.map((l) => [l.code, l.kind, l.label])).toEqual(CONTRACT.items.map((i) => [i.code, 'contract', i.text]))
    expect(section.text).toContain('Must be true at the start:\n- [C1] Mara is holding: nothing; the survey case on the sill')
    expect(section.text).toContain('Must change by the end of the scene:\n- [C2] Tobin tells Mara the letter is forged')
    expect(section.text).toContain('Must not change:\n- [C4] Ash is dead')
    expect(REPAIR_SEND_ORDER.indexOf('contract')).toBe(REPAIR_SEND_ORDER.indexOf('stage') - 1)
    expect(repairSystem(true)).toBe(`${repairSystem()}\n\n${CONTRACT_RULES}`)
    expect(repairSystem()).not.toContain('contract')
    // The second opinion names C lines only when a note cites one.
    expect(secondSystem()).toBe(SECOND_SYSTEM)
    expect(secondSystem(true)).toContain("the scene's contract (C lines")
    const note = { quote: 'x', who: '', about: 'other' as const, line: 'C4', verdict: 'slip' as const, bothTrue: 'no' as const, between: 'unclear' as const, why: 'w', fix: null, question: '' }
    expect(secondRequest([note], { material: '- [C4] Ash is dead', leadIn: '', newWords: 'x' }).messages[0].content).toBe(secondSystem(true))
    expect(secondRequest([{ ...note, line: 'W2' }], { material: '', leadIn: '', newWords: 'x' }).messages[0].content).toBe(SECOND_SYSTEM)
  })

  it('reads each answer once, however the model words the result; nothing from a reply without them', () => {
    const got = readContractAnswers(
      JSON.stringify({
        claims: [],
        contract: [
          { item: 'c1', result: 'Kept', quote: 'Mara set it down.' },
          { item: 'C2', result: 'not_yet' },
          { item: 'C2', result: 'kept' },
          { id: 'C3', verdict: 'FAIL', quote: 'q', fix: { replace: 'a', with: 'b' } },
          { item: 'C4', result: 'maybe' },
          { item: 'W2', result: 'kept' }
        ]
      })
    )
    expect(got.map((a) => [a.item, a.result])).toEqual([
      ['C1', 'kept'],
      ['C2', 'not yet'],
      ['C3', 'broken']
    ])
    expect(got[2].fix).toEqual({ replace: 'a', with: 'b' })
    expect(readContractAnswers(JSON.stringify({ claims: [] }))).toEqual([])
    expect(readContractAnswers('not json')).toEqual([])
  })

  it('a broken item only with words really in the new words; not yet only for what must change, never for Continue', () => {
    const a = (item: string, result: ContractAnswer['result'], quote = ''): ContractAnswer => ({ item, result, quote, why: 'w', fix: null, rewrite: '', question: '' })
    const j = judgeContract([a('C4', 'broken', '“The letter is real,” Ash said'), a('C2', 'not yet'), a('C1', 'not yet'), a('C3', 'broken', 'words not there')], CONTRACT, AI)
    expect(j.broken.map((c) => [c.line, c.verdict, c.bothTrue])).toEqual([['C4', 'slip', 'no']])
    expect(j.notYet.map((i) => i.code)).toEqual(['C2'])
    // Continue plays out what is under way: what it doesn't show yet isn't asked.
    expect(judgeContract([a('C2', 'not yet')], { ...CONTRACT, asks: 'continue' }, AI).notYet).toEqual([])
    // Most of its words are there after all: the model missed it.
    expect(judgeContract([a('C2', 'not yet')], CONTRACT, 'Tobin told Mara the letter was forged.').notYet).toEqual([])
    // How the words should read (a tone-only direction in a contract kept from before): never asked as not shown yet.
    const tone: SceneContract = { ...CONTRACT, items: CONTRACT.items.map((i) => (i.code === 'C2' ? { ...i, text: 'Make it darker' } : i)) }
    expect(judgeContract([a('C2', 'not yet')], tone, AI).notYet).toEqual([])
  })

  it('asks in plain words, and says how each item came out', () => {
    expect(notYetMessage('Tobin tells Mara the letter is forged', 'scene')).toBe(
      'This scene was planned to show this, but the new words don’t yet: “Tobin tells Mara the letter is forged.” Write it in, or leave it for later?'
    )
    expect(notYetMessage('Mara opens the hatch.', 'beat')).toContain('This beat was planned')
    const j = judgeContract(readContractAnswers(JSON.stringify(ANSWERS)), CONTRACT, AI)
    const items = contractResults(CONTRACT, j, { broken: new Set(['C4']), notYet: new Set(['C2', 'C3']) })
    expect(items.map((i) => i.result)).toEqual(['untouched', 'not yet', 'not yet', 'broken'])
    expect(items[3].quote).toBe('“The letter is real,” Ash said from the doorway.')
    expect(contractCounts(items)).toEqual({ items: 4, kept: 0, broken: 1, notYet: 2 })
    expect(contractResults(CONTRACT, { broken: [], notYet: [], said: new Map() }, { broken: new Set(), notYet: new Set() })[0].result).toBe('unchecked')
  })
})

describe('as the draft lands', () => {
  it('in the same call: the broken item asked with its rewrite to review, what doesn’t show yet asked, and the report kept', async () => {
    const { db, sceneId, recordId, ash } = world()
    noteContract(recordId, sceneId, withAsh(ash))
    const fetchImpl = answering(ANSWERS)
    const out = await checkNewWords(opts(db, fetchImpl), landed(sceneId, recordId))

    // The check's own call, with the contract; then the second opinion on the broken item (it rules nothing out).
    expect(fetchImpl.asked).toHaveLength(2)
    expect(fetchImpl.asked[0].system.startsWith(REPAIR_MARKER)).toBe(true)
    expect(fetchImpl.asked[0].system.endsWith(CONTRACT_RULES)).toBe(true)
    expect(fetchImpl.asked[0].user).toContain('## The scene’s contract (C ids)\nMust be true at the start:\n- [C1]')
    expect(fetchImpl.asked[1].system.startsWith(SECOND_MARKER)).toBe(true)
    expect(fetchImpl.asked[1].user).toContain('Line: [C4] Ash is dead')

    expect(out.fixes).toEqual([])
    expect(out.contract).toEqual({ items: 4, kept: 0, broken: 1, notYet: 2 })
    expect(out.questions).toBe(3)
    const rows = cdb.rowsInScenes(db, [sceneId])
    const broken = rows.find((r) => cdb.payloadOf(r).contract?.text.startsWith('Ash is dead'))!
    expect(broken).toMatchObject({ status: 'open', kind: 'fact', quote: '“The letter is real,” Ash said from the doorway.' })
    expect(broken.message).toBe('Ash drowned at the weir in Ch 1, but here he speaks. Change it, or keep it as it is?')
    expect(cdb.payloadOf(broken)).toMatchObject({ by: 'check', check: 'facts', fix: '“The letter is real,” Tobin said from the doorway.', sources: [{ kind: 'entry', entryId: ash, name: 'Ash' }] })
    const notYet = rows.filter((r) => cdb.payloadOf(r).contract?.part === 'change')
    expect(notYet.map((r) => [r.quote, r.message])).toEqual([
      ['', 'This scene was planned to show this, but the new words don’t yet: “Tobin tells Mara the letter is forged.” Write it in, or leave it for later?'],
      ['', 'This scene was planned to show this, but the new words don’t yet: “Mara decides to go back to the mill.” Write it in, or leave it for later?']
    ])
    // The issues say where they came from.
    const read = cdb.readIssue(broken, { entry: () => null, sceneLabel: () => null, storyTitle: () => null })
    expect(read.byContract).toBe(true)

    const report = checkReport(db, sceneId)!
    expect(report.contract!.asks).toBe('scene')
    expect(report.contract!.items.map((i) => [i.part, i.result])).toEqual([
      ['start', 'untouched'],
      ['change', 'not yet'],
      ['change', 'not yet'],
      ['keep', 'broken']
    ])
    // The critic's report after the draft keeps it.
    saveReport(db, { sceneId, after: 'draft', items: [{ check: 'facts', ok: true, note: 'Fine.' }], found: 0 })
    expect(checkReport(db, sceneId)!.contract!.items).toHaveLength(4)
  })

  it('a new whole draft that shows it settles what was asked; a question Adam ignored isn’t asked again', async () => {
    const { db, sceneId, recordId, ash } = world()
    noteContract(recordId, sceneId, withAsh(ash))
    await checkNewWords(opts(db, answering(ANSWERS)), landed(sceneId, recordId))
    const asked = (): string[] =>
      cdb
        .rowsInScenes(db, [sceneId])
        .filter((r) => r.status === 'open' && cdb.payloadOf(r).contract?.part === 'change')
        .map((r) => cdb.payloadOf(r).contract!.text)
    expect(asked()).toEqual(['Tobin tells Mara the letter is forged', 'Mara decides to go back to the mill'])
    // Adam says the second is meant to wait.
    const later = cdb.rowsInScenes(db, [sceneId]).find((r) => cdb.payloadOf(r).contract?.text === 'Mara decides to go back to the mill')!
    cdb.setIssueStatus(db, later.id as ID, 'ignored')

    // The scene drafted again: the letter is told now, and the rest still isn't shown.
    noteContract(recordId, sceneId, withAsh(ash))
    const again = {
      claims: [],
      contract: [
        { item: 'C2', result: 'kept', quote: 'Tobin spoke at last.' },
        { item: 'C3', result: 'not yet', quote: '' }
      ]
    }
    const out = await checkNewWords(opts(db, answering(again)), landed(sceneId, recordId))
    expect(asked()).toEqual([])
    expect(out.contract).toEqual({ items: 4, kept: 1, broken: 0, notYet: 1 })
    expect(cdb.rowsInScenes(db, [sceneId]).find((r) => r.id === later.id)!.status).toBe('ignored')
  })

  it('without a contract noted, the check is exactly as before', async () => {
    const { db, sceneId, recordId } = world()
    const fetchImpl = answering({ claims: [] })
    const out = await checkNewWords(opts(db, fetchImpl), landed(sceneId, recordId))
    expect(fetchImpl.asked[0].system).toBe(repairSystem())
    expect(fetchImpl.asked[0].user).not.toContain('contract')
    expect(out.contract).toBeUndefined()
    expect(checkReport(db, sceneId)).toBeNull()
  })
})

/** The stand-in memory model answering each request in turn with the next reply (the last one again after that). */
function answeringEach(replies: unknown[]): typeof fetch & { asked: { system: string; user: string }[] } {
  const asked: { system: string; user: string }[] = []
  const f = (async (_input: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { messages: { content: string }[] }
    asked.push({ system: body.messages[0].content, user: body.messages[1].content })
    const reply = replies[Math.min(asked.length - 1, replies.length - 1)]
    const chunk = { choices: [{ index: 0, delta: { content: JSON.stringify(reply) }, finish_reason: 'stop' }] }
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
  }) as typeof fetch & { asked: { system: string; user: string }[] }
  f.asked = asked
  return f
}

describe('after the review (fix 13)', () => {
  const asked = (db: Database.Database, sceneId: ID): string[] =>
    cdb
      .rowsInScenes(db, [sceneId])
      .filter((r) => r.status === 'open' && cdb.payloadOf(r).contract?.part === 'change')
      .map((r) => cdb.payloadOf(r).contract!.text)

  it('what isn’t shown yet goes to the second opinion too: shown in other words, it isn’t asked, and counts as kept', async () => {
    const { db, sceneId, recordId, ash } = world()
    noteContract(recordId, sceneId, withAsh(ash))
    // Notes in order: the broken item (C4), then what isn't shown (C2, C3). The letter is told after all, in other words.
    const verdicts = { verdicts: [{ n: 1, reason: 'Ash is dead.', real: true }, { n: 2, reason: 'Tobin spoke at last: he tells her.', real: false }, { n: 3, real: true }] }
    const fetchImpl = answeringEach([ANSWERS, verdicts])
    const out = await checkNewWords(opts(db, fetchImpl), landed(sceneId, recordId))

    expect(fetchImpl.asked).toHaveLength(2)
    expect(fetchImpl.asked[1].system).toContain(NOT_SHOWN_RULE)
    expect(fetchImpl.asked[1].user).toContain('1. Quote: "“The letter is real,” Ash said from the doorway."')
    expect(fetchImpl.asked[1].user).toContain('2. Not shown · Line: [C2] Tobin tells Mara the letter is forged')
    expect(asked(db, sceneId)).toEqual(['Mara decides to go back to the mill'])
    expect(out.contract).toEqual({ items: 4, kept: 1, broken: 1, notYet: 1 })
    expect(checkReport(db, sceneId)!.contract!.items.map((i) => i.result)).toEqual(['untouched', 'kept', 'not yet', 'broken'])
    // The broken item the second opinion agreed with is marked so (the chapter writer may put only such a one right); what
    // isn't shown is never written in by itself.
    const rows = cdb.rowsInScenes(db, [sceneId]).map((r) => cdb.payloadOf(r).contract)
    expect(rows.find((c) => c?.part === 'keep')).toMatchObject({ confirmed: true })
    expect(rows.find((c) => c?.part === 'change')).toMatchObject({ missing: true })
    expect(rows.find((c) => c?.part === 'change')!.confirmed).toBeUndefined()
  })

  it('only what isn’t shown yet: the second opinion still rules on it; a reply it can’t read leaves it asked', async () => {
    const { db, sceneId, recordId, ash } = world()
    noteContract(recordId, sceneId, withAsh(ash))
    const notYet = { claims: [], contract: [{ item: 'C2', result: 'not yet', quote: '' }] }
    const fetchImpl = answeringEach([notYet, 'I am not sure.'])
    await checkNewWords(opts(db, fetchImpl), landed(sceneId, recordId))
    expect(fetchImpl.asked).toHaveLength(2)
    expect(fetchImpl.asked[1].system.startsWith(SECOND_MARKER)).toBe(true)
    expect(asked(db, sceneId)).toEqual(['Tobin tells Mara the letter is forged'])
  })

  it('a whole new draft settles only what its reply answered: a reply that answers nothing settles nothing', async () => {
    const { db, sceneId, recordId, ash } = world()
    noteContract(recordId, sceneId, withAsh(ash))
    await checkNewWords(opts(db, answering(ANSWERS)), landed(sceneId, recordId))
    expect(asked(db, sceneId)).toEqual(['Tobin tells Mara the letter is forged', 'Mara decides to go back to the mill'])

    // Drafted again; the reply has no contract list at all, or answers an item there isn't.
    for (const reply of [{ claims: [] }, { claims: [], contract: [] }, { claims: [], contract: [{ item: 'C9', result: 'kept', quote: '' }] }]) {
      noteContract(recordId, sceneId, withAsh(ash))
      await checkNewWords(opts(db, answering(reply)), landed(sceneId, recordId))
      expect(asked(db, sceneId)).toEqual(['Tobin tells Mara the letter is forged', 'Mara decides to go back to the mill'])
    }
    // The report isn't changed by a reply that answered nothing.
    expect(checkReport(db, sceneId)!.contract!.items.map((i) => i.result)).toEqual(['untouched', 'not yet', 'not yet', 'broken'])

    // Answered for the letter only: that question goes; the mill's stays.
    noteContract(recordId, sceneId, withAsh(ash))
    await checkNewWords(opts(db, answering({ claims: [], contract: [{ item: 'C2', result: 'kept', quote: 'Tobin spoke at last.' }] })), landed(sceneId, recordId))
    expect(asked(db, sceneId)).toEqual(['Mara decides to go back to the mill'])
  })
})

// ---------- The direction receipt (2026-10-19): Adam's direction, ask by ask, in the same call ----------

describe('the direction’s asks in the check', () => {
  /** A whole scene drafted with the direction "Tobin tells Mara the letter is forged. More dialogue. Keep it under 30 words." */
  const ASKED: SceneContract = {
    asks: 'scene',
    items: [
      { code: 'C1', part: 'change', text: 'Tobin tells Mara the letter is forged', check: 'facts', entryIds: [], ask: 'event' },
      { code: 'C2', part: 'change', text: 'More dialogue', check: 'facts', entryIds: [], ask: 'reads' },
      { code: 'C3', part: 'change', text: 'Keep it under 30 words', check: 'facts', entryIds: [], ask: 'length' },
      { code: 'C4', part: 'change', text: 'Mara decides to go back to the mill', check: 'facts', entryIds: [] }
    ]
  }
  const a = (item: string, result: ContractAnswer['result'], quote = ''): ContractAnswer => ({ item, result, quote, why: '', fix: null, rewrite: '', question: '' })

  it('sends each ask but the one of length, which the app counts itself', () => {
    const { section, lines } = contractSection(ASKED)
    expect(section.text).toContain('- [C1] Tobin tells Mara the letter is forged\n- [C2] More dialogue\n- [C4] Mara decides')
    expect(section.text).not.toContain('30 words')
    expect(lines.map((l) => l.code)).toEqual(['C1', 'C2', 'C4'])
  })

  it('how it reads is never asked about; each ask keeps its kind, kept or not yet, in the report', () => {
    const j = judgeContract([a('C1', 'kept', 'Tobin spoke at last.'), a('C2', 'not yet'), a('C4', 'not yet')], ASKED, AI)
    // Only what must happen and isn't shown is asked; the length is counted (AI is 18 words: under 30).
    expect(j.notYet.map((i) => i.code)).toEqual(['C4'])
    expect(j.counted!.get('C3')).toBe('kept')
    const items = contractResults(ASKED, j, { broken: new Set(), notYet: new Set(['C4']) })
    expect(items.map((i) => [i.text, i.result, i.ask ?? null])).toEqual([
      ['Tobin tells Mara the letter is forged', 'kept', 'event'],
      ['More dialogue', 'not yet', 'reads'],
      ['Keep it under 30 words', 'kept', 'length'],
      ['Mara decides to go back to the mill', 'not yet', null]
    ])
    // Too long: the length ask isn't kept.
    expect(judgeContract([], ASKED, `${AI} ${'word '.repeat(20)}`).counted!.get('C3')).toBe('not yet')
  })

  it('as the draft lands: the report keeps the asks with the record they were checked for', async () => {
    const { db, sceneId, recordId } = world()
    noteContract(recordId, sceneId, ASKED)
    const fetchImpl = answering({ claims: [], contract: [{ item: 'C1', result: 'kept', quote: 'Tobin spoke at last.' }, { item: 'C2', result: 'not yet', quote: '' }, { item: 'C4', result: 'kept', quote: 'Mara looked out at the weir.' }] })
    const out = await checkNewWords(opts(db, fetchImpl), landed(sceneId, recordId))
    // No question for "more dialogue", nor a call more for it.
    expect(out.questions).toBe(0)
    expect(fetchImpl.asked).toHaveLength(1)
    expect(fetchImpl.asked[0].user).not.toContain('30 words')
    const report = checkReport(db, sceneId)!.contract!
    expect(report.recordId).toBe(recordId)
    expect(report.items.map((i) => [i.result, i.ask ?? null])).toEqual([
      ['kept', 'event'],
      ['not yet', 'reads'],
      ['kept', 'length'],
      ['kept', null]
    ])
  })
})
