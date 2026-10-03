import Database from 'better-sqlite3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AppEvents } from '@shared/api'
import type { ModelChoice, ProviderConfig } from '@shared/types'
import { migrate } from '../db/migrations'
import * as repo from '../db/repo'
import * as gens from '../db/generations'
import { startFakeProvider, type FakeProvider } from '../../../tests/fake-provider/server.mjs'
import { isTaskRunning, runTask, startTask, stopTask, stopTasksFor, type Emit, type TaskRequest } from './tasks'
import { jobModel, type ModelSources } from './jobModel'

let fake: FakeProvider
beforeAll(async () => {
  fake = await startFakeProvider({ delayMs: 2, words: 60, slowWords: 4000, slowDelayMs: 4 })
})
afterAll(() => fake.close())

type Ev = { name: keyof AppEvents; payload: AppEvents[keyof AppEvents] }

function world() {
  const db = new Database(':memory:')
  migrate(db)
  repo.initWorld(db, 'w1', 'Test world')
  return db
}

const choice = (modelId = 'fake/writer'): ModelChoice => ({
  providerId: 'p1',
  modelId,
  label: modelId,
  contextLength: 32000,
  promptPrice: 0.000003,
  completionPrice: 0.000015
})

function request(db: Database.Database, events: Ev[], over: Partial<TaskRequest> = {}): TaskRequest {
  const emit: Emit = (name, payload) => void events.push({ name, payload })
  return {
    db,
    taskId: `t-${Math.round(performance.now() * 1000)}`,
    job: 'chat',
    model: { job: 'chat', target: { id: 'p1', name: 'Fake', kind: 'custom', baseUrl: fake.url, apiKey: 'k' }, choice: choice(), thinking: 'off' },
    messages: [
      { role: 'system', content: 'You help a novelist.' },
      { role: 'user', content: 'Give me a tavern name.' }
    ],
    reply: 400,
    temperature: 0.7,
    emit,
    retryDelays: [5, 5],
    ...over
  }
}

describe('the task runner', () => {
  it('records a sample passage with no scene, sending min_p only to OpenRouter, and a polish pass with its draft', async () => {
    const db = world()
    const events: Ev[] = []
    const openRouter = { id: 'p1', name: 'OpenRouter', kind: 'openrouter' as const, baseUrl: fake.url, apiKey: 'k' }
    const sample = await runTask(
      request(db, events, { job: 'sample', model: { job: 'writer', target: openRouter, choice: choice(), thinking: 'low' }, minP: 0.05 })
    )
    expect(sample.status).toBe('complete')
    expect(fake.lastRequest()!.body.min_p).toBe(0.05)
    const rec = gens.getGeneration(db, sample.generationId)
    expect(rec.job).toBe('sample')
    expect(rec.sceneId).toBe('')
    expect(rec.params).toMatchObject({ min_p: 0.05, thinking: 'low' })

    const polish = await runTask(request(db, events, { job: 'polish', minP: 0.05, extra: { polishOf: 'draft-1' } }))
    expect('min_p' in fake.lastRequest()!.body).toBe(false)
    const polished = gens.getGeneration(db, polish.generationId)
    expect(polished.job).toBe('polish')
    expect(polished.params.polishOf).toBe('draft-1')
    expect(polished.params.min_p).toBeUndefined()
  })

  it('records the call with its job, streams it and resolves with the whole reply', async () => {
    const db = world()
    const events: Ev[] = []
    const req = request(db, events, { direction: 'Give me a tavern name.', extra: { chatId: 'c1' } })
    const done = await runTask(req)
    expect(done.status).toBe('complete')
    expect(done.text).toContain('The rain had not let up')
    expect(done.taskId).toBe(req.taskId)
    expect(events.some((e) => e.name === 'task:progress')).toBe(true)
    expect(events.filter((e) => e.name === 'task:done')).toHaveLength(1)
    const rec = gens.getGeneration(db, done.generationId)
    expect(rec.job).toBe('chat')
    expect(rec.status).toBe('complete')
    expect(rec.response).toBe(done.text)
    expect(rec.params.chatId).toBe('c1')
    expect(rec.direction).toBe('Give me a tavern name.')
    expect(isTaskRunning(req.taskId)).toBe(false)
  })

  it('stops on request and keeps what arrived', async () => {
    const db = world()
    const events: Ev[] = []
    const req = request(db, events, { model: { ...request(db, []).model, choice: choice('fake/slow') }, reply: 8000 })
    const { generationId } = startTask(req)
    expect(isTaskRunning(req.taskId)).toBe(true)
    await new Promise((r) => setTimeout(r, 120))
    await stopTask(req.taskId)
    const rec = gens.getGeneration(db, generationId)
    expect(rec.status).toBe('stopped')
    expect(rec.response.length).toBeGreaterThan(0)
    const done = events.find((e) => e.name === 'task:done')?.payload as AppEvents['task:done']
    expect(done.status).toBe('stopped')
  })

  it('finishes its records when the world closes under it', async () => {
    const db = world()
    const req = request(db, [], { model: { ...request(db, []).model, choice: choice('fake/slow') }, reply: 8000 })
    const { generationId } = startTask(req)
    await new Promise((r) => setTimeout(r, 80))
    stopTasksFor(db)
    expect(gens.getGeneration(db, generationId).status).toBe('stopped')
    await stopTask(req.taskId)
  })

  it('says what went wrong in plain words that name the model', async () => {
    const db = world()
    const done = await runTask(request(db, [], { model: { ...request(db, []).model, choice: choice('fake/credit') } }))
    expect(done.status).toBe('error')
    expect(done.error).toBeTruthy()
    expect(done.error).not.toMatch(/\b(LLM|generation|HTTP|JSON)\b/)
  })
})

describe('the model for each job', () => {
  const provider: ProviderConfig = {
    id: 'p1',
    name: 'OpenRouter',
    kind: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    hasKey: true
  }
  const src = (models: Partial<Record<'writer' | 'memory' | 'chat' | 'builder' | 'speech', ModelChoice | null>>): ModelSources => ({
    settings: {
      models: { writer: null, memory: null, chat: null, builder: null, speech: null, world: null, check: null, recipe: null, ...models },
      thinking: { writer: 'off', memory: 'low', chat: 'off', builder: 'off', speech: 'high', world: 'off', check: 'off', recipe: 'off' }
    },
    getProvider: (id) => (id === 'p1' ? provider : null),
    providerTarget: (p) => ({ id: p.id, name: p.name, kind: p.kind, baseUrl: p.baseUrl, apiKey: 'k' })
  })

  it('uses the job’s own model, else the one it stands in for', () => {
    expect(jobModel('chat', src({ writer: choice('w') })).choice.modelId).toBe('w')
    expect(jobModel('chat', src({ writer: choice('w'), chat: choice('c') })).choice.modelId).toBe('c')
    expect(jobModel('speech', src({ writer: choice('w'), memory: choice('m') })).choice.modelId).toBe('m')
    expect(jobModel('speech', src({ writer: choice('w') })).choice.modelId).toBe('w')
  })

  it('thinks as the job’s own Thinking says', () => {
    expect(jobModel('speech', src({ memory: choice('m') })).thinking).toBe('high')
  })

  it('says what to set up when there is no model', () => {
    expect(() => jobModel('chat', src({}))).toThrow(/Settings › Models/)
    expect(() => jobModel('chat', src({ chat: { ...choice('c'), providerId: 'gone' } }))).toThrow(
      /chat and brainstorm model's provider has been removed/
    )
  })
})
