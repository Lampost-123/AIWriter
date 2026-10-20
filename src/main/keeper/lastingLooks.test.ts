// What the story sets someone to wear from now on reaches the writer chapters and days later (memory review, 2026-10-20:
// Mary was told in Ch 3, Sc 2 to wear only a green jumper, and Ch 4 and 5 forgot it). The scene is read by the fake memory
// model with a change added to its reply; the later scene's briefing is then built as a draft's is. Invented text only.
import type Database from 'better-sqlite3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ID } from '@shared/types'
import { memoryWorld } from '../../../tests/unit/helpers'
import { startFakeProvider, type FakeProvider } from '../../../tests/fake-provider/server.mjs'
import * as repo from '../db/repo'
import * as kdb from '../db/keeper'
import type { MemoryModel } from './model'
import { runScene } from './run'
import { READING_MARKER } from './prompts'
import { gatherContextInput } from '../ai/gather'
import { assembleContext, MUST_BLOCK } from '../ai/context'
import { countRaw } from '../ai/tokens'
import { sceneMemory } from '../memory/scene'

let fake: FakeProvider
beforeAll(async () => {
  fake = await startFakeProvider({ delayMs: 0 })
})
afterAll(() => fake.close())

const model = (): MemoryModel => ({
  target: { id: 'p1', name: 'Fake', kind: 'custom', baseUrl: fake.url, apiKey: 'test' },
  choice: { providerId: 'p1', modelId: 'fake/writer', label: 'fake/writer', contextLength: 32000, promptPrice: null, completionPrice: null }
})

function save(db: Database.Database, sceneId: ID, paras: [string, string][]): void {
  const doc = { type: 'doc', content: paras.map(([pid, text]) => ({ type: 'paragraph', attrs: { pid }, content: [{ type: 'text', text }] })) }
  repo.saveSceneText(db, sceneId, doc, paras.map(([, t]) => t).join('\n\n'))
  kdb.noteSceneSaved(db, sceneId)
}

/** Reads a scene with the fake model, adding these items to its reply. */
async function readWith(db: Database.Database, sceneId: ID, add: Record<string, unknown>[]): Promise<void> {
  const fetchImpl: typeof fetch = async (input, init) => {
    const res = await fetch(input, init)
    const body = JSON.parse(String(init?.body ?? '{}')) as { messages?: { role: string; content: string }[] }
    if (!body.messages?.some((m) => m.role === 'system' && m.content.includes(READING_MARKER))) return res
    const text = (await res.text())
      .split('\n')
      .filter((l) => l.startsWith('data: {'))
      .map((l) => (JSON.parse(l.slice(6)) as { choices?: { delta?: { content?: string } }[] }).choices?.[0]?.delta?.content ?? '')
      .join('')
    const reply = JSON.parse(text) as { add: Record<string, unknown>[] }
    reply.add.push(...add)
    const chunk = { choices: [{ index: 0, delta: { content: JSON.stringify(reply) }, finish_reason: 'stop' }] }
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
  }
  await runScene({ db, model: model(), signal: new AbortController().signal, closed: () => false, retryDelays: [0, 0], fetchImpl }, sceneId)
}

const ORDER = '“From now on you wear the green jumper and nothing else,” Ana told Mary.'
const PREFS = { spelling: 'UK' as const, pov: '', tense: '', voiceNotes: '', avoidWords: [] }

