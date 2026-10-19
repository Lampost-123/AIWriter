// Calls the memory model: one request, saved as a generation record (job 'memory' or 'summary') so
// "What the AI saw" works for it, streamed with streamChat (which retries rate limits and server
// errors and hides "thinking"), with low creativity. The memory needs no thinking: the model is asked
// to think as Settings › Models says (Off unless Adam changes it), and is given room to think and
// still answer when it thinks anyway (thinking counts against the reply limit). Never throws: the
// result says what happened, in plain words when it went wrong. No Electron imports.
// Refusals (2026-10-16): some models won't read explicit scenes, and Adam writes them. A reply that is plainly a
// refusal ("I'm sorry, but I can't summarise this scene") is told apart here, once, for every memory job: it comes
// back as a 'refused' failure, never as a summary, a plan or a reading, and is noted for the top bar's lasting note
// (refusals.ts) with what it was for (`task`). When the style guide sets content above its second step, every memory job
// is told the story means it (contentNoteFor), so it records what the words say plainly rather than toning it down.

import type Database from 'better-sqlite3'
import type { ChatMessage, ContentIntensity, ContextBlock, ID, ModelChoice, ThinkingLevel } from '@shared/types'
import { INTENSITY } from '@shared/intensity'
import * as gens from '../db/generations'
import { knownParams, levelOfEffort, streamChat, thinkingEffort, type ChatTarget, type SentParams, type StreamOutcome } from '../ai/client'
import { REPLY_LIMIT_CAP, THINKING_ROOM, withThinkingShare } from '../ai/context'
import { describeFailure, looksLikeContextTooLong, looksLikeRefusal, looksLikeRefusalReply, providerWho, type Failure } from '../ai/errors'
import { backgroundPatience } from '../ai/patience'
import { newId, now } from '../util'
import { heldAt } from '../usage/gate'
import { estimateTokens } from './text'
import { modelKeyOf, noteRefusal, type RefusedTask } from './refusals'

type DB = Database.Database

/** The memory model and how to reach it. */
export interface MemoryModel {
  target: ChatTarget & { id: ID }
  choice: ModelChoice
  /** How much the memory model is asked to think (Settings › Models); Off when not said. */
  thinking?: ThinkingLevel
}

/** Low creativity: the memory model reports, it doesn't invent. */
export const MEMORY_TEMPERATURE = 0.2
/** Context length assumed when the model's is unknown. */
export const DEFAULT_MEMORY_CONTEXT = 16_000

/**
 * The reply limit to ask with: the reply's own room plus some room to think (more when the model is
 * asked to think more), and the bigger limit to ask with once if the model's thinking still uses all
 * of that. Never past what the model can write in one go or what its window has left after the
 * request (5% spare, as providers count differently), and never below the reply's own room.
 */
export function memoryReplyLimits(
  choice: ModelChoice,
  promptTokens: number,
  reply: number,
  thinking?: ThinkingLevel
): { limit: number; thinkingRoom: number } {
  const contextLength = choice.contextLength ?? DEFAULT_MEMORY_CONTEXT
  const most = choice.maxOutput && choice.maxOutput > 0 ? choice.maxOutput : Infinity
  const cap = Math.max(reply, Math.min(most, contextLength - promptTokens - Math.ceil(contextLength * 0.05)))
  const limit = Math.min(cap, Math.max(reply + THINKING_ROOM, withThinkingShare(reply, thinking)))
  return { limit, thinkingRoom: Math.min(cap, Math.max(reply + REPLY_LIMIT_CAP, withThinkingShare(reply + THINKING_ROOM, thinking))) }
}

export interface CallOptions {
  db: DB
  model: MemoryModel
  /** The scene the record belongs to (for a roll-up, the latest scene it is made from). */
  targetId: ID
  job: 'memory' | 'summary'
  /**
   * What the call is for, so a refusal can say what went without (refusals.ts). 'read' (the memory reading a scene) has
   * its own lasting note ("Memory isn't updating"), so it isn't noted; left out, nothing is noted either.
   */
  task?: RefusedTask | 'read'
  messages: ChatMessage[]
  /**
   * What the record keeps of the messages, when that is less than was sent (the plan before writing with the book so
   * far read whole, long story memory fix 14: the book is kept as a note, as it is the scenes' own words). Left out: the
   * messages as sent. Its size is still counted as sent.
   */
  kept?: ChatMessage[]
  blocks: ContextBlock[]
  /** Room for the reply. */
  maxTokens: number
  /** Entries the request told the model about, with their version, for "What the AI saw". */
  entries?: { entryId: ID; version: string }[]
  signal: AbortSignal
  /** True once the world has closed: nothing more is written. */
  closed: () => boolean
  /** Told the record's id as soon as it exists, so a closing world can finish it. */
  onRecord?: (generationId: ID) => void
  /**
   * Work Adam isn't watching (the memory reading a scene, a summary, where things stand): a provider that has stopped
   * answering is given up on after about a minute rather than ten (ai/patience.ts). Left out: streamChat's own patience.
   */
  background?: boolean
  fetchImpl?: typeof fetch
  retryDelays?: number[]
}

