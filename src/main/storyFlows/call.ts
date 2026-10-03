// Calls the model for a story flow: one request, saved as a generation record (job 'story', no scene)
// so "What the AI saw" works for it, streamed with streamChat (which retries rate limits and server
// errors and hides "thinking"). A reply that can't be read is asked for once more, saying what was
// wrong. Never throws: the result says what happened, in plain words when it went wrong. No Electron
// imports.

import type Database from 'better-sqlite3'
import type { ChatMessage, ContextBlock, ID, ModelChoice, ThinkingLevel } from '@shared/types'
import * as gens from '../db/generations'
import { knownParams, levelOfEffort, streamChat, thinkingEffort, type ChatTarget, type SentParams } from '../ai/client'
import { describeFailure, providerWho, type Failure } from '../ai/errors'
import { estimateTokens } from '../keeper/text'
import { CUT_OFF, parseLenient } from '../keeper/json'
import { memoryReplyLimits, sentAs } from '../keeper/model'
import { newId, now } from '../util'
import { retryMessage } from './prompts'

type DB = Database.Database

/** The model a flow uses and how to reach it (see flowTarget in model.ts). */
export interface FlowModel {
  target: ChatTarget & { id: ID }
  choice: ModelChoice
  /** How much the model is asked to think: the memory's Thinking in Settings › Models (Off when not said). */
  thinking?: ThinkingLevel
}

/** A little room to invent (a time gap, a younger cast), but not much: the flows keep to the world. */
export const FLOW_TEMPERATURE = 0.4
/** Context length assumed when the model's is unknown. */
export const DEFAULT_FLOW_CONTEXT = 16_000
/** Room for the reply: generous, as a model that thinks first can spend most of it thinking. */
export const FLOW_REPLY_TOKENS = 8000
/** What a reply limit the provider turns down is lowered to, once. */
const FALLBACK_REPLY_TOKENS = 2000

/** When no memory model (or writer model) is chosen. */
export const NO_FLOW_MODEL = 'Choose a memory model in Settings › Models, then try again.'
const OTHER_MODEL = 'pick another memory model in Settings › Models'
const PICK_ANOTHER = `${OTHER_MODEL[0].toUpperCase()}${OTHER_MODEL.slice(1)}.`
export const EMPTY_REPLY = `The model didn't answer. Try again, or ${OTHER_MODEL}.`
export const BROKEN_REPLY = `The model's answer couldn't be read. Try again, or ${OTHER_MODEL}.`
export const CUT_REPLY = `The model's answer was cut short. Try again, or ${OTHER_MODEL}.`
export const TOO_SMALL = 'The memory model can take too little text at once. Pick another memory model in Settings › Models.'
export const REFUSED = `The memory model turned this down. ${PICK_ANOTHER}`
export const TOO_MUCH =
  'That was too much for the memory model to read at once. Pick a memory model that can read more in Settings › Models.'
export const REPLY_TOO_LONG = `The memory model can't write that much in one reply. ${PICK_ANOTHER}`

/** How much of the model's window a flow may use. */
export interface FlowBudget {
  contextLength: number
  /** Room kept for the reply. */
  reply: number
  /** Tokens for the request besides its instructions. */
  available: number
}

export function flowBudget(choice: Pick<ModelChoice, 'contextLength' | 'maxOutput'>, instructions: string): FlowBudget | null {
  const contextLength = choice.contextLength && choice.contextLength > 0 ? choice.contextLength : DEFAULT_FLOW_CONTEXT
  let reply = Math.min(FLOW_REPLY_TOKENS, Math.floor(contextLength * 0.45))
  if (choice.maxOutput && choice.maxOutput > 0) reply = Math.min(reply, choice.maxOutput)
  reply = Math.max(reply, Math.min(600, contextLength >> 2))
  const available = Math.floor(contextLength * 0.9) - reply - estimateTokens(instructions)
  if (available < 300) return null
  return { contextLength, reply, available }
}

/**
 * What the writer is told that doesn't fit a story flow (the draft's length options, the scene card, a
 * refused scene), by how describeFailure starts it, and what a flow says instead. Matching its words
 * keeps the same reading of the provider's error; flows.test.ts pins each one.
 */
const DRAFT_ONLY: [string, string][] = [
  ['This model refused the scene.', REFUSED],
  ['The briefing and the length you asked for are too much', TOO_MUCH],
  ["This model can't write that much in one reply.", REPLY_TOO_LONG]
]

