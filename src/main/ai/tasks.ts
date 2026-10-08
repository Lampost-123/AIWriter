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
import { reachedWords } from '@shared/contracts/usage'
import { estimateTokens } from '../keeper/text'
import { memoryReplyLimits, sentAs } from '../keeper/model'
import { heldAt } from '../usage/gate'
import { toolRoomFor } from './toolRoom'
import { newId, now, UserError } from '../util'
import { knownParams, levelOfEffort, streamChat, thinkingEffort, type SentParams, type StreamOutcome } from './client'
import { isKeyFailure } from './errors'
import { jobFailure, type JobModel } from './jobModel'
import { SpeakerTagFilter, type WriterSpeaker } from './speakerTags'

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
     * of the reply. `attempt` counts the notes sent back so far, from 1.
     */
    nudge?: (answer: string, attempt: number) => string | null
    /** How many times `nudge` may send a note back in one answer (1 when left out). */
    maxNudges?: number
    /** Kept with the record when it finishes (the editor chat's proposals). */
    extraParams?: () => Partial<GenerationParams>
    /**
     * Asked after the tools of a step have run: words that end the answer there (the editor chat asked the writer a
     * question with options, ASKUSER), added to the reply with no more requests and no nudge; null to go on.
     */
    ended?: () => string | null
    /**
     * Asked before each request that offers tools: a tool the request must call (sent as tool_choice; TOOLCHOICE), or
     * null to let the model choose. A provider that turns tool_choice down is asked again without it (ai/client.ts).
     */
    forceTool?: () => string | null
  }
  /**
   * The writer was asked to tag who says each line (ai/speakerTags.ts): the tags are taken out of the text as it
   * streams, so they never reach the window or the record, and this hears what they said once it ends.
   */
  onSpeakers?: (speakers: WriterSpeaker[], generationId: ID) => void
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
  // The editor chat: the reply limit also leaves free the tools' own description and the room kept for what they bring
  // back over the steps (ai/toolRoom.ts, as its briefing did), so a small model's answer isn't turned down halfway.
  const agentRoom = req.agent ? toolsTokens(req.agent.tools) + toolRoomFor(contextLength) : 0
  // Thinking counts against the reply limit, so the limit leaves room for it (as the memory keeper's does).
  const { limit, thinkingRoom } = memoryReplyLimits({ ...model.choice, contextLength }, promptTokens + agentRoom, reply, model.thinking)
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
  r.done = stream(r, req, { params, limit, reply, thinkingRoom, start, topP, promptTokens, contextLength })
  return r
}

/** Said in place of a tool result taken out to keep the editor chat within the model's context (fitToRoom). */
export const RESULT_REMOVED = '[result removed to save room — call the tool again if you need it]'
/** Of the context, the share kept spare when the editor chat's messages are measured (estimates are rough). */
export const CONTEXT_SPARE = 0.05

/**
 * A fast, cautious estimate of the tokens messages take as sent (characters, as estimateTokens counts them): the
 * words, each tool call's name and arguments, any thinking sent back, and a little for each message's format.
 */
export function messagesTokens(messages: ChatMessage[]): number {
  let sum = 0
  for (const m of messages) {
    sum += estimateTokens(m.content) + 4
    if (m.reasoning) sum += estimateTokens(m.reasoning)
    for (const c of m.toolCalls ?? []) sum += estimateTokens(c.name) + estimateTokens(c.arguments) + 8
  }
  return sum
}

/** The tokens the tools' own description takes in a request, roughly. */
export const toolsTokens = (tools: ToolSpec[]): number => (tools.length ? estimateTokens(JSON.stringify(tools)) : 0)

/**
 * Keeps the editor chat's messages within `room` tokens (messagesTokens) by taking tool results out, oldest first
 * (each replaced by RESULT_REMOVED, so its call still has an answer): first those from earlier steps (before
 * `keepFrom`), then, only if that isn't enough, the newest. `fits` is false when the earlier ones weren't enough: the
 * model would only ask for the newest again, so the next request should be the last, without tools. Messages that
 * still don't fit with every result taken out are sent as they are (the provider says if they are too long).
 */