export interface CallResult {
  generationId: ID
  status: 'complete' | 'stopped' | 'error'
  text: string
  /** Plain words with a next step, when status is 'error'. */
  error: string | null
  failure: Failure | null
  promptTokens: number | null
  completionTokens: number | null
  cost: number | null
}

/** The provider's words for a failure, reworded for the memory model (asked to think as `thinking` says). */
export function memoryFailure(f: Failure, target: ChatTarget, modelId: string, thinking: ThinkingLevel = 'off'): string {
  const who = providerWho(target)
  switch (f.type) {
    case 'refused':
      return "The memory model turned the scene down. Some models won't read explicit scenes, so pick another memory model in Settings › Models."
    case 'empty':
      if (f.thinking && thinking === 'off') {
        return 'The memory model thinks even with Thinking off, and used up its room before it answered. Pick another memory model in Settings › Models.'
      }
      if (f.thinking) {
        return "The memory model used up its room thinking and didn't answer. Set the memory's Thinking to Off in Settings › Models, or pick another memory model."
      }
      return `${who} sent back an empty reply. Try again later, or pick another memory model in Settings › Models.`
    case 'dropped':
      return `The connection to ${who} dropped before the memory model had finished. It will try again.`
    default:
      return describeFailure(
        f,
        { name: target.name, kind: target.kind, baseUrl: target.baseUrl, hasKey: !!target.apiKey },
        { during: 'draft', modelId }
      )
        .replace(/writer model/g, 'memory model')
        .replace(/ The text that arrived is kept\.$/, '')
  }
}

/** What each content scale set above its second step means, for the memory model. */
const STRONG_WORDS: Record<(typeof INTENSITY)[number]['scale'], string> = {
  romance: 'explicit sex',
  violence: 'graphic violence',
  language: 'strong swearing'
}

/**
 * What the memory model is told when the style guide sets content above its second step (as the writer is: some
 * models tone such scenes down when they record them, or leave them out): that the story means it, and to record what
 * the words say plainly. Null at milder levels.
 */
export function contentNoteFor(intensity: ContentIntensity | null | undefined): string | null {
  const strong = INTENSITY.filter(({ scale }) => (intensity?.[scale] ?? 0) > 2).map(({ scale }) => STRONG_WORDS[scale])
  if (!strong.length) return null
  const what = strong.length > 1 ? `${strong.slice(0, -1).join(', ')} and ${strong[strong.length - 1]}` : strong[0]
  return `About this story: it is fiction for adult readers, and its author means it to include ${what}. Read and record what the words say plainly and accurately, as you would any other scene: don't tone it down, leave it out or add a warning.`
}

/** How the memory model is told about the story's content (set where the style guide can be read: keeper/index.ts). */
let contentNote: ((db: DB, sceneId: ID) => string | null) | null = null
export function setContentNote(fn: ((db: DB, sceneId: ID) => string | null) | null): void {
  contentNote = fn
}

