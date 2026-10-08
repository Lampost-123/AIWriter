// The editor chat's tool loop in ai/tasks.ts, against a scripted provider (each request answered in turn from a list).
// Invented text only.
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import type { ChatMessage, ModelChoice, ToolCall, ToolSpec } from '@shared/types'
import { reachedWords } from '@shared/contracts/usage'
import { migrate } from '../db/migrations'
import * as repo from '../db/repo'
import * as gens from '../db/generations'
import { setSpendHooks } from '../usage/gate'
import { fitToRoom, messagesTokens, RESULT_REMOVED, runTask, type TaskRequest } from './tasks'

type Chunk = Record<string, unknown>
type Sent = { tools?: unknown[]; messages: Record<string, unknown>[] }

const text = (t: string): Chunk => ({ choices: [{ delta: { content: t }, finish_reason: null }] })
const call = (index: number, id: string, name: string, args = '{}'): Chunk => ({
  choices: [{ delta: { tool_calls: [{ index, id, type: 'function', function: { name, arguments: args } }] }, finish_reason: null }]
})
const finish = (reason: string): Chunk => ({ choices: [{ delta: {}, finish_reason: reason }] })
const usage = (cost: number): Chunk => ({ choices: [], usage: { prompt_tokens: 50, completion_tokens: 10, cost } })

/** A provider that answers each request with the next reply in the list, and keeps what each request sent. */
function scripted(replies: Chunk[][]): { fetchImpl: typeof fetch; sent: Sent[] } {
  const sent: Sent[] = []
  const fetchImpl = (async (_url: unknown, init?: { body?: unknown }) => {
    sent.push(JSON.parse(String(init?.body)) as Sent)
    const chunks = replies[sent.length - 1] ?? [text('(nothing more scripted)'), finish('stop')]
    const body = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n'
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }) as unknown as typeof fetch
  return { fetchImpl, sent }
}

function world() {
  const db = new Database(':memory:')
  migrate(db)
  repo.initWorld(db, 'w1', 'Test world')
  return db
}

const TOOLS: ToolSpec[] = [{ name: 'read_scene', description: 'Reads a scene.', parameters: { type: 'object', properties: {} } }]
const LAST = '[last words] No more tools. Answer now.'
const NUDGE = '[nudge] Propose them with the tools.'

const choice = (contextLength: number): ModelChoice => ({
  providerId: 'p1',
  modelId: 'scripted/model',
  label: 'Scripted',
  contextLength,
  promptPrice: 0.000001,
  completionPrice: 0.000002
})

let taskNo = 0
function request(
  fetchImpl: typeof fetch,
  agent: Partial<NonNullable<TaskRequest['agent']>> & { run?: NonNullable<TaskRequest['agent']>['run'] },
  over: { contextLength?: number; maxSteps?: number } = {}
): TaskRequest {
  const run: NonNullable<TaskRequest['agent']>['run'] =
    agent.run ??
    (async (calls: ToolCall[]) => ({
      results: calls.map((c) => ({ role: 'tool' as const, toolCallId: c.id, content: `result of ${c.id}` })),
      steps: calls.map((c) => ({ label: `Used ${c.name}`, tool: c.name, arguments: c.arguments, result: `result of ${c.id}` }))
    }))
  return {
    db: world(),
    taskId: `agent-${++taskNo}`,
    job: 'chat',
    model: { job: 'chat', target: { id: 'p1', name: 'Scripted', kind: 'custom', baseUrl: 'http://scripted.test', apiKey: 'k' }, choice: choice(over.contextLength ?? 32_000), thinking: 'off' },
    messages: [
      { role: 'system', content: 'You help a novelist with the Brass Lantern Inn.' },
      { role: 'user', content: 'Is the innkeeper called Odile in scene two?' }
    ],
    reply: 400,
    temperature: 0.7,
    emit: () => undefined,
    retryDelays: [1],
    fetchImpl,
    agent: { tools: TOOLS, maxSteps: over.maxSteps ?? 12, lastWords: () => LAST, ...agent, run }
  }
}

const toolContents = (s: Sent): unknown[] => s.messages.filter((m) => m.role === 'tool').map((m) => m.content)
const lastMessage = (s: Sent): Record<string, unknown> => s.messages[s.messages.length - 1]

afterEach(() => setSpendHooks(null))

