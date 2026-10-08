// The editor chat's tool loop in ai/tasks.ts, against a scripted provider (each request answered in turn from a list).
// Invented text only.
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import type { ChatMessage, ModelChoice, ToolCall, ToolSpec } from '@shared/types'
import { reachedWords } from '@shared/contracts/usage'
import { migrate } from '../db/migrations'
import * as repo from '../db/repo'
import * as gens from '../db/generations'
import { saveProposals } from '../db/ask'
import { setSpendHooks } from '../usage/gate'
import { failedKey, fitToRoom, messagesTokens, RESULT_REMOVED, runTask, type TaskRequest } from './tasks'
import { forgetParams } from './client'
import { STEP_PREAMBLE_WORDS, stepPreamble } from '../ask/history'

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

  it('nudges once by default, and up to maxNudges times when asked (chat routing), counting each attempt', async () => {
    const answers = (): ReturnType<typeof scripted> =>
      scripted([
        [text('Here is a darker version: ...'), finish('stop')],
        [text('Here is another darker version: ...'), finish('stop')],
        [text('Still only words.'), finish('stop')]
      ])
    const once = answers()
    const seen: number[] = []
    await runTask(request(once.fetchImpl, { nudge: (_a, attempt) => (seen.push(attempt), NUDGE) }, { maxSteps: 6 }))
    expect(once.sent).toHaveLength(2)
    expect(seen).toEqual([1])
    const twice = answers()
    const tries: number[] = []
    const done = await runTask(request(twice.fetchImpl, { nudge: (_a, attempt) => (tries.push(attempt), NUDGE), maxNudges: 2 }, { maxSteps: 6 }))
    expect(twice.sent).toHaveLength(3)
    expect(tries).toEqual([1, 2])
    expect(lastMessage(twice.sent[2])).toEqual({ role: 'user', content: NUDGE })
    // Each answer a nudge sent back is taken out of the reply.
    expect(done.text).toBe('Still only words.')
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

  it('keeps the finished params on the record: the steps and what extraParams adds, though no setting changed', async () => {
    const { fetchImpl } = scripted([
      [call(0, 'a1', 'read_scene'), finish('tool_calls')],
      [text('Odile, yes.'), finish('stop')]
    ])
    const req = request(fetchImpl, { extraParams: () => ({ intent: 'answer' as const }) })
    const done = await runTask(req)
    const params = gens.getGeneration(req.db, done.generationId).params
    expect(params.steps).toEqual([{ label: 'Used read_scene', tool: 'read_scene', arguments: '{}', result: 'result of a1' }])
    expect(params.intent).toBe('answer')
    expect(params.temperature).toBe(0.7)
  })

  it('keeps proposals as stored (what the writer made of each meanwhile), not as the answer last listed them', async () => {
    const { fetchImpl } = scripted([
      [call(0, 'a1', 'propose_changes', '{}'), finish('tool_calls')],
      [text('Proposed one change.'), finish('stop')]
    ])
    const proposal = { id: '1', status: 'pending' as const, why: 'Typo.', kind: 'newChapter' as const, storyId: 's1', title: 'The Ford' }
    let generationId = ''
    const req = request(fetchImpl, {
      run: async (calls) => {
        // Saved as it comes, then applied by the writer before the answer ends.
        saveProposals(req.db, generationId, [{ ...proposal, status: 'applied' }])
        return { results: calls.map((c) => ({ role: 'tool' as const, toolCallId: c.id, content: 'ok' })), steps: [] }
      },
      extraParams: () => ({ proposals: [proposal] })
    })
    const started = runTask(req)
    generationId = (req.db.prepare("SELECT id FROM generations WHERE job = 'chat'").get() as { id: string }).id
    const done = await started
    expect(gens.getGeneration(req.db, done.generationId).params.proposals).toEqual([{ ...proposal, status: 'applied' }])
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

describe('the chat overhaul’s hooks in the loop', () => {
  afterEach(() => forgetParams())
  const PROPOSE: ToolSpec = { name: 'propose_changes', description: 'Proposes changes.', parameters: { type: 'object', properties: {} } }
  const choiceOf = (s: Sent): unknown => (s as Record<string, unknown>).tool_choice

  it('ends the answer when the tools say so (ask_user): its words close the reply, nothing more is asked, no nudge', async () => {
    const { fetchImpl, sent } = scripted([
      [text('Two ways this could go.'), call(0, 'q1', 'ask_user', '{}'), finish('tool_calls')],
      [text('(never asked)'), finish('stop')]
    ])
    let asked = false
    const req = request(fetchImpl, {
      run: async (calls) => {
        asked = calls.some((c) => c.name === 'ask_user')
        return { results: calls.map((c) => ({ role: 'tool' as const, toolCallId: c.id, content: 'Asked.' })), steps: [] }
      },
      ended: () => (asked ? 'Which way?\n\n1. Odile lies\n2. Odile confesses' : null),
      nudge: () => NUDGE,
      extraParams: () => (asked ? { choice: { question: 'Which way?', options: [{ label: 'Odile lies' }, { label: 'Odile confesses' }] } } : {})
    })
    const done = await runTask(req)
    expect(sent).toHaveLength(1)
    expect(done.status).toBe('complete')
    expect(done.text).toBe('Two ways this could go.\n\nWhich way?\n\n1. Odile lies\n2. Odile confesses')
    expect(gens.getGeneration(req.db, done.generationId).params.choice).toMatchObject({ question: 'Which way?' })
  })

  it('makes one request call the tool asked for (tool_choice), with the same tools, and keeps that on the record', async () => {
    const { fetchImpl, sent } = scripted([
      [call(0, 'r1', 'read_scene'), finish('tool_calls')],
      [call(0, 'p1', 'propose_changes', '{"changes":[]}'), finish('tool_calls')],
      [text('Proposed one change.'), finish('stop')]
    ])
    let read = false
    let forced = false
    const req = request(fetchImpl, {
      tools: [...TOOLS, PROPOSE],
      run: async (calls) => {
        read ||= calls.some((c) => c.name === 'read_scene')
        return { results: calls.map((c) => ({ role: 'tool' as const, toolCallId: c.id, content: 'ok' })), steps: [] }
      },
      forceTool: () => {
        if (!read || forced) return null
        forced = true
        return 'propose_changes'
      }
    })
    const done = await runTask(req)
    expect(sent).toHaveLength(3)
    expect(choiceOf(sent[0])).toBeUndefined()
    expect(choiceOf(sent[1])).toEqual({ type: 'function', function: { name: 'propose_changes' } })
    expect(choiceOf(sent[2])).toBeUndefined()
    // The tools are the same list on every request that offers them.
    expect(sent[1].tools).toEqual(sent[0].tools)
    expect(sent[2].tools).toEqual(sent[0].tools)
    expect(gens.getGeneration(req.db, done.generationId).params.toolChoice).toEqual({ tool: 'propose_changes', step: 2 })
  })

  it('never forces the last request, which goes without tools', async () => {
    const { fetchImpl, sent } = scripted([
      [call(0, 'r1', 'read_scene'), finish('tool_calls')],
      [text('Done.'), finish('stop')]
    ])
    const done = await runTask(request(fetchImpl, { tools: [...TOOLS, PROPOSE], forceTool: () => 'propose_changes' }, { maxSteps: 2 }))
    expect(choiceOf(sent[0])).toEqual({ type: 'function', function: { name: 'propose_changes' } })
    expect(sent[1].tools).toBeUndefined()
    expect(choiceOf(sent[1])).toBeUndefined()
    expect(done.status).toBe('complete')
  })

  it('asks again letting the model choose when the provider turns tool_choice down, and notes it', async () => {
    const sent: Record<string, unknown>[] = []
    const fetchImpl = (async (_url: unknown, init?: { body?: unknown }) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      sent.push(body)
      if (body.tool_choice) {
        return new Response(JSON.stringify({ error: { message: 'tool_choice is not supported for this model' } }), {
          status: 400,
          headers: { 'content-type': 'application/json' }
        })
      }
      const chunks = [text('No change needed.'), finish('stop')]
      return new Response(chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n', {
        status: 200,
        headers: { 'content-type': 'text/event-stream' }
      })
    }) as unknown as typeof fetch
    let n = 0
    const req = request(fetchImpl, { tools: [...TOOLS, PROPOSE], forceTool: () => (n++ === 0 ? 'propose_changes' : null) })
    const done = await runTask(req)
    expect(done.status).toBe('complete')
    expect(sent.map((s) => 'tool_choice' in s)).toEqual([true, false])
    expect(gens.getGeneration(req.db, done.generationId).params.toolChoice).toEqual({ tool: 'propose_changes', step: 1, dropped: true })
  })

  it('leaves short narration written before tool calls out of the reply (the contract), keeping longer words and the answer', async () => {
    const long = `Two things matter here. ${'The tide scene runs long because the gulls and the ledger both get a full paragraph each, '.repeat(3)}so I will look at both.`
    const { fetchImpl, sent } = scripted([
      [text("I'll read the scene first."), call(0, 'a1', 'read_scene'), finish('tool_calls')],
      [text(long), call(0, 'a2', 'read_scene'), finish('tool_calls')],
      [text('Let me check the outline too.'), call(0, 'a3', 'read_scene'), finish('tool_calls')],
      [text('Odile, yes: scene two names her.'), finish('stop')]
    ])
    const progress: string[] = []
    const req = request(fetchImpl, { dropBeforeTools: stepPreamble }, { maxSteps: 6 })
    req.emit = (event, payload) => {
      if (event === 'task:progress') progress.push((payload as { text: string }).text)
    }
    const done = await runTask(req)
    expect(done.status).toBe('complete')
    expect(done.text).toBe(`${long}\n\nOdile, yes: scene two names her.`)
    const rec = gens.getGeneration(req.db, done.generationId)
    expect(rec.response).toBe(done.text)
    // The steps are as they were; the model is still sent what it wrote with its calls.
    expect(rec.params.steps?.map((s) => s.tool)).toEqual(['read_scene', 'read_scene', 'read_scene'])
    expect(sent[1].messages.find((m) => m.role === 'assistant')?.content).toBe("I'll read the scene first.")
    // The window is told once the words are taken out.
    expect(progress.some((t) => t === '')).toBe(true)
    expect(progress.at(-1) ?? done.text).not.toMatch(/I'll read the scene first/)
  })

  it('leaves the narration out before a question that ends the answer too; without the hook it stays', async () => {
    const replies = (): Chunk[][] => [[text('Let me ask you which one.'), call(0, 'q1', 'ask_user', '{}'), finish('tool_calls')]]
    const asking = (hook: boolean): Parameters<typeof request>[1] => {
      let asked = false
      return {
        run: async (calls) => {
          asked = true
          return { results: calls.map((c) => ({ role: 'tool' as const, toolCallId: c.id, content: 'Asked.' })), steps: [] }
        },
        ended: () => (asked ? 'Which scene?\n\n1. The ford\n2. The tower' : null),
        ...(hook ? { dropBeforeTools: stepPreamble } : {})
      }
    }
    const dropped = await runTask(request(scripted(replies()).fetchImpl, asking(true)))
    expect(dropped.text).toBe('Which scene?\n\n1. The ford\n2. The tower')
    const kept = await runTask(request(scripted(replies()).fetchImpl, asking(false)))
    expect(kept.text).toBe('Let me ask you which one.\n\nWhich scene?\n\n1. The ford\n2. The tower')
  })
})

describe('stepPreamble', () => {
  it('is short narration before tool calls: 40 words or fewer, and never nothing', () => {
    expect(stepPreamble("I'll read the scene first.")).toBe(true)
    expect(stepPreamble(Array.from({ length: STEP_PREAMBLE_WORDS }, () => 'word').join(' '))).toBe(true)
    expect(stepPreamble(Array.from({ length: STEP_PREAMBLE_WORDS + 1 }, () => 'word').join(' '))).toBe(false)
    expect(stepPreamble('  \n ')).toBe(false)
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

describe('tool calls shown as they start (chat Phase 2b)', () => {
  it('tells of each call as its name arrives, with its place and request, and runs each request’s calls with its number', async () => {
    const started: [number, string, number][] = []
    const ran: number[] = []
    const { fetchImpl } = scripted([
      [call(0, 'a1', 'read_scene'), call(1, 'a2', 'read_scene'), finish('tool_calls')],
      [call(0, 'b1', 'read_scene'), finish('tool_calls')],
      [text('Done.'), finish('stop')]
    ])
    const done = await runTask(
      request(fetchImpl, {
        onCallStart: (slot, name, step) => started.push([slot, name, step]),
        run: async (calls, step) => {
          ran.push(step)
          return { results: calls.map((c) => ({ role: 'tool' as const, toolCallId: c.id, content: 'ok' })), steps: [] }
        }
      })
    )
    expect(done.status).toBe('complete')
    expect(started).toEqual([
      [0, 'read_scene', 1],
      [1, 'read_scene', 1],
      [0, 'read_scene', 2]
    ])
    expect(ran).toEqual([1, 2])
  })
})

describe('the runaway guard (chat Phase 3)', () => {
  /** A run that fails each call with `say(call)`, its step marked as `status`. */
  const failing =
    (say: (c: ToolCall) => string, status = 'not-proposed', seen?: { cutOff: boolean }[]): NonNullable<TaskRequest['agent']>['run'] =>
    async (calls, _step, info) => {
      seen?.push({ cutOff: !!info?.cutOff })
      return {
        results: calls.map((c) => ({ role: 'tool' as const, toolCallId: c.id, content: say(c) })),
        steps: calls.map((c) => ({ label: 'x', tool: c.name, arguments: c.arguments, result: say(c), status }))
      }
    }
  const cutArgs = '{"changes": [{"kind": "rewrite", "replace": "The water moved under the gallery'

  it('tells the run a call was cut off at the reply limit', async () => {
    const seen: { cutOff: boolean }[] = []
    const { fetchImpl } = scripted([
      [call(0, 'a1', 'propose_changes', cutArgs), finish('length')],
      [call(0, 'a2', 'read_scene'), finish('tool_calls')],
      [text('Done.'), finish('stop')]
    ])
    await runTask(request(fetchImpl, { run: failing(() => 'cut', 'failed', seen) }, { maxSteps: 3 }))
    expect(seen).toEqual([{ cutOff: true }, { cutOff: false }])
  })

  it('ends the tools after the same call fails the same way twice in a row: the next request has none, with the last words', async () => {
    const { fetchImpl, sent } = scripted([
      [call(0, 'a1', 'propose_changes', cutArgs), finish('length')],
      [call(0, 'a2', 'propose_changes', cutArgs), finish('length')],
      [text('That rewrite was too long to send; I can do it in parts.'), finish('stop')]
    ])
    const done = await runTask(request(fetchImpl, { run: failing(() => 'Not proposed: your call was cut off.') }))
    expect(sent).toHaveLength(3)
    expect(sent[1].tools).toHaveLength(1)
    expect(sent[2].tools).toBeUndefined()
    expect(lastMessage(sent[2])).toEqual({ role: 'user', content: LAST })
    expect(done.status).toBe('complete')
    expect(done.text).toBe('That rewrite was too long to send; I can do it in parts.')
  })

  it('carries on when the failure changes, a call works, or the step doesn’t say how its calls went', async () => {
    // Two different failures: not the same twice, so the tools stay.
    let k = 0
    const varied = scripted([
      [call(0, 'a1', 'propose_changes', '{}'), finish('tool_calls')],
      [call(0, 'a2', 'propose_changes', '{}'), finish('tool_calls')],
      [call(0, 'a3', 'propose_changes', '{}'), finish('tool_calls')],
      [text('Done.'), finish('stop')]
    ])
    await runTask(request(varied.fetchImpl, { run: failing(() => `Not proposed: mistake ${++k}`) }))
    expect(varied.sent).toHaveLength(4)
    expect(varied.sent[3].tools).toHaveLength(1)
    // The same result each time from calls that worked: not a failure.
    const worked = scripted([
      [call(0, 'a1', 'read_scene'), finish('tool_calls')],
      [call(0, 'a2', 'read_scene'), finish('tool_calls')],
      [text('Done.'), finish('stop')]
    ])
    await runTask(request(worked.fetchImpl, { run: failing(() => 'the scene', 'done') }))
    expect(worked.sent[2].tools).toHaveLength(1)
    // Steps that don't say (the default run in these tests): never taken for failures.
    const plain = scripted([
      [call(0, 'a1', 'read_scene'), finish('tool_calls')],
      [call(0, 'a1', 'read_scene'), finish('tool_calls')],
      [text('Done.'), finish('stop')]
    ])
    await runTask(request(plain.fetchImpl, { run: async (calls) => ({ results: calls.map((c) => ({ role: 'tool' as const, toolCallId: c.id, content: 'same' })), steps: [] }) }))
    expect(plain.sent[2].tools).toHaveLength(1)
  })

  it('failedKey: a key only when every call of the step failed', () => {
    const calls: ToolCall[] = [
      { id: 'a', name: 'propose_changes', arguments: '{}' },
      { id: 'b', name: 'read_scene', arguments: '{}' }
    ]
    const results: ChatMessage[] = calls.map((c) => ({ role: 'tool', toolCallId: c.id, content: `no ${c.id}` }))
    const step = (status: string) => ({ label: 'x', tool: 't', arguments: '{}', result: '', status })
    expect(failedKey(calls, { results, steps: [step('failed'), step('not-proposed')] })).toBe('propose_changes\u0001no a\u0002read_scene\u0001no b')
    expect(failedKey(calls, { results, steps: [step('failed'), step('done')] })).toBeNull()
    expect(failedKey(calls, { results, steps: [] })).toBeNull()
    expect(failedKey([], { results: [], steps: [] })).toBeNull()
  })
})