describe('what the story sets someone to wear, chapters and days later', () => {
  it('is in what must stay true and in her profile as a fact, though the model said it as "nothing but"', async () => {
    const db = memoryWorld()
    const story = repo.listStories(db)[0]
    const o = repo.getOutline(db, story.id)
    const told = o.scenes[0].id
    const ch2 = repo.createChapter(db, story.id, { title: 'Later' }).id
    const later = repo.createScene(db, ch2, { title: 'Market day' }).id
    save(db, told, [
      ['a', 'Mary lost her hat. Ana lost her bag.'],
      ['b', ORDER]
    ])
    await readWith(db, told, [
      { type: 'change', entry: 'Mary', note: 'told to wear only the green jumper from now on', fields: { clothing: 'nothing but the green jumper' }, quote: ORDER }
    ])
    const mary = repo.listEntries(db).find((e) => e.name === 'Mary')!
    repo.updateSceneCard(db, told, { ...repo.getScene(db, told).card, when: 'Day 1, evening', povId: mary.id, presentIds: [mary.id] })
    repo.updateSceneCard(db, later, { ...repo.getScene(db, later).card, when: 'Day 4, morning', povId: mary.id, presentIds: [mary.id], beats: ['Mary goes to market.'] })

    const input = gatherContextInput(db, later, undefined, { prefs: PREFS, contextLength: null, creativity: 'steady' })
    const blocks = assembleContext(input, countRaw).blocks
    const text = (id: string): string => blocks.find((b) => b.id === id)?.text ?? ''
    expect(text(MUST_BLOCK)).toContain('Mary usually wears: the green jumper')
    const pov = text('pov')
    expect(pov).toContain('Typical clothing: the green jumper')
    expect(pov.indexOf('Typical clothing')).toBeLessThan(pov.indexOf('Details to show') < 0 ? Infinity : pov.indexOf('Details to show'))
  })
})