describe('the editor chat tool loop', () => {
  it('runs the tools in the order asked, then asks the last request without tools and with the last words', async () => {
    const ran: string[][] = []
    const { fetchImpl, sent } = scripted([
      [text('Looking first.'), call(0, 'a1', 'read_scene', '{"n":1}'), call(1, 'a2', 'read_scene', '{"n":2}'), finish('tool_calls')],
      [call(0, 'b1', 'read_scene'), finish('tool_calls')],
      [text('Odile, yes.'), finish('stop')]
    ])
    const done = await runTask(
      request(fetchImpl, {
        run: async (calls) => {
          ran.push(calls.map((c) => c.id))
          return { results: calls.map((c) => ({ role: 'tool' as const, toolCallId: c.id, content: `result of ${c.id}` })), steps: [] }
        }
      }, { maxSteps: 3 })
    )
    expect(done.status).toBe('complete')
    expect(ran).toEqual([['a1', 'a2'], ['b1']])
    expect(sent).toHaveLength(3)
    expect(sent[0].tools).toHaveLength(1)
    expect(sent[1].tools).toHaveLength(1)
    // The last request: no tools, the last words last, every result answered in order.
    expect(sent[2].tools).toBeUndefined()
    expect(lastMessage(sent[2])).toEqual({ role: 'user', content: LAST })
    expect(toolContents(sent[2])).toEqual(['result of a1', 'result of a2', 'result of b1'])
    expect(sent[1].messages.filter((m) => m.role === 'tool').map((m) => m.tool_call_id)).toEqual(['a1', 'a2'])
    expect(done.text).toBe('Looking first.\n\nOdile, yes.')
  })

  it('sends a nudge with the tools before the last step', async () => {
    const { fetchImpl, sent } = scripted([
      [text("I've fixed the line for you."), finish('stop')],
      [call(0, 'p1', 'read_scene'), finish('tool_calls')],
      [text('Proposed one change.'), finish('stop')]
    ])
    const done = await runTask(request(fetchImpl, { nudge: (a) => (/fixed/.test(a) ? NUDGE : null) }, { maxSteps: 5 }))
    expect(sent[1].tools).toHaveLength(1)
    expect(lastMessage(sent[1])).toEqual({ role: 'user', content: NUDGE })
    expect(sent).toHaveLength(3)
    // The answer the nudge sent back is taken out of the reply.
    expect(done.text).toBe('Proposed one change.')
  })

  it('never nudges with tools on the last step: the last request goes without them, with the last words (E15)', async () => {
    const { fetchImpl, sent } = scripted([
      [call(0, 'a1', 'read_scene'), finish('tool_calls')],
      [text("I've fixed the line for you."), finish('stop')],
      [text('Here is what I would change, if you ask.'), finish('stop')]
    ])
    const done = await runTask(request(fetchImpl, { nudge: (a) => (/fixed/.test(a) ? NUDGE : null) }, { maxSteps: 3 }))
    expect(sent).toHaveLength(3)
    expect(sent[2].tools).toBeUndefined()
    expect(lastMessage(sent[2])).toEqual({ role: 'user', content: LAST })
    expect(sent[2].messages.some((m) => m.content === NUDGE)).toBe(false)
    expect(done.status).toBe('complete')
    expect(done.text).toBe('Here is what I would change, if you ask.')
  })

  it('takes the oldest tool results out when they no longer fit, and keeps the newest (E11)', async () => {
    const long = (tag: string): string => `${tag} `.repeat(1000) // 4,000 characters, about 1,150 tokens
    const { fetchImpl, sent } = scripted([
      [call(0, 'r1', 'read_scene'), finish('tool_calls')],
      [call(0, 'r2', 'read_scene'), finish('tool_calls')],
      [call(0, 'r3', 'read_scene'), finish('tool_calls')],
      [text('Done reading.'), finish('stop')]
    ])
    const results: Record<string, string> = { r1: long('one'), r2: long('two'), r3: long('six') }
    const done = await runTask(
      request(
        fetchImpl,
        { run: async (calls) => ({ results: calls.map((c) => ({ role: 'tool' as const, toolCallId: c.id, content: results[c.id] })), steps: [] }) },
        // 8,000 tokens: a reply limit of 4,400 leaves the messages about 3,200, so the third result doesn't fit beside two others.
        { contextLength: 8000 }
      )
    )
    expect(done.status).toBe('complete')
    expect(sent).toHaveLength(4)
    expect(toolContents(sent[2])).toEqual([results.r1, results.r2])
    // The fourth request still has its tools: the oldest result is taken out, the newer ones kept.
    expect(sent[3].tools).toHaveLength(1)
    expect(toolContents(sent[3])).toEqual([RESULT_REMOVED, results.r2, results.r3])
    expect(done.text).toBe('Done reading.')
  })

  it('goes straight to the last request, without tools, when the newest results alone are too big (E11)', async () => {
    const { fetchImpl, sent } = scripted([
      [call(0, 'big', 'read_scene'), finish('tool_calls')],
      [text('That scene is too long to read here.'), finish('stop')]
    ])
    const done = await runTask(
      request(
        fetchImpl,
        { run: async (calls) => ({ results: calls.map((c) => ({ role: 'tool' as const, toolCallId: c.id, content: 'word '.repeat(4000) })), steps: [] }) },
        { contextLength: 8000 }
      )
    )
    expect(sent).toHaveLength(2)
    expect(sent[1].tools).toBeUndefined()
    expect(lastMessage(sent[1])).toEqual({ role: 'user', content: LAST })
    expect(toolContents(sent[1])).toEqual([RESULT_REMOVED])
    expect(done.status).toBe('complete')
  })

  it('stops at the monthly limit partway, keeping what was written, and says so (E16)', async () => {
    const asked: number[] = []
    setSpendHooks({
      held: (extra = 0) => {
        asked.push(extra)
        return extra >= 0.015 ? 5 : null
      },
      finished: () => undefined
    })
    const { fetchImpl, sent } = scripted([
      [text('Checking scene two.'), call(0, 'a1', 'read_scene'), finish('tool_calls'), usage(0.01)],
      [text('Now scene three.'), call(0, 'a2', 'read_scene'), finish('tool_calls'), usage(0.01)],
      [text('Never asked.'), finish('stop')]
    ])
    const req = request(fetchImpl, {})
    const done = await runTask(req)
    expect(sent).toHaveLength(2)
    expect(done.status).toBe('error')
    expect(done.error).toBe(`${reachedWords(5)} The text that arrived is kept.`)
    expect(done.text).toBe('Checking scene two.\n\nNow scene three.')
    // Asked when the call was recorded (nothing spent yet), then before each later request with what was spent.
    expect(asked[0]).toBe(0)
    expect(asked.slice(1)).toEqual([0.01, 0.02])
    const rec = gens.getGeneration(req.db, done.generationId)
    expect(rec.status).toBe('error')
    expect(rec.response).toBe(done.text)
    expect(rec.cost).toBeCloseTo(0.02)
  })

  it('sends the thinking back with the tool calls it came with, and never shows it (E13)', async () => {
    const think = (t: string): Chunk => ({ choices: [{ delta: { reasoning_content: t }, finish_reason: null }] })
    const { fetchImpl, sent } = scripted([
      [think('The innkeeper '), think('is named early on.'), call(0, 'a1', 'read_scene'), finish('tool_calls')],
      [call(0, 'a2', 'read_scene'), finish('tool_calls')],
      [think('Enough.'), text('Odile.'), finish('stop')]
    ])
    const done = await runTask(request(fetchImpl, {}))
    const assistants = (s: Sent): Record<string, unknown>[] => s.messages.filter((m) => m.role === 'assistant')
    expect(assistants(sent[1])[0].reasoning_content).toBe('The innkeeper is named early on.')
    // A turn the model sent no thinking with goes back without any.
    expect('reasoning_content' in assistants(sent[2])[1]).toBe(false)
    expect(done.text).toBe('Odile.')
    expect(done.text).not.toMatch(/innkeeper|Enough/)
  })
})