/** The provider's words for a failure, reworded for a story flow (asked to think as `thinking` says). */
export function flowFailure(f: Failure, target: ChatTarget, modelId: string, thinking: ThinkingLevel = 'off'): string {
  switch (f.type) {
    case 'refused':
      return REFUSED
    case 'empty':
      if (f.thinking && thinking === 'off') {
        return `The memory model thinks even with Thinking off, and used up its room before it answered. ${PICK_ANOTHER}`
      }
      if (f.thinking) {
        return "The memory model used up its room thinking and didn't answer. Set the memory's Thinking to Off in Settings › Models, or pick another memory model."
      }
      return EMPTY_REPLY
    case 'dropped':
      return `The connection to ${providerWho(target)} dropped before the model had finished. Try again in a moment.`
    default: {
      const said = describeFailure(
        f,
        { name: target.name, kind: target.kind, baseUrl: target.baseUrl, hasKey: !!target.apiKey },
        { during: 'draft', modelId }
      )
      const instead = DRAFT_ONLY.find(([start]) => said.startsWith(start))?.[1]
      return instead ?? said.replace(/writer model/g, 'memory model').replace(/ The text that arrived is kept\.$/, '')
    }
  }
}

export interface FlowCallOptions {
  db: DB
  model: FlowModel
  messages: ChatMessage[]
  blocks: ContextBlock[]
  /** Entries the request told the model about, with their version, for "What the AI saw". */
  entries: { entryId: ID; version: string }[]
  budget: FlowBudget
  signal: AbortSignal
  /** True once the world has closed: nothing more is written. */
  closed: () => boolean
  fetchImpl?: typeof fetch
  retryDelays?: number[]
}

/** Tokens and cost of a flow's calls, added up (null when nothing was reported), and their records. */
export interface CallTotals {
  promptTokens: number | null
  completionTokens: number | null
  cost: number | null
  generationIds: ID[]
}

export type FlowCall<T> =
  | { status: 'ok'; value: T; totals: CallTotals }
  | { status: 'stopped'; totals: CallTotals }
  | { status: 'failed'; error: string; totals: CallTotals }

interface OneCall {
  generationId: ID
  status: 'complete' | 'stopped' | 'error'
  text: string
  error: string | null
  cutOff: boolean
  promptTokens: number | null
  completionTokens: number | null
  cost: number | null
}

function addUp(t: CallTotals, c: OneCall): void {
  t.generationIds.push(c.generationId)
  if (c.promptTokens != null) t.promptTokens = (t.promptTokens ?? 0) + c.promptTokens
  if (c.completionTokens != null) t.completionTokens = (t.completionTokens ?? 0) + c.completionTokens
  if (c.cost != null) t.cost = (t.cost ?? 0) + c.cost
}

/** USD: the provider's own figure, else tokens times the model's prices, else null. */
function callCost(
  o: { cost: number | null; promptTokens: number | null; completionTokens: number | null },
  choice: ModelChoice,
  prompt: number,
  reply: string
): number | null {
  if (o.cost != null) return o.cost
  if (choice.promptPrice == null || choice.completionPrice == null) return null
  return (o.promptTokens ?? prompt) * choice.promptPrice + (o.completionTokens ?? estimateTokens(reply)) * choice.completionPrice
}

