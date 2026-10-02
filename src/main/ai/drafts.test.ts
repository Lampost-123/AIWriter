import Database from 'better-sqlite3'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppEvents } from '@shared/api'
import type { DraftOptions, ModelChoice } from '@shared/types'
import { migrate } from '../db/migrations'
import * as repo from '../db/repo'
import * as gens from '../db/generations'
import { startFakeProvider, type FakeProvider } from '../../../tests/fake-provider/server.mjs'
import { assembleContext, replyTokenLimit } from './context'
import { draftCost, isDrafting, startDraftJob, stopDraft, stopDraftsFor, type Emit } from './drafts'
import { cleanOptions, gatherContextInput } from './gather'
import { countRaw } from './tokens'

let fake: FakeProvider
beforeAll(async () => {
  fake = await startFakeProvider({ delayMs: 2, words: 80, slowWords: 4000, slowDelayMs: 4 })
})
afterAll(() => fake.close())

type Ev = { name: keyof AppEvents; payload: AppEvents[keyof AppEvents] }

function setup() {
  const db = new Database(':memory:')
  migrate(db)
  repo.initWorld(db, 'w1', 'Test world')
  const story = repo.listStories(db)[0]
  const outline = repo.getOutline(db, story.id)
  const first = outline.scenes[0]
  const second = repo.createScene(db, outline.chapters[0].id, { title: 'The knock' })
  repo.saveSceneText(db, first.id, null, 'She left the docks at dusk, the rain at her back.')
  const mara = repo.createEntry(db, 'character', { name: 'Mara', summary: 'A smuggler.', notes: 'SECRET NOTE', fields: { speech: 'Short, dry.' } })
  const tobin = repo.createEntry(db, 'character', { name: 'Tobin', summary: 'A ferryman.' })
  const eel = repo.createEntry(db, 'place', { name: 'The Gilded Eel', summary: 'A tavern.' })
  const rule = repo.createEntry(db, 'lore', { name: 'The Binding', summary: 'Oaths bind.', hardRule: true })
  repo.updateSceneCard(db, second.id, {
    ...repo.getScene(db, second.id).card,
    povId: mara.id,
    presentIds: [mara.id, tobin.id],
    locationId: eel.id,
    beats: ['Mara meets Tobin', 'Someone knocks'],
    targetWords: 600
  })
  return { db, story, first, second, mara, tobin, eel, rule }
}

const model = (over: Partial<ModelChoice> = {}): ModelChoice => ({
  providerId: 'p1',
  modelId: 'fake/writer',
  label: 'Fake: Writer',
  contextLength: 32000,
  promptPrice: 0.000003,
  completionPrice: 0.000015,
  ...over
})

function recorder() {
  const events: Ev[] = []
  const emit: Emit = (name, payload) => events.push({ name, payload })
  const done = (id: string) =>
    new Promise<AppEvents['generation:done']>((resolve) => {
      const check = () => {
        const d = events.find((e) => e.name === 'generation:done' && (e.payload as AppEvents['generation:done']).generationId === id)
        if (d) resolve(d.payload as AppEvents['generation:done'])
        else setTimeout(check, 5)
      }
      check()
    })
  return { events, emit, done }
}

function start(w: ReturnType<typeof setup>, emit: Emit, modelId = 'fake/writer', kind: 'custom' | 'openrouter' = 'custom', options: Partial<DraftOptions> = {}) {
  const input = gatherContextInput(w.db, w.second.id, { direction: 'End on the knock.', ...options }, { prefs: { spelling: 'UK', pov: 'Close third', tense: 'Past', voiceNotes: '', avoidWords: [] }, contextLength: 32000, creativity: 'steady' })
  const preview = assembleContext(input, countRaw)
  return {
    input,
    preview,
    ...startDraftJob({
      db: w.db,
      sceneId: w.second.id,
      options: input.options,
      preview,
      provider: { id: 'p1', name: 'Fake', kind, baseUrl: fake.url, apiKey: 'k' },
      model: model({ modelId }),
      entryVersions: new Map(input.entries.map((e) => [e.id, e.updatedAt])),
      emit,
      retryDelays: [5, 5, 5, 5]
    })
  }
}

