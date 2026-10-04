// Milestone 4's shared runner for AI calls that aren't scene drafts: the AI tools for selected words and
// Continue, Ask the world, the outline helper, next scene ideas and Read aloud's AI calls (see
// src/shared/contracts/tasks.ts). Each call is recorded with its job (so "What the AI saw" works for it),
// streams in the background, sends what has arrived to the window about every 40 ms ('task:progress'),
// saves it every half second (so a crash or a Stop keeps it), can be stopped (what arrived is kept) and
// ends with 'task:done'. A part that needs the whole reply (JSON, say) awaits runTask, which does the
// same and also resolves with the result. Never throws once started. No Electron imports: events go
// through the `emit` the caller passes in.

import type Database from 'better-sqlite3'
import type { AppEvents } from '@shared/api'
import type { TaskDone } from '@shared/contracts/tasks'
import type { AgentStep, ChatMessage, ContextBlock, GenerationJob, GenerationRecord, ID, ToolCall, ToolSpec } from '@shared/types'
import * as gens from '../db/generations'
import { estimateTokens } from '../keeper/text'
import { memoryReplyLimits, sentAs } from '../keeper/model'
import { newId, now, UserError } from '../util'
import { knownParams, levelOfEffort, streamChat, thinkingEffort, type SentParams, type StreamOutcome } from './client'
import { isKeyFailure } from './errors'
import { jobFailure, type JobModel } from './jobModel'

type DB = Database.Database
type GenerationParams = GenerationRecord['params']
export type Emit = <E extends keyof AppEvents>(event: E, payload: AppEvents[E]) => void

/** What has arrived goes to the window at most this often. */
export const PROGRESS_MS = 40
/** What has arrived is saved at most this often. */
export const SAVE_MS = 500
/** Context length assumed when the model's is unknown. */
export const DEFAULT_TASK_CONTEXT = 16_000

export interface TaskRequest {
  db: DB
  /** Made by the interface (any unique id), so every event can be matched to it. */
  taskId: ID
  /** The record's job ('edit', 'chat', 'outline', 'ideas', 'speech'...). */
  job: GenerationJob
  /** The scene it is about; empty or null for none (no Drafts list shows it). */
  sceneId?: ID | null
  model: JobModel
  messages: ChatMessage[]
  /** Room for the reply itself, in tokens. Thinking gets room on top, as the job's Thinking says. */
  reply: number
  temperature: number
  topP?: number
  /** min_p, sent only to OpenRouter (see ai/client.ts); left out when not given. */
  minP?: number
  /** Saved with the record and shown in "What the AI saw" (Adam's instruction or question). */
  direction?: string
  /** The briefing's blocks, for "What the AI saw" (none when the call has no briefing to show). */
  blocks?: ContextBlock[]
  /** Each memory entry sent, with the version (updatedAt) that was sent. */
  entries?: { entryId: ID; version: string }[]
  /** What the call was part of. */
  extra?: Pick<GenerationParams, 'variant' | 'beat' | 'tool' | 'chatId' | 'polishOf' | 'sounds'>
  emit: Emit
  /** The provider turned the key down, so Settings can show it isn't working. */
  onKeyRejected?: () => void
  /**
   * Story recipes: background work no window is listening to (the Recipe maker). A window reload or crash doesn't
   * stop it (stopAllTasks); Stop, or its own world or file closing, still does.
   */
  outlivesWindow?: boolean
  /**
   * The editor chat: tools the model may use on the way to its answer. Each time it asks for some, `run` answers
   * them (looking things up, or noting a change it proposes) and the model carries on, up to `maxSteps` requests;
   * the last is asked without tools, so it answers. What it writes along the way is the reply, step after step.
   */
  agent?: {
    tools: ToolSpec[]
    maxSteps: number
    run(calls: ToolCall[]): Promise<{ results: ChatMessage[]; steps: AgentStep[] }>
    /** Said to the model before the last request (the one without tools). */
    lastWords?: () => string
    /**
     * Looks at an answer given without tools: a note to send back once, asking for the tools after all (an answer
     * that says it made changes it never proposed), or null to keep the answer. The answer it replaces is taken out
     * of the reply.
     */
    nudge?: (answer: string) => string | null
    /** Kept with the record when it finishes (the editor chat's proposals). */
    extraParams?: () => Partial<GenerationParams>
  }
  /** For tests. */
  fetchImpl?: typeof fetch
  retryDelays?: number[]
}

