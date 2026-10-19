// A provider that stops answering (overhaul Phase 6): the memory reading a scene, a scene's summary and where things
// stand run in the background, where nothing says the app is waiting, so each asks streamChat to give up after about
// a minute (ai/patience.ts) rather than its own ten. A request that isn't background work keeps the longer wait.
// streamChat is stood in for here, answering as a provider that never answered would; how it gives up is tested in
// ai/client.test.ts. All text is invented.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StreamChatOptions, StreamOutcome } from '../ai/client'
import { saveParas, testWorld } from '../../../tests/unit/keeperRead'
import { callModel, type MemoryModel } from './model'
import { runScene } from './run'
import { writeSceneSummary } from './summaries'
import { stateAfter } from '../continuity/tracker'

const asked = vi.hoisted(() => [] as StreamChatOptions[])

vi.mock('../ai/client', async (original) => {
  const real = await original<typeof import('../ai/client')>()
  return {
    ...real,
    // Every request: the provider never started answering.
    streamChat: async (o: StreamChatOptions): Promise<StreamOutcome> => {
      asked.push(o)
      return {
        status: 'error',
        text: '',
        error: "Fake didn't answer in time. Try again in a moment.",
        failure: { type: 'timeout' },
        promptTokens: null,
        cachedTokens: null,
        completionTokens: null,
        cost: null,
        finishReason: null,
        retries: o.timeoutRetries ?? 4,
        maxTokens: o.body.max_tokens,
        cutOff: false,
        sentParams: { tokenParam: 'max_tokens', sampling: true },
        effort: null,
        toolCalls: []
      }
    }
  }
})

const model = (baseUrl: string): MemoryModel => ({
  target: { id: 'p1', name: 'Fake', kind: 'custom', baseUrl, apiKey: 'test' },
  choice: { providerId: 'p1', modelId: 'fake/writer', label: 'fake/writer', contextLength: 32000, promptPrice: null, completionPrice: null }
})
/** A provider somewhere on the internet. */
const REMOTE = 'https://api.example.com/v1'

function scene(): { db: ReturnType<typeof testWorld>['db']; sceneId: string } {
  const w = testWorld(0)
  saveParas(w.db, w.scenes[0], [['p1', 'Mara crossed the quay in her grey cloak and waited for the ferry.']])
  return { db: w.db, sceneId: w.scenes[0] }
}

const options = (db: ReturnType<typeof testWorld>['db'], baseUrl = REMOTE) => ({
  db,
  model: model(baseUrl),
  signal: new AbortController().signal,
  closed: () => false,
  retryDelays: [0]
})

const patience = (o: StreamChatOptions) => ({ headersTimeoutMs: o.headersTimeoutMs, timeoutRetries: o.timeoutRetries })

beforeEach(() => {
  asked.length = 0
})

describe('background memory work and a provider that stops answering', () => {
  it('the memory reading a scene waits half a minute for a first answer and asks again once, then says so in plain words', async () => {
    const { db, sceneId } = scene()
    const got = await runScene(options(db), sceneId)
    expect(asked.map(patience)).toEqual([{ headersTimeoutMs: 30_000, timeoutRetries: 1 }])
    expect(got.status).toBe('failed')
    expect(got.status === 'failed' && got.error).toBe("The memory couldn't read Book 1, Ch 1, Sc 1: Fake didn't answer in time; try again in a moment.")
  })

  it('a scene summary and where things stand do the same', async () => {
    const { db, sceneId } = scene()
    expect(await writeSceneSummary(options(db), sceneId, null, 'Scene 1')).toBe(false)
    expect(await stateAfter(options(db), sceneId)).toBeNull()
    expect(asked.length).toBeGreaterThanOrEqual(2)
    for (const o of asked) expect(patience(o)).toEqual({ headersTimeoutMs: 30_000, timeoutRetries: 1 })
  })

  it('a program on this computer keeps the usual wait for a first answer (it may be loading its model)', async () => {
    const { db, sceneId } = scene()
    await runScene(options(db, 'http://127.0.0.1:1234/v1'), sceneId)
    expect(asked.map(patience)).toEqual([{ headersTimeoutMs: undefined, timeoutRetries: 1 }])
  })

  it('a request that is not background work keeps streamChat’s own patience', async () => {
    const { db, sceneId } = scene()
    await callModel({
      ...options(db),
      targetId: sceneId,
      job: 'summary',
      messages: [
        { role: 'system', content: 'You sum up scenes.' },
        { role: 'user', content: 'Sum this up.' }
      ],
      blocks: [],
      maxTokens: 300
    })
    expect(asked.map(patience)).toEqual([{ headersTimeoutMs: undefined, timeoutRetries: undefined }])
  })
})
