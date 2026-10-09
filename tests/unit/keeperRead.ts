// Reading scenes with the fake memory model in unit tests, its reply shaped per test (World Memory Overhaul tests).
// All text the tests use is invented; nothing here makes a paid call.

import type Database from 'better-sqlite3'
import type { ID } from '../../src/shared/types'
import { memoryWorld } from './helpers'
import { fakeMemoryReply, type FakeProvider } from '../fake-provider/server.mjs'
import * as repo from '../../src/main/db/repo'
import * as kdb from '../../src/main/db/keeper'
import type { MemoryModel } from '../../src/main/keeper/model'
import { runScene, type RunOutcome } from '../../src/main/keeper/run'
import { READING_MARKER } from '../../src/main/keeper/prompts'

type DB = Database.Database

export function fakeModel(fake: FakeProvider, modelId = 'fake/writer'): MemoryModel {
  return {
    target: { id: 'p1', name: 'Fake', kind: 'custom', baseUrl: fake.url, apiKey: 'test' },
    choice: { providerId: 'p1', modelId, label: modelId, contextLength: 32000, promptPrice: null, completionPrice: null }
  }
}

/** A fresh world with its first scene and `extra` more scenes in the same chapter. */
export function testWorld(extra = 2): { db: DB; storyId: ID; chapterId: ID; scenes: ID[] } {
  const db = memoryWorld()
  const story = repo.listStories(db)[0]
  const o = repo.getOutline(db, story.id)
  const scenes = [o.scenes[0].id]
  for (let i = 0; i < extra; i++) scenes.push(repo.createScene(db, o.chapters[0].id, { title: `Scene ${i + 2}` }).id)
  return { db, storyId: story.id, chapterId: o.chapters[0].id, scenes }
}

/** Saves a scene's paragraphs (with paragraph ids) as the editor does, and tells the keeper. */
export function saveParas(db: DB, sceneId: ID, paras: [string, string][], tell = true): void {
  const doc = {
    type: 'doc',
    content: paras.map(([pid, text]) => ({ type: 'paragraph', attrs: { pid }, content: text ? [{ type: 'text', text }] : [] }))
  }
  repo.saveSceneText(db, sceneId, doc, paras.map(([, t]) => t).join('\n\n'))
  if (tell) kdb.noteSceneSaved(db, sceneId)
}

export const textOf = (c: unknown): string =>
  typeof c === 'string' ? c : Array.isArray(c) ? c.map((p) => (typeof p?.text === 'string' ? p.text : '')).join('') : ''

export interface ShapedRead {
  /** 'none': the model gives no verdict on facts whose words changed. */
  verdicts?: 'fake' | 'none'
  /** Items added to its reply (entries by name; mapped to the short ids the request lists). */
  add?: Record<string, unknown>[]
  /** The model reports nothing at all. */
  nothing?: boolean
}

/** A fetch that answers reading requests with the fake model's reply shaped by `o` (other requests go to the fake provider). */
export function shapedFetch(o: ShapedRead, asked: string[] = []): typeof fetch {
  return async (input, init) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { messages?: { role: string; content: unknown }[] }
    const system = textOf(body.messages?.find((m) => m.role === 'system')?.content)
    if (!system.includes(READING_MARKER)) return fetch(input, init)
    const user = textOf(body.messages?.find((m) => m.role === 'user')?.content)
    asked.push(user)
    const reply = o.nothing
      ? { facts: [] as unknown[], add: [] as Record<string, unknown>[], clashes: [] as unknown[] }
      : (JSON.parse(fakeMemoryReply(user)) as { facts: unknown[]; add: Record<string, unknown>[]; clashes: unknown[] })
    if (o.verdicts === 'none') reply.facts = []
    const ids = new Map([...user.matchAll(/^- (E\d+) [a-z]+ "([^"]+)"/gm)].map((m) => [m[2], m[1]]))
    const map = (v: unknown): unknown => (typeof v === 'string' ? (ids.get(v) ?? v) : v)
    for (const a of o.add ?? []) reply.add.push({ ...a, entry: map(a.entry), involved: Array.isArray(a.involved) ? a.involved.map(map) : a.involved })
    const chunk = { choices: [{ index: 0, delta: { content: JSON.stringify(reply) }, finish_reason: 'stop' }] }
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
  }
}

/** Reads a scene with the fake memory model, its reply shaped by `o`. */
export async function readScene(
  db: DB,
  fake: FakeProvider,
  sceneId: ID,
  o: ShapedRead = {}
): Promise<RunOutcome & { asked: string[] }> {
  const asked: string[] = []
  const out = await runScene(
    { db, model: fakeModel(fake), signal: new AbortController().signal, closed: () => false, retryDelays: [0, 0], fetchImpl: shapedFetch(o, asked) },
    sceneId
  )
  return { ...out, asked }
}

export const entryNamed = (db: DB, name: string) => repo.listEntries(db).find((e) => e.name === name) ?? null