export type TaskResult = TaskDone

interface Running {
  taskId: ID
  generationId: ID
  db: DB
  controller: AbortController
  text: string
  /** The world closed under this task: its record is already finished. */
  closed: boolean
  /** Not stopped when the window reloads (TaskRequest.outlivesWindow). */
  outlivesWindow: boolean
  done: Promise<TaskResult>
}

const running = new Map<ID, Running>()

export const isTaskRunning = (taskId: ID): boolean => running.has(taskId)

/** USD: the provider's figure, else tokens x the model's prices, else null. A request that never ran costs nothing. */
function costOf(outcome: StreamOutcome, model: JobModel, promptTokens: number): number | null {
  if (outcome.cost != null) return outcome.cost
  const f = outcome.failure?.type
  const neverRan =
    outcome.status === 'error' && !outcome.text && (f === 'http' || f === 'network' || f === 'timeout' || f === 'bad-response')
  const c = model.choice
  if (neverRan || c.promptPrice == null || c.completionPrice == null) return null
  return (
    (outcome.promptTokens ?? promptTokens) * c.promptPrice + (outcome.completionTokens ?? estimateTokens(outcome.text)) * c.completionPrice
  )
}

/** Starts a task in the background; its events say how it goes. Throws (plain words) only before anything starts. */
export function startTask(req: TaskRequest): { generationId: ID } {
  const r = begin(req)
  return { generationId: r.generationId }
}

/** Runs a task and resolves with how it ended (its events are sent as well). Throws (plain words) only before anything starts. */
export function runTask(req: TaskRequest): Promise<TaskResult> {
  return begin(req).done
}

function begin(req: TaskRequest): Running {
  if (!req.taskId) throw new UserError('Something went wrong starting that. Try again.')
  if (running.has(req.taskId)) throw new UserError('That is already being written. Stop it first, or wait for it to finish.')
  const { db, model } = req
  const generationId = newId()
  const contextLength = model.choice.contextLength && model.choice.contextLength > 0 ? model.choice.contextLength : DEFAULT_TASK_CONTEXT
  const promptTokens = estimateTokens(req.messages.map((m) => m.content).join('\n'))
  const reply = Math.max(64, Math.min(req.reply, model.choice.maxOutput ?? Infinity))
  // Thinking counts against the reply limit, so the limit leaves room for it (as the memory keeper's does).
  const { limit, thinkingRoom } = memoryReplyLimits({ ...model.choice, contextLength }, promptTokens, reply, model.thinking)
  const known = knownParams(model.target, model.choice.modelId)
  const start: SentParams = model.choice.sampling === false ? { ...known, sampling: false } : known
  const topP = req.topP ?? 0.95
  const asked = levelOfEffort(thinkingEffort(model.target, model.choice.modelId, model.thinking))
  // min_p is sent only to OpenRouter, with the other creativity settings (ai/client.ts), so only then is it noted.
  const minP = req.minP != null && start.sampling && start.minP !== false && model.target.kind === 'openrouter' ? req.minP : null
  const params: GenerationParams = {
    temperature: req.temperature,
    top_p: topP,
    ...(minP != null ? { min_p: minP } : {}),
    max_tokens: limit,
    ...(start.sampling ? {} : { sampling: false }),
    ...(asked ? { thinking: asked } : {}),
    ...(req.extra ?? {})
  }
  gens.insertGeneration(db, {
    id: generationId,
    sceneId: req.sceneId ?? '',
    job: req.job,
    providerId: model.target.id,
    providerName: model.target.name,
    modelId: model.choice.modelId,
    params,
    direction: (req.direction ?? '').slice(0, 4000),
    blocks: req.blocks ?? [],
    messages: req.messages,
    budget: { contextLength, reserved: limit, available: Math.max(0, contextLength - limit), used: promptTokens },
    entries: req.entries ?? [],
    createdAt: now()
  })
  const r: Running = {
    taskId: req.taskId,
    generationId,
    db,
    controller: new AbortController(),
    text: '',
    closed: false,
    outlivesWindow: !!req.outlivesWindow,
    done: Promise.resolve(null as unknown as TaskResult)
  }
  running.set(req.taskId, r)
  r.done = stream(r, req, { params, limit, reply, thinkingRoom, start, topP, promptTokens })
  return r
}

