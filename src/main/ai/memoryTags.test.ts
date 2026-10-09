// Origin tags in "What the AI saw" (World Memory Overhaul B6): each part of the writer's briefing records what its
// memory lines rest on (read from the story, Adam's own, or a guess) and how they stand on their words (fine, edited
// since, or a summary being brought up to date), in a few small tags, never a second copy of the prompt. All text is
// invented; the memory model is the fake one: no paid calls.

import type Database from 'better-sqlite3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ContextBlock, ID, MemoryTag } from '@shared/types'
import { defaultWritingPrefs } from '@shared/defaults'
import { countMemoryTags } from '@shared/memoryTags'
import { startFakeProvider, type FakeProvider } from '../../../tests/fake-provider/server.mjs'
import { entryNamed, fakeModel, readScene, saveParas, testWorld } from '../../../tests/unit/keeperRead'
import * as repo from '../db/repo'
import * as gens from '../db/generations'
import { writeSceneSummary } from '../keeper/summaries'
import { gatherContextInput } from './gather'
import { assembleContext } from './context'

let fake: FakeProvider
beforeAll(async () => {
  fake = await startFakeProvider({ delayMs: 0 })
})
afterAll(() => fake.close())

type DB = Database.Database

const countRaw = (t: string): number => Math.ceil(t.length / 4)
const briefing = (db: DB, sceneId: ID) =>
  assembleContext(gatherContextInput(db, sceneId, undefined, { prefs: defaultWritingPrefs(), contextLength: 64000, creativity: 'balanced' }), countRaw)
const tags = (blocks: ContextBlock[]): MemoryTag[] => blocks.filter((b) => !b.dropped).flatMap((b) => b.memory ?? [])
const onCard = (db: DB, sceneId: ID, ids: ID[]) => repo.updateSceneCard(db, sceneId, { ...repo.getScene(db, sceneId).card, presentIds: ids })

describe('origin tags in the writer’s briefing', () => {
  it('say who each entry comes from, and mark the memory’s guesses', async () => {
    const w = testWorld(1)
    const [s1, s2] = w.scenes
    saveParas(w.db, s1, [['p1', 'Kell learned that the bridge was down.']])
    await readScene(w.db, fake, s1)
    const kell = entryNamed(w.db, 'Kell')!
    repo.updateEntry(w.db, kell.id, { fields: { ...kell.fields, hair: 'black' } }, { origin: 'ai' })
    const oskar = repo.createEntry(w.db, 'character', { name: 'Oskar', summary: 'A lamplighter.', fields: { eyes: 'brown' } })
    onCard(w.db, s2, [kell.id, oskar.id])
    const all = tags(briefing(w.db, s2).blocks)
    expect(all).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entryId: kell.id, label: 'Kell', origin: 'text', health: 'ok' }),
        expect.objectContaining({ entryId: kell.id, field: 'hair', fieldLabel: 'Hair', origin: 'guess', health: 'ok' }),
        expect.objectContaining({ entryId: oskar.id, label: 'Oskar', origin: 'yours', health: 'ok' })
      ])
    )
    expect(all.some((t) => t.entryId === oskar.id && t.origin === 'guess')).toBe(false)
  })

  it('mark an entry summary sent while its words are edited and unconfirmed', async () => {
    const w = testWorld(1)
    const [s1, s2] = w.scenes
    saveParas(w.db, s1, [
      ['p1', 'Mara laughed at the ferryman.'],
      ['p2', 'Mara lost her knife in the river.']
    ])
    await readScene(w.db, fake, s1)
    const mara = entryNamed(w.db, 'Mara')!
    expect(mara.summary.trim()).not.toBe('')
    // On the next scene's card, so she stays while no words name her.
    onCard(w.db, s2, [mara.id])
    saveParas(w.db, s1, [
      ['p1', 'The ferryman laughed.'],
      ['p2', 'The knife slipped from a belt into the reeds.']
    ])
    await readScene(w.db, fake, s1, { verdicts: 'none' })
    const all = tags(briefing(w.db, s2).blocks)
    expect(all).toEqual(expect.arrayContaining([expect.objectContaining({ entryId: mara.id, field: 'summary', health: 'changed' })]))
  })

  it('mark an earlier scene’s summary that is being brought up to date', async () => {
    const w = testWorld(1)
    const [s1, s2] = w.scenes
    const long = (s: string) => `${s} `.repeat(12).trim()
    saveParas(w.db, s1, [
      ['p1', long('The harbour lay grey under a low sky.')],
      ['p2', long('The market was setting out its stalls.')]
    ])
    await writeSceneSummary(
      { db: w.db, model: fakeModel(fake), signal: new AbortController().signal, closed: () => false, retryDelays: [0], fetchImpl: (i, n) => fetch(i, n) },
      s1,
      null,
      'Ch 1, Sc 1'
    )
    expect(tags(briefing(w.db, s2).blocks).filter((t) => t.health === 'updating')).toEqual([])
    saveParas(w.db, s1, [
      ['p1', long('The harbour lay grey under a low sky.')],
      ['p2', long('Night came down over the quays and every lantern was lit.')]
    ])
    const preview = briefing(w.db, s2)
    const sofar = preview.blocks.find((b) => b.id === 'story-so-far')!
    expect(sofar.memory).toEqual([expect.objectContaining({ sceneId: s1, origin: 'text', health: 'updating' })])
    expect(countMemoryTags(preview.blocks)).toMatchObject({ stale: 1, guesses: 0 })
  })

  it('stay small: a few words a tag, never the text of the briefing', async () => {
    const w = testWorld(1)
    const [s1, s2] = w.scenes
    saveParas(w.db, s1, [['p1', 'Kell learned that the bridge was down.']])
    await readScene(w.db, fake, s1)
    const kell = entryNamed(w.db, 'Kell')!
    repo.updateEntry(w.db, kell.id, { fields: { ...kell.fields, hair: 'black', marks: 'a long scar across his chin' } }, { origin: 'ai' })
    onCard(w.db, s2, [kell.id])
    const blocks = briefing(w.db, s2).blocks
    for (const t of tags(blocks)) {
      expect(Object.keys(t).every((k) => ['label', 'entryId', 'sceneId', 'field', 'fieldLabel', 'origin', 'health'].includes(k))).toBe(true)
      expect(JSON.stringify(t)).not.toContain('scar')
    }
    const sent = blocks.filter((b) => !b.dropped)
    const tagBytes = JSON.stringify(sent.map((b) => b.memory ?? [])).length
    const textBytes = sent.reduce((n, b) => n + b.text.length, 0)
    expect(tagBytes).toBeLessThan(textBytes / 4)
  })
})