describe('an order or suggestion someone is to follow (memory review, 2026-10-20)', () => {
  const GIVEN = '“You will wear only one shoe until I say awake,” Ana told Mary.'
  const LIFTED = '“Awake,” said Ana, and Mary put her other shoe back on.'

  it('is told in what must stay true chapters later, until the story lifts it', async () => {
    const db = memoryWorld()
    const story = repo.listStories(db)[0]
    const o = repo.getOutline(db, story.id)
    const given = o.scenes[0].id
    const ch2 = repo.createChapter(db, story.id, { title: 'Later' }).id
    const later = repo.createScene(db, ch2, { title: 'Market day' }).id
    const ch3 = repo.createChapter(db, story.id, { title: 'Last' }).id
    const lifted = repo.createScene(db, ch3, { title: 'Awake' }).id
    const last = repo.createScene(db, ch3, { title: 'After', afterId: lifted }).id
    save(db, given, [
      ['a', 'Mary lost her hat. Ana lost her bag.'],
      ['b', GIVEN]
    ])
    const fact = 'Mary must wear only one shoe until Ana says awake'
    await readWith(db, given, [{ type: 'said', kind: 'rule', entry: 'Ana', heard: ['Mary'], fact, quote: GIVEN }])
    const mary = repo.listEntries(db).find((e) => e.name === 'Mary')!
    for (const [id, when] of [
      [given, 'Day 1, evening'],
      [later, 'Day 4, morning'],
      [lifted, 'Day 5, noon'],
      [last, 'Day 6, morning']
    ] as const)
      repo.updateSceneCard(db, id, { ...repo.getScene(db, id).card, when, povId: mary.id, presentIds: [mary.id], beats: ['Mary goes to market.'] })
    const must = (id: ID): string =>
      assembleContext(gatherContextInput(db, id, undefined, { prefs: PREFS, contextLength: null, creativity: 'steady' }), countRaw).blocks.find((b) => b.id === MUST_BLOCK)
        ?.text ?? ''
    expect(must(later)).toContain(`Mary is to follow: ${fact} (given by Ana)`)

    // The story lifts it: the memory ends the fact, and from then on it is no longer told.
    save(db, lifted, [['a', LIFTED]])
    const factId = sceneMemory(db, lifted).facts.find((f) => f.fact === fact)!.factId
    await readWith(db, lifted, [{ type: 'end', entry: 'Mary', fact, quote: LIFTED }])
    expect(sceneMemory(db, last).facts.find((f) => f.factId === factId)?.rule?.bound ?? []).toEqual([])
    expect(must(last)).not.toContain('to follow')
    // Still told where it was in force.
    expect(must(later)).toContain('Mary is to follow')
  })
  it('binds her though she no longer remembers it, and can still be lifted', async () => {
    const db = memoryWorld()
    const story = repo.listStories(db)[0]
    const o = repo.getOutline(db, story.id)
    const given = o.scenes[0].id
    const ch2 = repo.createChapter(db, story.id, { title: 'Later' }).id
    const later = repo.createScene(db, ch2, { title: 'Market day' }).id
    const lifted = repo.createScene(db, ch2, { title: 'Awake', afterId: later }).id
    const last = repo.createScene(db, ch2, { title: 'After', afterId: lifted }).id
    const FORGOT = 'Mary woke and remembered nothing of it.'
    save(db, given, [
      ['a', 'Mary lost her hat. Ana lost her bag.'],
      ['b', GIVEN],
      ['c', FORGOT]
    ])
    const fact = 'Mary must wear only one shoe until Ana says awake'
    await readWith(db, given, [
      { type: 'said', kind: 'rule', entry: 'Ana', heard: ['Mary'], fact, quote: GIVEN },
      { type: 'knows', entry: 'Mary', fact, forgets: true, quote: FORGOT }
    ])
    const mary = repo.listEntries(db).find((e) => e.name === 'Mary')!
    for (const id of [given, later, lifted, last])
      repo.updateSceneCard(db, id, { ...repo.getScene(db, id).card, povId: mary.id, presentIds: [mary.id], beats: ['Mary goes to market.'] })
    const at = sceneMemory(db, later).facts.find((f) => f.fact === fact)
    expect(at?.knownBy).not.toContain(mary.id)
    expect(at?.rule?.bound).toEqual([mary.id])
    const must = (id: ID): string =>
      assembleContext(gatherContextInput(db, id, undefined, { prefs: PREFS, contextLength: null, creativity: 'steady' }), countRaw).blocks.find((b) => b.id === MUST_BLOCK)
        ?.text ?? ''
    expect(must(later)).toContain('Mary is to follow')
    save(db, lifted, [['a', LIFTED]])
    await readWith(db, lifted, [{ type: 'end', entry: 'Mary', fact, quote: LIFTED }])
    expect(must(last)).not.toContain('to follow')
  })
  it('binds only the one it is given to, not everyone in the room, though they go by more than a first name; one whose time is up ends', async () => {
    const db = memoryWorld()
    const story = repo.listStories(db)[0]
    const o = repo.getOutline(db, story.id)
    const given = o.scenes[0].id
    const ch2 = repo.createChapter(db, story.id, { title: 'Later' }).id
    const next = repo.createScene(db, ch2, { title: 'Next' }).id
    const after = repo.createScene(db, ch2, { title: 'After', afterId: next }).id
    const SIT = '“And you will not sit down until morning,” Ana told Mary.'
    const last = repo.createScene(db, ch2, { title: 'Last', afterId: after }).id
    save(db, given, [
      ['a', 'Mary lost her hat. Ana lost her bag. Tobin lost his oar.'],
      ['b', GIVEN],
      ['c', SIT]
    ])
    const lasting = 'Mary must wear only one shoe until Ana says awake'
    const brief = 'Mary must not sit down until morning'
    await readWith(db, given, [
      { type: 'said', kind: 'rule', entry: 'Ana', heard: ['Mary', 'Tobin'], fact: lasting, quote: GIVEN },
      { type: 'said', kind: 'rule', entry: 'Ana', heard: ['Mary', 'Tobin'], fact: brief, quote: SIT }
    ])
    const named = (n: string) => repo.listEntries(db).find((e) => e.name === n)!
    const [mary, tobin] = [named('Mary'), named('Tobin')]
    // Full names, as a real cast has them: the fact says "Mary".
    repo.updateEntry(db, mary.id, { name: 'Mary Dunn' })
    repo.updateEntry(db, tobin.id, { name: 'Tobin Hale' })
    const rule = (sceneId: ID, fact: string) => sceneMemory(db, sceneId).facts.find((f) => f.fact === fact)?.rule
    // Tobin heard it in the room, but it names Mary: only she is bound.
    expect(rule(next, lasting)?.bound).toEqual([mary.id])
    expect(rule(next, lasting)?.bound).not.toContain(tobin.id)
    // "Until morning": in force until the memory ends it when morning comes; the lasting one stays.
    expect(rule(next, brief)?.bound).toEqual([mary.id])
    const MORNING = 'Morning came, and Mary sat down at last.'
    save(db, after, [['a', MORNING]])
    await readWith(db, after, [{ type: 'end', entry: 'Mary Dunn', fact: brief, quote: MORNING }])
    expect(rule(last, brief)).toBeUndefined()
    expect(rule(last, lasting)?.bound).toEqual([mary.id])
  })
})
