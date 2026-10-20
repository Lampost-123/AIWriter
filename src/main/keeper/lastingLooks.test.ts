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
