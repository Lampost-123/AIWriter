// What was said (story memory step 5): the memory keeper keeps promises, threats and secrets told as facts the speaker
// and each hearer know, with the line itself. Made-up scenes, read by the fake memory model with a "said" item added.
import type Database from 'better-sqlite3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ID } from '@shared/types'
import { memoryWorld } from '../../../tests/unit/helpers'
import { startFakeProvider, type FakeProvider } from '../../../tests/fake-provider/server.mjs'
import * as repo from '../db/repo'
import * as kdb from '../db/keeper'
import type { MemoryModel } from './model'
import { runScene } from './run'
import { READING_MARKER, READING_SYSTEM } from './prompts'
import { changeWords, fingerprint } from './facts'
import { saidChanges } from '../db/retrieval'
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

const LINE = '“I swear I will come back for you before the snow,” Mara told Tobin.'

describe('what was said', () => {
  it('asks the memory model for promises, threats and secrets told, with the line itself', () => {
    expect(READING_SYSTEM).toContain('{"type": "said", "kind": "promise|threat|secret"')
    expect(READING_SYSTEM).toContain('the spoken line itself as the quote')
  })

  it('keeps one fact the speaker and each hearer know, with the exact words, and later scenes see it', async () => {
    const db = memoryWorld()
    const story = repo.listStories(db)[0]
    const o = repo.getOutline(db, story.id)
    const first = o.scenes[0].id
    const next = repo.createScene(db, o.chapters[0].id, { title: 'Next', afterId: first }).id
    save(db, first, [
      ['a', 'Mara lost her hat. Tobin lost his oar. Ana lost her bag.'],
      ['b', LINE]
    ])
    await readWith(db, first, [
      { type: 'said', kind: 'promise', entry: 'Mara', heard: ['Tobin', 'Ana', 'Mara'], fact: 'Mara will come back for Tobin before the snow', quote: LINE },
      // Not something said: a kind it doesn't know, or no fact.
      { type: 'said', kind: 'rumour', entry: 'Mara', heard: ['Tobin'], fact: 'x', quote: LINE },
      { type: 'said', kind: 'threat', entry: 'Mara', heard: ['Tobin'], quote: LINE }
    ])
    const named = (n: string) => repo.listEntries(db).find((e) => e.name === n)!
    const [mara, tobin, ana] = [named('Mara'), named('Tobin'), named('Ana')]
    const said = saidChanges(db)
    expect(said.map((s) => s.change.entryId).sort()).toEqual([mara.id, tobin.id, ana.id].sort())
    const factIds = new Set(said.map((s) => s.change.payload.factId))
    expect(factIds.size).toBe(1)
    for (const s of said) {
      expect(s.said).toEqual({ kind: 'promise', by: mara.id, words: LINE })
      expect(s.words).toBe(LINE)
      expect(s.change.origin).toBe('text')
    }
    // As of the next scene, everyone who heard it knows it.
    const fact = sceneMemory(db, next).facts.find((f) => factIds.has(f.factId))!
    expect(fact.knownBy.sort()).toEqual([mara.id, tobin.id, ana.id].sort())
    // ...but not before it was said.
    expect(sceneMemory(db, first).facts.some((f) => factIds.has(f.factId))).toBe(false)
    expect(kdb.listLog(db).some((l) => l.text === 'A promise: Mara will come back for Tobin before the snow')).toBe(true)
  })

  it('follows the line when its words change, and lets it go when they are gone', async () => {
    const db = memoryWorld()
    const story = repo.listStories(db)[0]
    const scene = repo.getOutline(db, story.id).scenes[0].id
    save(db, scene, [
      ['a', 'Mara lost her hat. Tobin lost his oar.'],
      ['b', LINE]
    ])
    await readWith(db, scene, [{ type: 'said', kind: 'promise', entry: 'Mara', heard: ['Tobin'], fact: 'Mara will come back for Tobin before the snow', quote: LINE }])
    expect(saidChanges(db)).toHaveLength(2)
    // The paragraph goes: its words are gone, so nothing said is sent word for word any more.
    save(db, scene, [['a', 'Mara lost her hat. Tobin lost his oar.']])
    await readWith(db, scene, [])
    expect(saidChanges(db)).toEqual([])
  })

  it('is a guess of its own kind, and reads in plain words', () => {
    const data = { kind: 'knowledge' as const, payload: { factId: 'f', fact: 'Kell will drown Ana', said: { kind: 'threat' as const, by: 'k', words: 'Talk and you drown.' } } }
    expect(fingerprint({ type: 'change', entryId: 'e', change: data })).toBe('said:e')
    expect(fingerprint({ type: 'change', entryId: 'e', change: { kind: 'knowledge', payload: { factId: 'f', fact: 'x' } } })).toBe('knowledge:e')
    expect(changeWords(data, () => '')).toBe('A threat: Kell will drown Ana')
  })
})