describe('counting tags (for the test harness)', () => {
  const tag = (o: Partial<MemoryTag>): MemoryTag => ({ label: 'Kell', origin: 'text', health: 'ok', ...o })
  const block = (id: string, memory: MemoryTag[], dropped = false): ContextBlock => ({
    id,
    priority: 5,
    title: id,
    text: 'x',
    tokens: 1,
    entryIds: [],
    dropped,
    memory
  })

  it('counts stale and guessed lines in the parts that were sent', () => {
    const blocks = [
      block('present', [tag({}), tag({ field: 'hair', origin: 'guess' }), tag({ field: 'summary', health: 'changed' })]),
      block('story-so-far', [tag({ sceneId: 's1', label: 'Ch 1, Sc 1', health: 'updating' })]),
      block('mentioned', [tag({ field: 'eyes', origin: 'guess' })], true)
    ]
    expect(countMemoryTags(blocks)).toEqual({ lines: 4, stale: 2, guesses: 1, yours: 0 })
    expect(countMemoryTags([])).toEqual({ lines: 0, stale: 0, guesses: 0, yours: 0 })
  })

  it('reads the counts of a saved record', () => {
    const w = testWorld(0)
    const id = 'gen-1'
    gens.insertGeneration(w.db, {
      id,
      sceneId: w.scenes[0],
      job: 'draft',
      providerId: 'p1',
      providerName: 'Fake',
      modelId: 'fake/writer',
      params: { temperature: 1, top_p: 1, max_tokens: 100 } as never,
      direction: '',
      blocks: [block('present', [tag({ field: 'hair', origin: 'guess' }), tag({ origin: 'yours' })])],
      messages: [],
      budget: { contextLength: 1000, reserved: 100, available: 900, used: 10 },
      entries: [],
      createdAt: new Date().toISOString()
    })
    expect(gens.memoryTagCounts(w.db, id)).toEqual({ lines: 2, stale: 0, guesses: 1, yours: 1 })
    expect(gens.memoryTagCounts(w.db, 'missing')).toBeNull()
  })
})
