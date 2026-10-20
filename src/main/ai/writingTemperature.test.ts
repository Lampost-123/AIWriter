// Writing temperature (Settings › Models; Adam, 2026-10-20): every request that writes the story's words goes at Adam's
// own temperature when he sets one (within what the model takes), the creativity still setting top_p; Auto is as before;
// and nothing but the writing reads the setting.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import type { ChatMessage, ContextPreview, Creativity, GenerationRecord, ModelChoice } from '@shared/types'
import { CREATIVITY_PRESETS, writerTemperature } from '@shared/defaults'
import { memoryWorld } from '../../../tests/unit/helpers'
import { startFakeProvider, type FakeProvider } from '../../../tests/fake-provider/server.mjs'
import * as repo from '../db/repo'
import * as gens from '../db/generations'
import { startDraftJob, type Emit } from './drafts'
import { directedStream, type DirectorSetup } from '../director/run'
import { planStretches } from '../director/stretch'
import { DIRECTOR_MARKER, DIRECTOR_TEMPERATURE } from '../director/prompts'
import type { JobModel } from './jobModel'

let fake: FakeProvider
beforeAll(async () => {
  fake = await startFakeProvider({ delayMs: 1, words: 40 })
})
afterAll(() => fake.close())

let db: Database.Database | null = null
afterEach(() => {
  db?.close()
  db = null
})

const choice = (modelId: string): ModelChoice => ({ providerId: 'p1', modelId, label: modelId, contextLength: 32_000, promptPrice: null, completionPrice: null })
const BRIEFING: ChatMessage[] = [
  { role: 'system', content: 'You are a novelist.' },
  { role: 'user', content: 'The scene card.\n\nNow the prose itself:' }
]
const preview: ContextPreview = { blocks: [], messages: BRIEFING, budget: { contextLength: 32_000, reserved: 800, available: 31_000, used: 200 } }

type PartOf = Parameters<typeof startDraftJob>[0]['partOf']

async function draft(o: { writingTemperature?: number | null; creativity?: Creativity; modelId?: string; partOf?: PartOf; baseUrl?: string }) {
  db = memoryWorld()
  const story = repo.listStories(db)[0]
  const sceneId = repo.getOutline(db, story.id).scenes[0].id
  const emit: Emit = () => undefined
  fake.reset()
  const started = startDraftJob({
    db,
    sceneId,
    ...(o.partOf ? { partOf: o.partOf, exclusive: false } : {}),
    options: { direction: '', targetWords: 300, creativity: o.creativity ?? 'balanced' },
    preview,
    provider: { id: 'p1', name: 'Fake', kind: 'custom', baseUrl: o.baseUrl ?? fake.url, apiKey: 'k' },
    model: choice(o.modelId ?? 'fake/writer'),
    thinking: 'off',
    writingTemperature: o.writingTemperature,
    entryVersions: new Map(),
    emit,
    retryDelays: [1, 1]
  })
  const end = await started.done
  expect(end.status).toBe('complete')
  return { body: fake.lastRequest()!.body, record: gens.getGeneration(db, started.generationId) as GenerationRecord }
}

describe('Writing temperature: the writer’s requests', () => {
  it('Auto: a draft goes at the creativity’s temperature, as before', async () => {
    for (const c of ['steady', 'balanced', 'adventurous'] as const) {
      const { body, record } = await draft({ creativity: c, writingTemperature: null })
      expect(body.temperature).toBe(writerTemperature(c))
      expect(body.top_p).toBe(CREATIVITY_PRESETS[c].top_p)
      expect(record.params.ownTemperature).toBeUndefined()
    }
  })

  it('Custom: a draft, a variant, a beat and Write the chapter’s drafts all go at Adam’s temperature; Creativity still sets top_p', async () => {
    const parts: PartOf[] = [
      undefined,
      { variant: { setId: 'set-1', index: 1, of: 2 } },
      { beat: { sessionId: 'beats-1', index: 1, of: 3 } },
      { chapterWriter: { runId: 'run-1' } }
    ]
    for (const partOf of parts) {
      const { body, record } = await draft({ writingTemperature: 1.5, creativity: 'steady', partOf })
      expect(body.temperature).toBe(1.5)
      expect(body.top_p).toBe(CREATIVITY_PRESETS.steady.top_p)
      // "What the AI saw" shows the temperature that was sent, and that it was Adam's own.
      expect(record.params.temperature).toBe(1.5)
      expect(record.params.ownTemperature).toBe(true)
    }
  })

  it('Claude takes 0 to 1: a higher temperature is sent as 1, and recorded as sent', async () => {
    const { body, record } = await draft({ writingTemperature: 1.5, modelId: 'anthropic/claude-sonnet-4.5' })
    expect(body.temperature).toBe(1)
    expect(record.params.temperature).toBe(1)
    const low = await draft({ writingTemperature: 0.4, modelId: 'anthropic/claude-sonnet-4.5' })
    expect(low.body.temperature).toBe(0.4)
  })

  it('DeepSeek takes 0 to 2: 1.5 goes as it is; a stored value out of range is brought into it', async () => {
    expect((await draft({ writingTemperature: 1.5, modelId: 'deepseek-chat' })).body.temperature).toBe(1.5)
    expect((await draft({ writingTemperature: 7, modelId: 'deepseek-chat' })).body.temperature).toBe(2)
  })
})