describe('gatherContextInput', () => {
  it('reads the card, the previous scene, entries and the merged style', () => {
    const w = setup()
    const input = gatherContextInput(w.db, w.second.id, undefined, { prefs: { spelling: 'US', pov: 'First person', tense: 'Present', voiceNotes: '', avoidWords: ['very'] }, contextLength: null, creativity: 'adventurous' })
    expect(input.previousText).toContain('She left the docks')
    expect(input.scene.card.beats).toEqual(['Mara meets Tobin', 'Someone knocks'])
    expect(input.entries.map((e) => e.name).sort()).toEqual(['Mara', 'The Binding', 'The Gilded Eel', 'Tobin'])
    expect(input.style.pov).toBe('First person')
    expect(input.style.avoidPhrases).toEqual(['very'])
    // Defaults come from the card and settings.
    expect(input.options).toEqual({ direction: '', targetWords: 600, creativity: 'adventurous' })
  })

  it('cleans draft options', () => {
    expect(cleanOptions({ targetWords: 5, creativity: 'wild' as never, direction: '  hi  ' }, { targetWords: 1500, creativity: 'balanced' })).toEqual({
      targetWords: 100,
      creativity: 'balanced',
      direction: 'hi'
    })
    expect(cleanOptions({ targetWords: 1e9 }, { targetWords: 1500, creativity: 'steady' }).targetWords).toBe(12000)
    expect(cleanOptions({ targetWords: NaN }, { targetWords: 1500, creativity: 'steady' }).targetWords).toBe(1500)
  })
})