export function fitToRoom(messages: ChatMessage[], room: number, keepFrom: number): { messages: ChatMessage[]; removed: number; fits: boolean } {
  let size = messagesTokens(messages)
  if (size <= room) return { messages, removed: 0, fits: true }
  const out = [...messages]
  let removed = 0
  const takeOut = (from: number, to: number): void => {
    for (let i = from; i < to && size > room; i++) {
      const m = out[i]
      // A result no longer than the note saves nothing; one already taken out stays as it is.
      if (m.role !== 'tool' || m.content.length <= RESULT_REMOVED.length) continue
      size -= estimateTokens(m.content) - estimateTokens(RESULT_REMOVED)
      out[i] = { ...m, content: RESULT_REMOVED }
      removed++
    }
  }
  takeOut(0, Math.min(keepFrom, out.length))
  const fits = size <= room
  if (!fits) takeOut(keepFrom, out.length)
  return { messages: out, removed, fits }
}

async function stream(
  r: Running,
  req: TaskRequest,
  o: {
    params: GenerationParams
    limit: number
    reply: number
    thinkingRoom: number
    start: SentParams
    topP: number
    promptTokens: number
    contextLength: number
  }
): Promise<TaskResult> {
  const { db, model, emit } = req
  const tags = req.onSpeakers ? new SpeakerTagFilter() : null
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

  const once = (messages: ChatMessage[], tools: ToolSpec[] | undefined, force: string | null = null): Promise<StreamOutcome> =>
    streamChat({
      target: model.target,
      body: {
        model: model.choice.modelId,
        messages,
        temperature: req.temperature,
        top_p: o.topP,
        max_tokens: o.limit,
        min_p: req.minP ?? null,
        ...(tools?.length ? { tools } : {}),
        ...(tools?.length && force ? { tool_choice: { type: 'function' as const, function: { name: force } } } : {})
      },
      signal: r.controller.signal,
      onText: (raw) => {
        const t = tags ? tags.push(raw) : raw
        if (!t) return
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
  // the last request, always asked without them). Tokens and cost add up over the steps; the words written along the
  // way are the reply.
  const steps: AgentStep[] = []
  const agent = req.agent
  // Where the latest request's words start in the reply, so an answer sent back by `nudge` can be taken out.
  let stepFrom = r.text.length
  // With a single step, the first request is the last: it goes without tools.
  const firstTools = agent && agent.maxSteps > 1 ? agent.tools : undefined
  // A request made to call a tool (TOOLCHOICE): at most one per answer, never once the model has turned it down.
  let canForce = o.start.toolChoice !== false
  const forceFor = (step: number): string | null => {
    const tool = canForce ? (agent?.forceTool?.() ?? null) : null
    if (tool) o.params.toolChoice = { tool, step }
    return tool
  }
  const forcedTurnedDown = (r: StreamOutcome): void => {
    if (r.sentParams.toolChoice !== false) return
    canForce = false
    if (o.params.toolChoice && !o.params.toolChoice.dropped) o.params.toolChoice = { ...o.params.toolChoice, dropped: true }
  }
  let outcome = await once(req.messages, firstTools, firstTools ? forceFor(1) : null)
  forcedTurnedDown(outcome)
  if (agent) {
    let messages = req.messages
    const total = { prompt: outcome.promptTokens, cached: outcome.cachedTokens, completion: outcome.completionTokens, cost: outcome.cost }
    const add = (a: number | null, b: number | null): number | null => (a == null && b == null ? null : (a ?? 0) + (b ?? 0))
    const toolsSize = toolsTokens(agent.tools)
    // What the answer has cost so far (not in a finished record yet), counted when the monthly limit is checked.
    let spent = costOf(outcome, model, o.promptTokens) ?? 0
    // The room the messages have: the context, less the reply limit and a little spare. The estimate is corrected by
    // what the provider counted for the latest request, when it says (estimates run high for English prose).
    const room = o.contextLength - o.limit - Math.ceil(o.contextLength * CONTEXT_SPARE)
    const correction = (sent: ChatMessage[], tools: ToolSpec[] | undefined, counted: number | null): number | null => {
      if (counted == null || counted <= 0) return null
      const guess = messagesTokens(sent) + (tools?.length ? toolsSize : 0)
      return Math.max(counted - guess, -Math.round(guess * 0.3))
    }
    let corrected = correction(req.messages, firstTools, outcome.promptTokens) ?? 0
    let nudged = 0
    /** The monthly spending limit was reached partway (its amount): the answer stops there and says so. */
    let heldBy: number | null = null
    for (let step = 1; outcome.status === 'complete' && step < agent.maxSteps; step++) {
      if (r.controller.signal.aborted) break
      const calls = outcome.toolCalls ?? []
      let nudge: string | null = null
      // An answer without tools: kept, unless it says it changed things it never proposed (asked once more).
      if (!calls.length) {
        nudge = nudged >= (agent.maxNudges ?? 1) ? null : (agent.nudge?.(outcome.text, nudged + 1) ?? null)
        if (!nudge) break
      }
      // Another request is coming, and every request costs: the monthly limit is asked again before each (before any
      // tool runs or any words are taken back), with what this answer has spent so far.
      heldBy = heldAt(spent)
      if (heldBy != null) break
      let next: ChatMessage[]
      let results: ChatMessage[] = []
      if (nudge) {
        nudged++
        next = [...messages, { role: 'assistant', content: outcome.text }]
        r.text = r.text.slice(0, stepFrom)
        progress()
      } else {
        let answered: Awaited<ReturnType<NonNullable<TaskRequest['agent']>['run']>>
        try {
          answered = await agent.run(calls)
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
        results = answered.results
        // The tools ended the answer (a question for the writer, ASKUSER): its words close the reply, nothing more is asked.
        const closing = agent.ended?.() ?? null
        if (closing) {
          r.text = r.text.replace(/\s+$/, '')
          r.text += `${r.text ? '\n\n' : ''}${closing}`
          progressTimer ??= setTimeout(progress, PROGRESS_MS)
          break
        }
        // The thinking that came with the calls goes back with them (ai/client.ts sentMessages); never shown.
        next = [
          ...messages,
          { role: 'assistant', content: outcome.text, toolCalls: calls, ...(outcome.reasoning ? { reasoning: outcome.reasoning } : {}) }
        ]
      }
      // Tool results from this step are the newest: taken out only when the older ones aren't enough.
      const keepFrom = next.length
      next = [...next, ...results]
      // The last request goes without tools, with the last words, so the model answers in words: at the last step,
      // or sooner when the tool results no longer fit beside the briefing (the model would only ask for them again).
      let last = step === agent.maxSteps - 1
      const lastWords = agent.lastWords?.() ?? ''
      const notes = estimateTokens(nudge ?? '') + estimateTokens(lastWords) + 8
      const fitted = fitToRoom(next, room - corrected - toolsSize - notes, keepFrom)
      if (!fitted.fits) last = true
      messages = fitted.messages
      // A nudge asks for tools; on the last request, which has none, the last words go instead.
      const note = last ? lastWords || nudge : nudge
      if (note) messages = [...messages, { role: 'user', content: note }]
      if (r.text && !/\n\n$/.test(r.text)) {
        r.text += '\n\n'
        progressTimer ??= setTimeout(progress, PROGRESS_MS)
      }
      stepFrom = r.text.length
      const tools = last ? undefined : agent.tools
      outcome = await once(messages, tools, tools ? forceFor(step + 1) : null)
      forcedTurnedDown(outcome)
      total.prompt = add(total.prompt, outcome.promptTokens)
      total.cached = add(total.cached, outcome.cachedTokens)
      total.completion = add(total.completion, outcome.completionTokens)
      total.cost = add(total.cost, outcome.cost)
      spent += costOf(outcome, model, messagesTokens(messages)) ?? 0
      corrected = correction(messages, tools, outcome.promptTokens) ?? corrected
      if (last) break
    }
    outcome = {
      ...outcome,
      text: r.text,
      promptTokens: total.prompt,
      cachedTokens: total.cached,
      completionTokens: total.completion,
      cost: total.cost
    }
    if (heldBy != null && !r.controller.signal.aborted) {
      // Stopped cleanly at the limit: what was written is kept, and the chat says why it stopped (as a refused call does).
      outcome = {
        ...outcome,
        status: 'error',
        failure: null,
        cutOff: false,
        error: `${reachedWords(heldBy)}${r.text.trim() ? ' The text that arrived is kept.' : ''}`
      }
    }
    if (steps.length) o.params.steps = steps
    Object.assign(o.params, agent.extraParams?.() ?? {})
  }
  if (progressTimer) clearTimeout(progressTimer)
  if (saveTimer) clearTimeout(saveTimer)
  if (tags) {
    r.text += tags.flush()
    outcome = { ...outcome, text: r.text }
  }

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
      // The chat overhaul's notes on the answer (a question it ended with, a request made to call a tool) are always kept.
      const kept = used ?? (cutOff || tags || o.params.choice || o.params.toolChoice ? o.params : undefined)
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
        params: kept
          ? { ...kept, ...(cutOff ? { cutOff: true } : {}), ...(tags ? { speakerTags: tags.coverage(r.text) } : {}) }
          : undefined
      })
    } catch (e) {
      console.error('Could not finish the record', e)
    }
  }
  running.delete(r.taskId)
  if (tags) {
    try {
      req.onSpeakers?.(tags.speakers(r.text), r.generationId)
    } catch (e) {
      console.error('Could not keep who says each line', e)
    }
  }
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