async function stream(
  r: Running,
  req: TaskRequest,
  o: { params: GenerationParams; limit: number; reply: number; thinkingRoom: number; start: SentParams; topP: number; promptTokens: number }
): Promise<TaskResult> {
  const { db, model, emit } = req
  let progressTimer: ReturnType<typeof setTimeout> | null = null
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  const progress = (): void => {
    progressTimer = null
    if (!r.closed) emit('task:progress', { taskId: r.taskId, generationId: r.generationId, job: req.job, text: r.text })
  }
  const save = (): void => {
    saveTimer = null
    if (r.closed || !db.open) return
    try {
      gens.saveResponse(db, r.generationId, r.text)
    } catch (e) {
      console.error('Could not save the reply so far', e)
    }
  }

  const once = (messages: ChatMessage[], tools: ToolSpec[] | undefined): Promise<StreamOutcome> =>
    streamChat({
      target: model.target,
      body: {
        model: model.choice.modelId,
        messages,
        temperature: req.temperature,
        top_p: o.topP,
        max_tokens: o.limit,
        min_p: req.minP ?? null,
        ...(tools?.length ? { tools } : {})
      },
      signal: r.controller.signal,
      onText: (t) => {
        r.text += t
        progressTimer ??= setTimeout(progress, PROGRESS_MS)
        saveTimer ??= setTimeout(save, SAVE_MS)
      },
      onRetry: (info) => emit('task:retrying', { taskId: r.taskId, ...info }),
      // A provider that turns the limit down is asked with the reply's own room, or less if that is turned down too.
      fallbackMaxTokens: o.limit > o.reply ? o.reply : o.reply > 2000 ? 2000 : undefined,
      startParams: o.start,
      thinking: model.thinking,
      thinkingRoom: o.thinkingRoom,
      fetchImpl: req.fetchImpl,
      delays: req.retryDelays
    }).catch((e: unknown): StreamOutcome => ({
      // streamChat doesn't throw; this is a last line of defence so the record always finishes.
      status: 'error',
      text: r.text,
      error: `Something went wrong: ${(e as Error)?.message ?? e}`,
      failure: null,
      promptTokens: null,
      cachedTokens: null,
      completionTokens: null,
      cost: null,
      finishReason: null,
      retries: 0,
      maxTokens: o.limit,
      cutOff: false,
      sentParams: o.start,
      effort: thinkingEffort(model.target, model.choice.modelId, model.thinking)
    }))
  // The editor chat: ask, answer the tools the model asks for, and ask again, until it answers without tools (or
  // the last step, asked without them). Tokens and cost add up over the steps; the words written along the way are
  // the reply.
  const steps: AgentStep[] = []
  // Where the latest request's words start in the reply, so an answer sent back by `nudge` can be taken out.
  let stepFrom = r.text.length
  let outcome = await once(req.messages, req.agent?.tools)
  if (req.agent) {
    let messages = req.messages
    const total = { prompt: outcome.promptTokens, cached: outcome.cachedTokens, completion: outcome.completionTokens, cost: outcome.cost }
    const add = (a: number | null, b: number | null): number | null => (a == null && b == null ? null : (a ?? 0) + (b ?? 0))
    let nudged = false
    for (let step = 1; outcome.status === 'complete' && step < req.agent.maxSteps; step++) {
      if (r.controller.signal.aborted) break
      if (!outcome.toolCalls?.length) {
        // An answer without tools: kept, unless it says it changed things it never proposed (asked once more).
        const nudge = nudged ? null : (req.agent.nudge?.(outcome.text) ?? null)
        if (!nudge) break
        nudged = true
        messages = [...messages, { role: 'assistant', content: outcome.text }, { role: 'user', content: nudge }]
        r.text = r.text.slice(0, stepFrom)
        progress()
        stepFrom = r.text.length
        outcome = await once(messages, req.agent.tools)
        total.prompt = add(total.prompt, outcome.promptTokens)
        total.cached = add(total.cached, outcome.cachedTokens)
        total.completion = add(total.completion, outcome.completionTokens)
        total.cost = add(total.cost, outcome.cost)
        continue
      }
      const calls = outcome.toolCalls
      let answered: Awaited<ReturnType<NonNullable<TaskRequest['agent']>['run']>>
      try {
        answered = await req.agent.run(calls)
      } catch (e) {
        answered = {
          results: calls.map((c) => ({
            role: 'tool' as const,
            toolCallId: c.id,
            content: `That didn't work: ${(e as Error)?.message ?? e}`
          })),
          steps: []
        }
      }
      steps.push(...answered.steps)
      messages = [...messages, { role: 'assistant', content: outcome.text, toolCalls: calls }, ...answered.results]
      if (r.text && !/\n\n$/.test(r.text)) {
        r.text += '\n\n'
        progressTimer ??= setTimeout(progress, PROGRESS_MS)
      }
      // The last step is asked without tools, so the model answers in words.
      const last = step === req.agent.maxSteps - 1
      const note = last ? req.agent.lastWords?.() : undefined
      if (note) messages = [...messages, { role: 'user', content: note }]
      stepFrom = r.text.length
      outcome = await once(messages, last ? undefined : req.agent.tools)
      total.prompt = add(total.prompt, outcome.promptTokens)
      total.cached = add(total.cached, outcome.cachedTokens)
      total.completion = add(total.completion, outcome.completionTokens)
      total.cost = add(total.cost, outcome.cost)
    }
    outcome = {
      ...outcome,
      text: r.text,
      promptTokens: total.prompt,
      cachedTokens: total.cached,
      completionTokens: total.completion,
      cost: total.cost
    }
    if (steps.length) o.params.steps = steps
    Object.assign(o.params, req.agent.extraParams?.() ?? {})
  }
  if (progressTimer) clearTimeout(progressTimer)
  if (saveTimer) clearTimeout(saveTimer)

  const status = r.closed ? 'stopped' : outcome.status
  const error = status !== 'error' ? null : outcome.failure ? jobFailure(outcome.failure, model) : outcome.error
  const cost = costOf(outcome, model, o.promptTokens)
  const cutOff = outcome.cutOff && status === 'complete'
  if (!r.closed && db.open) {
    try {
      // min_p turned down (or the creativity settings left out) on the way: the record says it wasn't sent.
      const minPDropped = o.params.min_p != null && (outcome.sentParams.minP === false || !outcome.sentParams.sampling)
      const { min_p: _minP, ...withoutMinP } = o.params
      const used = minPDropped ? (sentAs(withoutMinP, outcome) ?? withoutMinP) : sentAs(o.params, outcome)
      gens.finishGeneration(db, r.generationId, {
        status,
        error,
        response: outcome.text,
        promptTokens: outcome.promptTokens,
        cachedTokens: outcome.cachedTokens,
        completionTokens: outcome.completionTokens,
        cost,
        finishedAt: now(),
        // The reply limit and thinking as finally sent, so "What the AI saw" stays truthful.
        params: used ? { ...used, ...(cutOff ? { cutOff: true } : {}) } : cutOff ? { ...o.params, cutOff: true } : undefined
      })
    } catch (e) {
      console.error('Could not finish the record', e)
    }
  }
  running.delete(r.taskId)
  if (isKeyFailure(outcome.failure)) {
    try {
      req.onKeyRejected?.()
    } catch (e) {
      console.error('Could not note the key was turned down', e)
    }
  }
  const done: TaskResult = {
    taskId: r.taskId,
    generationId: r.generationId,
    job: req.job,
    text: outcome.text,
    status,
    error,
    cost,
    cutOff
  }
  emit('task:done', done)
  return done
}

/** Stops a task; what had arrived is kept. Resolves once its record is finished. */
export async function stopTask(taskId: ID): Promise<void> {
  const r = running.get(taskId)
  if (!r) return
  r.controller.abort()
  await r.done
}

/** The world is closing: stop its tasks and finish their records now, while the database is still open. */
export function stopTasksFor(db: DB): void {
  for (const r of running.values()) {
    if (r.db !== db) continue
    r.controller.abort()
    if (r.closed) continue
    r.closed = true
    try {
      gens.finishGeneration(db, r.generationId, {
        status: 'stopped',
        error: null,
        response: r.text,
        promptTokens: null,
        completionTokens: null,
        cost: null,
        finishedAt: now()
      })
    } catch (e) {
      console.error('Could not finish a record on close', e)
    }
  }
}

/** Stops every task (the window reloaded or crashed, so nothing is listening any more); their text is kept. */
export function stopAllTasks(): void {
  for (const [id, r] of [...running.entries()]) {
    if (r.outlivesWindow) continue
    void stopTask(id).catch((e) => console.warn('Could not stop a task', e))
  }
}

/** For tests: forget every task (as a fresh start would). */
export const resetTasksForTests = (): void => running.clear()