describe('drafting', () => {
  let w: ReturnType<typeof setup>
  beforeEach(() => {
    w = setup()
    fake.reset()
  })

  it('records the draft, streams batched text, and finishes the record', async () => {
    const { events, emit, done } = recorder()
    const { generationId, preview } = start(w, emit)
    // The record exists straight away, marked as being written.
    expect(gens.getGeneration(w.db, generationId).status).toBe('streaming')
    expect(isDrafting(w.second.id)).toBe(true)

    const end = await done(generationId)
    expect(end.status).toBe('complete')
    expect(end.error).toBeNull()
    expect(isDrafting(w.second.id)).toBe(false)

    const chunks = events.filter((e) => e.name === 'generation:chunk').map((e) => (e.payload as AppEvents['generation:chunk']).text)
    const rec = gens.getGeneration(w.db, generationId)
    expect(chunks.join('')).toBe(rec.response)
    // Batched: far fewer events than streamed pieces (about 3 words each).
    expect(chunks.length).toBeLessThan(rec.words / 3)
    expect(rec.status).toBe('complete')
    expect(rec.messages).toEqual(preview.messages)
    expect(rec.blocks.map((b) => b.id)).toEqual(preview.blocks.map((b) => b.id))
    // The reply limit leaves headroom beyond the reply room (target + 40%), so a long scene isn't cut off.
    expect(rec.params).toMatchObject({ temperature: 0.6, top_p: 0.9, creativity: 'steady', targetWords: 600, max_tokens: replyTokenLimit(preview.budget).limit })
    expect(rec.params.max_tokens).toBeGreaterThan(preview.budget.reserved)
    expect(fake.lastRequest()!.body.max_tokens).toBe(rec.params.max_tokens)
    expect(rec.direction).toBe('End on the knock.')
    expect(rec.promptTokens).toBeGreaterThan(0)
    expect(rec.cost).toBeCloseTo(rec.promptTokens! * 0.000003 + rec.completionTokens! * 0.000015, 10)
    expect(rec.costEstimated).toBe(false)
    expect(rec.finishedAt).not.toBeNull()

    // Entries sent, with names, kinds and versions.
    expect(rec.entries.map((e) => e.name)).toEqual(['Mara', 'Tobin', 'The Gilded Eel', 'The Binding'])
    expect(rec.entries[0]).toMatchObject({ kind: 'character', version: w.mara.updatedAt, deleted: false, changedSince: false })

    // What was sent never includes private notes.
    expect(JSON.stringify(fake.lastRequest()!.body.messages)).not.toContain('SECRET NOTE')
    expect(fake.lastRequest()!.body.messages).toEqual(preview.messages)

    const list = gens.listGenerations(w.db, w.second.id)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id: generationId, status: 'complete', modelId: 'fake/writer', providerName: 'Fake' })
    expect(list[0].words).toBeGreaterThan(50)
  })

  it('asks with the plain reply room if the model cannot write that much, and records it', async () => {
    const { emit, done } = recorder()
    const { generationId, preview } = start(w, emit, 'fake/max-output', 'custom', { targetWords: 400 })
    const end = await done(generationId)
    expect(end.status).toBe('complete')
    const rec = gens.getGeneration(w.db, generationId)
    expect(rec.params.max_tokens).toBe(preview.budget.reserved)
    expect(fake.lastRequest()!.body.max_tokens).toBe(preview.budget.reserved)
  })

  it('stops on request and keeps the text so far', async () => {
    const { events, emit } = recorder()
    const { generationId } = start(w, emit, 'fake/slow')
    while (!events.some((e) => e.name === 'generation:chunk')) await new Promise((r) => setTimeout(r, 5))
    await stopDraft(generationId)
    const rec = gens.getGeneration(w.db, generationId)
    expect(rec.status).toBe('stopped')
    expect(rec.response.length).toBeGreaterThan(0)
    expect(rec.words).toBeLessThan(4000)
    const end = events.find((e) => e.name === 'generation:done')!.payload as AppEvents['generation:done']
    expect(end.status).toBe('stopped')
    // No usage from the provider, so the cost is an estimate.
    expect(rec.cost).toBeGreaterThan(0)
    expect(rec.costEstimated).toBe(true)
  })

  it('allows only one draft at a time per scene', async () => {
    const { emit, done } = recorder()
    const { generationId } = start(w, emit, 'fake/slow')
    expect(() => start(w, emit)).toThrow(/already being written/)
    await stopDraft(generationId)
    await done(generationId)
    const again = start(w, emit)
    await done(again.generationId)
  })

  it('saves the text as it arrives, so a crash keeps it', async () => {
    const { events, emit } = recorder()
    const { generationId } = start(w, emit, 'fake/slow')
    await new Promise((r) => setTimeout(r, 700))
    const mid = gens.getGeneration(w.db, generationId)
    expect(mid.status).toBe('streaming')
    expect(mid.response.length).toBeGreaterThan(0)
    // Simulate the app closing the world mid-draft.
    stopDraftsFor(w.db)
    const closed = gens.getGeneration(w.db, generationId)
    expect(closed.status).toBe('stopped')
    while (!events.some((e) => e.name === 'generation:done')) await new Promise((r) => setTimeout(r, 5))
    expect(gens.getGeneration(w.db, generationId).status).toBe('stopped')
  })

  it('records errors in plain words and keeps partial text', async () => {
    const { emit, done } = recorder()
    const { generationId } = start(w, emit, 'fake/drop')
    const end = await done(generationId)
    expect(end.status).toBe('error')
    expect(end.error).toContain('dropped')
    const rec = gens.getGeneration(w.db, generationId)
    expect(rec.error).toBe(end.error)
    expect(rec.response.length).toBeGreaterThan(0)
  })

  it('tells the window when it is retrying', async () => {
    const { events, emit, done } = recorder()
    const { generationId } = start(w, emit, 'fake/servererror-once')
    await done(generationId)
    const retry = events.find((e) => e.name === 'generation:retrying')!.payload as AppEvents['generation:retrying']
    expect(retry).toMatchObject({ generationId, attempt: 1, reason: 'Fake had a hiccup' })
  })

  it('marks drafts left streaming by a crash as stopped', () => {
    const { emit } = recorder()
    const { generationId } = start(w, emit, 'fake/slow')
    // Pretend the app died: the record is still 'streaming'.
    expect(gens.stopInterrupted(w.db, '2026-10-01T00:00:00.000Z')).toBe(1)
    expect(gens.getGeneration(w.db, generationId).status).toBe('stopped')
    return stopDraft(generationId)
  })

  it('still lists entries that were deleted or changed since', async () => {
    const { emit, done } = recorder()
    const { generationId } = start(w, emit)
    await done(generationId)
    repo.deleteEntry(w.db, w.tobin.id)
    await new Promise((r) => setTimeout(r, 5))
    repo.updateEntry(w.db, w.mara.id, { summary: 'Changed.' })
    const rec = gens.getGeneration(w.db, generationId)
    expect(rec.entries.find((e) => e.name === 'Tobin')).toMatchObject({ deleted: true })
    expect(rec.entries.find((e) => e.name === 'Mara')).toMatchObject({ changedSince: true, deleted: false })
  })

  it('throws a plain message for a missing record', () => {
    expect(() => gens.getGeneration(w.db, 'nope')).toThrow(/could not be found/)
  })
})

describe('draftCost', () => {
  const m = { promptPrice: 0.000001, completionPrice: 0.000002 }
  it('prefers the provider figure, then tokens times prices, then an estimate', () => {
    expect(draftCost({ cost: 0.5, promptTokens: 1, completionTokens: 1, text: '' }, m, 100)).toBe(0.5)
    expect(draftCost({ cost: null, promptTokens: 1000, completionTokens: 500, text: '' }, m, 100)).toBeCloseTo(0.002)
    expect(draftCost({ cost: null, promptTokens: null, completionTokens: null, text: 'one two three four' }, m, 1000)).toBeCloseTo(1000 * 0.000001 + 6 * 0.000002)
    expect(draftCost({ cost: null, promptTokens: 1, completionTokens: 1, text: '' }, { promptPrice: null, completionPrice: null }, 100)).toBeNull()
  })
})