// ---------- Directed writing: each stretch is the writer's; the director's own calls keep theirs ----------

function scripted(): typeof fetch & { sent: { temperature: number; director: boolean }[] } {
  const sent: { temperature: number; director: boolean }[] = []
  const f = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { messages: ChatMessage[]; temperature: number }
    const director = body.messages[0]?.content.startsWith(DIRECTOR_MARKER) ?? false
    sent.push({ temperature: body.temperature, director })
    const text = director ? JSON.stringify({ verdict: 'continue', note: '', reason: '' }) : 'The rain went on against the shutters, steady and cold.'
    const line = (o: object): string => `data: ${JSON.stringify(o)}\n\n`
    const sse =
      line({ choices: [{ index: 0, delta: { content: text }, finish_reason: null }] }) +
      line({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) +
      line({ choices: [], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } }) +
      'data: [DONE]\n\n'
    return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }) as unknown as typeof fetch & { sent: { temperature: number; director: boolean }[] }
  f.sent = sent
  return f
}

describe('Writing temperature: directed writing', () => {
  it('every stretch the writer writes goes at Adam’s temperature', async () => {
    db = memoryWorld()
    const story = repo.listStories(db)[0]
    const sceneId = repo.getOutline(db, story.id).scenes[0].id
    const f = scripted()
    const target = { id: 'p1', name: 'Scripted', kind: 'custom' as const, baseUrl: 'http://scripted.test/v1', apiKey: 'k' }
    const director: JobModel = { job: 'director', target, choice: choice('director'), thinking: 'off' }
    const emit: Emit = () => undefined
    const setup: DirectorSetup = {
      db,
      sceneId,
      plan: planStretches(['Mara finds the letter.', 'Tobin knocks at the door.'], 400),
      closing: '',
      asks: [],
      direction: '',
      carryOn: '',
      checks: { free: null, dreamlike: false, rules: null, beats: null, wearers: [] },
      model: director,
      emit,
      fetchImpl: f,
      retryDelays: [1, 1]
    }
    const started = startDraftJob({
      db,
      sceneId,
      options: { direction: '', targetWords: 400, creativity: 'balanced' },
      preview,
      provider: target,
      model: choice('deepseek-chat'),
      thinking: 'off',
      writingTemperature: 1.5,
      entryVersions: new Map(),
      emit,
      stream: directedStream(setup),
      fetchImpl: f,
      retryDelays: [1, 1]
    })
    expect((await started.done).status).toBe('complete')
    const writes = f.sent.filter((s) => !s.director)
    expect(writes.length).toBeGreaterThanOrEqual(2)
    for (const w of writes) expect(w.temperature).toBe(1.5)
    for (const d of f.sent.filter((s) => s.director)) expect(d.temperature).toBe(DIRECTOR_TEMPERATURE)
  })
})

// ---------- Nothing but the writing reads the setting ----------

describe('Writing temperature: only the writing uses it', () => {
  it('is read only where the story’s words are written (drafts, their briefing, Continue and the edits, Write the chapter)', () => {
    const root = resolve(__dirname, '..')
    const files: string[] = []
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) walk(p)
        else if (p.endsWith('.ts') && !p.endsWith('.test.ts')) files.push(p)
      }
    }
    walk(root)
    const readers = files
      .filter((p) => /writingTemperature/.test(readFileSync(p, 'utf8')))
      .map((p) => relative(root, p).replace(/\\/g, '/'))
      .sort()
    // The draft paths pass the briefing's value on (Generate, Variants, Beat by beat, Write the chapter's drafts); the
    // memory, checks, planning, interviews, outline, critic and director never see it.
    expect(readers).toEqual(['ai/draftFlow.ts', 'ai/drafts.ts', 'beats/index.ts', 'edits/index.ts', 'ipc/ai.ts', 'ipc/chapterWriter.ts', 'variants/index.ts'])
  })
})