async function callOnce(o: FlowCallOptions, messages: ChatMessage[]): Promise<OneCall> {
  const id = newId()
  const { contextLength, reply } = o.budget
  const promptTokens = estimateTokens(messages.map((m) => m.content).join('\n'))
  const known = knownParams(o.model.target, o.model.choice.modelId)
  const start: SentParams = o.model.choice.sampling === false ? { ...known, sampling: false } : known
  // Thinking counts against the reply limit, so the limit leaves room for it (as the memory keeper's does).
  const thinking = o.model.thinking ?? 'off'
  const { limit, thinkingRoom } = memoryReplyLimits({ ...o.model.choice, contextLength }, promptTokens, reply, thinking)
  const asked = levelOfEffort(thinkingEffort(o.model.target, o.model.choice.modelId, thinking))
  const params = {
    temperature: FLOW_TEMPERATURE,
    top_p: 1,
    max_tokens: limit,
    ...(start.sampling ? {} : { sampling: false }),
    ...(asked ? { thinking: asked } : {})
  }
  if (o.closed() || !o.db.open) {
    return {
      generationId: id,
      status: 'stopped',
      text: '',
      error: null,
      cutOff: false,
      promptTokens: null,
      completionTokens: null,
      cost: null
    }
  }
  gens.insertGeneration(o.db, {
    id,
    sceneId: '',
    job: 'story',
    providerId: o.model.target.id,
    providerName: o.model.target.name,
    modelId: o.model.choice.modelId,
    params,
    direction: '',
    blocks: o.blocks,
    messages,
    budget: { contextLength, reserved: limit, available: Math.max(0, contextLength - limit), used: promptTokens },
    entries: o.entries,
    createdAt: now()
  })

  let text = ''
  const outcome = await streamChat({
    target: o.model.target,
    body: { model: o.model.choice.modelId, messages, temperature: FLOW_TEMPERATURE, top_p: 1, max_tokens: limit },
    signal: o.signal,
    onText: (t) => (text += t),
    startParams: start,
    thinking,
    thinkingRoom,
    // A provider that turns the limit down is asked with the reply's own room, or less if that is turned down too.
    fallbackMaxTokens: limit > reply ? reply : reply > FALLBACK_REPLY_TOKENS ? FALLBACK_REPLY_TOKENS : undefined,
    fetchImpl: o.fetchImpl,
    delays: o.retryDelays
  }).catch((e: unknown) => ({
    status: 'error' as const,
    text,
    error: `Something went wrong: ${(e as Error)?.message ?? e}`,
    failure: null,
    promptTokens: null,
    cachedTokens: null,
    completionTokens: null,
    cost: null,
    cutOff: false
  }))

  const error =
    outcome.status === 'error'
      ? outcome.failure
        ? flowFailure(outcome.failure, o.model.target, o.model.choice.modelId, thinking)
        : (outcome.error ?? 'Something went wrong.')
      : null
  const status = o.closed() || o.signal.aborted ? 'stopped' : outcome.status
  const cost = outcome.status === 'error' && !outcome.text ? null : callCost(outcome, o.model.choice, promptTokens, outcome.text)
  if (!o.closed() && o.db.open) {
    try {
      gens.finishGeneration(o.db, id, {
        status,
        error,
        response: outcome.text,
        promptTokens: outcome.promptTokens,
        cachedTokens: outcome.cachedTokens,
        completionTokens: outcome.completionTokens,
        cost,
        finishedAt: now(),
        // The reply limit and thinking as finally sent, so "What the AI saw" stays truthful.
        params: sentAs(params, 'maxTokens' in outcome ? outcome : null)
      })
    } catch (e) {
      console.error('Could not finish the story flow record', e)
    }
  }
  return {
    generationId: id,
    status,
    text: outcome.text,
    error,
    cutOff: outcome.cutOff,
    promptTokens: outcome.promptTokens,
    completionTokens: outcome.completionTokens,
    cost
  }
}

/**
 * Asks the model and reads its reply as one JSON object checked by `check` (which says what is wrong
 * with one it can't use). A reply that can't be read is asked for once more; one cut off by the reply
 * limit isn't, as it would be cut off again.
 */
export async function askForJson<T>(
  o: FlowCallOptions,
  check: (value: unknown) => { ok: true; value: T } | { ok: false; why: string }
): Promise<FlowCall<T>> {
  const totals: CallTotals = { promptTokens: null, completionTokens: null, cost: null, generationIds: [] }
  let messages = o.messages
  for (let attempt = 0; attempt < 2; attempt++) {
    const call = await callOnce(o, messages)
    addUp(totals, call)
    if (call.status === 'stopped' || o.signal.aborted || o.closed()) return { status: 'stopped', totals }
    if (call.status === 'error') return { status: 'failed', error: call.error ?? 'Something went wrong.', totals }
    if (!call.text.trim()) return { status: 'failed', error: EMPTY_REPLY, totals }
    const parsed = parseLenient(call.text)
    const checked = parsed.ok ? check(parsed.value) : parsed
    if (checked.ok) return { status: 'ok', value: checked.value, totals }
    if (call.cutOff || (checked.why === CUT_OFF && estimateTokens(call.text) >= o.budget.reply * 0.6)) {
      return { status: 'failed', error: CUT_REPLY, totals }
    }
    messages = [...o.messages, { role: 'assistant', content: call.text }, { role: 'user', content: retryMessage(checked.why) }]
  }
  return { status: 'failed', error: BROKEN_REPLY, totals }
}