/** The messages with the content note at the end of the system message (or first, when there is none). */
function withNote(messages: ChatMessage[], note: string | null): ChatMessage[] {
  if (!note) return messages
  const i = messages.findIndex((m) => m.role === 'system')
  if (i < 0) return [{ role: 'system', content: note }, ...messages]
  return messages.map((m, j) => (j === i ? { ...m, content: `${m.content}\n\n${note}` } : m))
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

/** The params as finally sent, when they differ from what the record was made with. */
export function sentAs<P extends { max_tokens: number; thinking?: string }>(params: P, outcome: Pick<StreamOutcome, 'maxTokens' | 'effort'> | null): P | undefined {
  if (!outcome) return undefined
  const asked = levelOfEffort(outcome.effort)
  if (outcome.maxTokens === params.max_tokens && asked === params.thinking) return undefined
  const { thinking: _t, ...rest } = params
  return { ...rest, max_tokens: outcome.maxTokens, ...(asked ? { thinking: asked } : {}) } as P
}

/**
 * True when a call came back as a refusal: the provider's content filter or moderation (an 'http' failure that says so,
 * not one about the request's length), or a reply that is plainly the model declining (@shared/refusal).
 */
export function isRefusal(o: { status: 'complete' | 'stopped' | 'error'; text: string; failure: Failure | null }): boolean {
  const f = o.failure
  if (f?.type === 'refused') return true
  if (f?.type === 'http' && [400, 403, 422].includes(f.status) && looksLikeRefusal(f.message) && !looksLikeContextTooLong(f.message)) return true
  return o.status === 'complete' && looksLikeRefusalReply(o.text)
}

export async function callModel(given: CallOptions): Promise<CallResult> {
  let note: string | null = null
  try {
    note = contentNote && given.db.open ? contentNote(given.db, given.targetId) : null
  } catch (e) {
    console.warn('Could not read the style guide for the memory model', e)
  }
  const o: CallOptions = note
    ? { ...given, messages: withNote(given.messages, note), ...(given.kept ? { kept: withNote(given.kept, note) } : {}) }
    : given
  const id = newId()
  const contextLength = o.model.choice.contextLength ?? DEFAULT_MEMORY_CONTEXT
  const promptTokens = estimateTokens(o.messages.map((m) => m.content).join('\n'))
  const known = knownParams(o.model.target, o.model.choice.modelId)
  const start: SentParams = o.model.choice.sampling === false ? { ...known, sampling: false } : known
  const thinking = o.model.thinking ?? 'off'
  const { limit, thinkingRoom } = memoryReplyLimits(o.model.choice, promptTokens, o.maxTokens, thinking)
  const asked = levelOfEffort(thinkingEffort(o.model.target, o.model.choice.modelId, thinking))
  const params = {
    temperature: MEMORY_TEMPERATURE,
    top_p: 1,
    max_tokens: limit,
    ...(start.sampling ? {} : { sampling: false }),
    ...(asked ? { thinking: asked } : {})
  }
  const stopped: CallResult = {
    generationId: id,
    status: 'stopped',
    text: '',
    error: null,
    failure: null,
    promptTokens: null,
    completionTokens: null,
    cost: null
  }
  if (o.closed() || !o.db.open) return stopped
  // Milestone 6: this month's AI spending reached Adam's limit while a run was under way. The run stops
  // here, as it would on closing, and the scene waits to be read once Adam carries on (usage/gate.ts).
  if (heldAt() != null) return stopped
  gens.insertGeneration(o.db, {
    id,
    sceneId: o.targetId,
    job: o.job,
    providerId: o.model.target.id,
    providerName: o.model.target.name,
    modelId: o.model.choice.modelId,
    params,
    direction: '',
    blocks: o.blocks,
    messages: o.kept ?? o.messages,
    budget: { contextLength, reserved: limit, available: Math.max(0, contextLength - limit), used: promptTokens },
    entries: o.entries ?? [],
    createdAt: now()
  })
  o.onRecord?.(id)

  let text = ''
  const outcome = await streamChat({
    target: o.model.target,
    body: { model: o.model.choice.modelId, messages: o.messages, temperature: MEMORY_TEMPERATURE, top_p: 1, max_tokens: limit },
    signal: o.signal,
    onText: (t) => (text += t),
    startParams: start,
    thinking,
    thinkingRoom,
    // A provider that turns the bigger limit down is asked with the reply's own room.
    fallbackMaxTokens: o.maxTokens,
    ...(o.background ? backgroundPatience(o.model.target) : {}),
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
    cost: null
  }))

  // A refusal, however it came: the provider's own (a content filter, a moderation error), or a reply that is plainly a
  // model declining. Never kept as what was asked for.
  const refused = !o.closed() && isRefusal(outcome)
  const failure: Failure | null = refused ? { type: 'refused' } : outcome.failure
  const error =
    refused || outcome.status === 'error'
      ? failure
        ? memoryFailure(failure, o.model.target, o.model.choice.modelId, thinking)
        : outcome.error
      : null
  const cost = outcome.status === 'error' && !outcome.text ? null : callCost(outcome, o.model.choice, promptTokens, outcome.text)
  const status = o.closed() ? 'stopped' : refused ? 'error' : outcome.status
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
      console.error('Could not finish the memory record', e)
    }
  }
  if (refused && o.task && o.task !== 'read' && o.db.open) {
    noteRefusal(o.db, { task: o.task, model: 'memory', modelKey: modelKeyOf(o.model), sceneId: o.task === 'rollup' ? null : o.targetId })
  }
  return {
    generationId: id,
    status,
    text: outcome.text,
    error,
    failure,
    promptTokens: outcome.promptTokens,
    completionTokens: outcome.completionTokens,
    cost
  }
}