describe('fitToRoom', () => {
  const msgs = (...contents: string[]): ChatMessage[] => [
    { role: 'system', content: 'brief' },
    ...contents.map((c, i) => ({ role: 'tool' as const, toolCallId: `c${i}`, content: c }))
  ]

  it('leaves messages that fit alone', () => {
    const m = msgs('x'.repeat(700))
    expect(fitToRoom(m, messagesTokens(m), 1)).toEqual({ messages: m, removed: 0, fits: true })
  })

  it('takes out older results first, then the newest only when that is not enough', () => {
    const m = msgs('a'.repeat(3500), 'b'.repeat(3500), 'c'.repeat(3500))
    const room = messagesTokens(m) - 500
    const one = fitToRoom(m, room, 3)
    expect(one.fits).toBe(true)
    expect(one.messages.map((x) => x.content.slice(0, 1))).toEqual(['b', '[', 'b', 'c'])
    // Room for one result and a little: the older two aren't enough, so it doesn't fit, and the newest goes too.
    const tight = fitToRoom(m, messagesTokens(msgs('', '', '')) + 1000, 3)
    expect(tight.fits).toBe(false)
    expect(tight.removed).toBe(3)
    expect(tight.messages.slice(1).map((x) => x.content)).toEqual([RESULT_REMOVED, RESULT_REMOVED, RESULT_REMOVED])
    // With room for the newest, it stays.
    const roomy = fitToRoom(m, messagesTokens(msgs('', '', '')) + 1100, 3)
    expect(roomy.fits).toBe(true)
    expect(roomy.messages.slice(1).map((x) => x.content)).toEqual([RESULT_REMOVED, RESULT_REMOVED, 'c'.repeat(3500)])
  })
})
