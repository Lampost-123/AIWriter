// Runs a draft: records it, streams it in the background, sends the text to
// the window in small batches, saves it as it arrives (so a crash or a Stop
// keeps it) and finishes the record. No Electron imports: events go through
// the `emit` function the caller passes in.

import type Database from 'better-sqlite3'
import type { AppEvents } from '@shared/api'
import type { ContentIntensity, ContextPreview, DraftOptions, GenerationRecord, ID, ModelChoice, ThinkingLevel } from '@shared/types'
import { CREATIVITY_PRESETS, countWords } from '@shared/defaults'
import * as gens from '../db/generations'
import { newId, now, UserError } from '../util'
import { knownParams, levelOfEffort, streamChat, thinkingEffort, type ChatTarget, type SentParams, type StreamOutcome } from './client'
import { replyTokenLimit, sentEntryIds, TOKENS_PER_WORD } from './context'
import { isKeyFailure, strongContentRefusal } from './errors'

type DB = Database.Database
type GenerationParams = GenerationRecord['params']
export type Emit = <E extends keyof AppEvents>(event: E, payload: AppEvents[E]) => void

/** Text goes to the window at most this often (not once per token). */
export const CHUNK_INTERVAL_MS = 40
/** The text received so far is saved at most this often. */
export const SAVE_INTERVAL_MS = 500

interface Job {
  id: ID
  sceneId: ID
  db: DB
  controller: AbortController
  text: string
  /** The world closed under this draft: its record is already finished. */
  closed: boolean
  done: Promise<void>
}

const active = new Map<ID, Job>()

export const isDrafting = (sceneId: ID): boolean => [...active.values()].some((j) => j.sceneId === sceneId)
export const activeDraftIds = (): ID[] => [...active.keys()]

/** A draft of a scene started or finished (milestone 4: reading aloud marks a draft's text as it lands). */
export interface DraftActivity {
  sceneId: ID
  phase: 'start' | 'end'
  /** One of a set of Variants: nothing goes into the scene until Adam picks one. */
  variant: boolean
}
const watchers = new Set<(e: DraftActivity) => void>()

/** Hears every draft start and finish. A watcher's failure never touches the draft. */
export function onDraftActivity(fn: (e: DraftActivity) => void): () => void {
  watchers.add(fn)
  return () => watchers.delete(fn)
}

function tellWatchers(e: DraftActivity): void {
  for (const fn of watchers) {
    try {
      fn(e)
    } catch (err) {
      console.warn('A draft watcher failed', err)
    }
  }
}

export interface DraftRequest {
  db: DB
  sceneId: ID
  /** 'draft' (Generate and Variants) unless said: milestone 4's Beat by beat records each beat as 'beat'. */
  job?: 'draft' | 'beat'
  /** What the draft is part of (milestone 4): one of a set of variants, or one beat. Saved with its record. */
  partOf?: Pick<GenerationParams, 'variant' | 'beat'>
  /**
   * Refuses to start while another draft of this scene is being written (the default). Variants write
   * 2 or 3 drafts of one scene side by side, so they pass false.
   */
  exclusive?: boolean
  options: DraftOptions
  preview: ContextPreview
  provider: ChatTarget & { id: ID }
  model: ModelChoice
  /** How much the writer model is asked to think (Settings › Models). */
  thinking?: ThinkingLevel
  /**
   * The content levels of the style guide in effect. Set above their second step, a draft the model refuses
   * (or its content filter cuts short) says some models won't write at that level, and to pick another.
   */
  intensity?: ContentIntensity
  /** Each live entry's updatedAt, recorded as the version that was sent. */
  entryVersions: Map<ID, string>
  emit: Emit
  /** Called when the provider turned the key down, so Settings can show it isn't working. */
  onKeyRejected?: () => void
  /** Called when a draft came back in full, so Settings can show the provider works. */
  onWorked?: () => void
  /** For tests. */
  fetchImpl?: typeof fetch
  retryDelays?: number[]
}

/** USD cost: the provider's own figure, else tokens x the model's prices, else an estimate, else null. */
export function draftCost(
  outcome: Pick<StreamOutcome, 'cost' | 'promptTokens' | 'completionTokens' | 'text'>,
  model: Pick<ModelChoice, 'promptPrice' | 'completionPrice'>,
  briefingTokens: number
): number | null {
  if (outcome.cost != null) return outcome.cost
  if (model.promptPrice == null || model.completionPrice == null) return null
  const prompt = outcome.promptTokens ?? briefingTokens
  const completion = outcome.completionTokens ?? Math.ceil(countWords(outcome.text) * TOKENS_PER_WORD)
  return prompt * model.promptPrice + completion * model.completionPrice
}

/** How to word the request: what this session learnt about the model, and what its provider says it takes. */
function startParams(req: DraftRequest): SentParams {
  const known = knownParams(req.provider, req.model.modelId)
  return req.model.sampling === false ? { ...known, sampling: false } : known
}

/** The params with how they were actually sent (only noted when it differs from the usual), and the thinking asked for. */
function withSent(p: GenerationParams, sent: SentParams, effort: string | null): GenerationParams {
  const { tokenParam: _t, sampling: _s, cutOff: _c, thinking: _k, min_p, ...rest } = p
  const out: GenerationParams = { ...rest }
  // min_p goes with the other creativity settings, and not to a model that turned it down.
  if (min_p != null && sent.sampling && sent.minP !== false) out.min_p = min_p
  if (sent.tokenParam !== 'max_tokens') out.tokenParam = sent.tokenParam
  if (!sent.sampling) out.sampling = false
  const thinking = levelOfEffort(effort)
  if (thinking) out.thinking = thinking
  return out
}

export function startDraftJob(req: DraftRequest): { generationId: ID } {
  if (req.exclusive !== false && isDrafting(req.sceneId)) {
    throw new UserError('A draft is already being written for this scene. Stop it first, or wait for it to finish.')
  }
  const id = newId()
  const preset = CREATIVITY_PRESETS[req.options.creativity] ?? CREATIVITY_PRESETS.balanced
  const reply = replyTokenLimit(req.preview.budget, req.model.maxOutput, req.thinking)
  const sent = startParams(req)
  // min_p is sent only to OpenRouter (ai/client.ts), so only then is it noted.
  const minP = req.provider.kind === 'openrouter' ? preset.min_p : null
  const params: GenerationParams = withSent(
    {
      temperature: preset.temperature,
      top_p: preset.top_p,
      ...(minP != null ? { min_p: minP } : {}),
      max_tokens: reply.limit,
      creativity: req.options.creativity,
      // Auto leaves the length out and says so.
      ...(req.options.targetWords == null ? { autoLength: true } : { targetWords: req.options.targetWords }),
      ...(req.partOf ?? {})
    },
    sent,
    thinkingEffort(req.provider, req.model.modelId, req.thinking)
  )
  gens.insertGeneration(req.db, {
    id,
    sceneId: req.sceneId,
    job: req.job ?? 'draft',
    providerId: req.provider.id,
    providerName: req.provider.name,
    modelId: req.model.modelId,
    params,
    direction: req.options.direction,
    blocks: req.preview.blocks,
    messages: req.preview.messages,
    budget: req.preview.budget,
    entries: sentEntryIds(req.preview.blocks).map((entryId) => ({ entryId, version: req.entryVersions.get(entryId) ?? '' })),
    createdAt: now()
  })

  const job: Job = { id, sceneId: req.sceneId, db: req.db, controller: new AbortController(), text: '', closed: false, done: Promise.resolve() }
  active.set(id, job)
  tellWatchers({ sceneId: req.sceneId, phase: 'start', variant: !!req.partOf?.variant })
  job.done = run(job, req, params, reply.fallback)
  return { generationId: id }
}

async function run(job: Job, req: DraftRequest, params: GenerationParams, fallbackMaxTokens: number): Promise<void> {
  const { db, emit } = req
  let pending = ''
  let chunkTimer: ReturnType<typeof setTimeout> | null = null
  let saveTimer: ReturnType<typeof setTimeout> | null = null

  const sendChunk = (): void => {
    chunkTimer = null
    if (!pending) return
    const text = pending
    pending = ''
    emit('generation:chunk', { generationId: job.id, sceneId: job.sceneId, text })
  }
  const save = (): void => {
    saveTimer = null
    if (job.closed || !db.open) return
    try {
      gens.saveResponse(db, job.id, job.text)
    } catch (e) {
      console.error('Could not save the draft so far', e)
    }
  }

  let outcome: StreamOutcome
  try {
    outcome = await streamChat({
      target: req.provider,
      body: {
        model: req.model.modelId,
        messages: req.preview.messages,
        temperature: params.temperature,
        top_p: params.top_p,
        max_tokens: params.max_tokens,
        min_p: params.min_p ?? null
      },
      signal: job.controller.signal,
      onText: (t) => {
        job.text += t
        pending += t
        chunkTimer ??= setTimeout(sendChunk, CHUNK_INTERVAL_MS)
        saveTimer ??= setTimeout(save, SAVE_INTERVAL_MS)
      },
      onRetry: (info) => emit('generation:retrying', { generationId: job.id, ...info }),
      fallbackMaxTokens,
      startParams: startParams(req),
      thinking: req.thinking,
      fetchImpl: req.fetchImpl,
      delays: req.retryDelays
    })
  } catch (e) {
    // streamChat doesn't throw; this is a last line of defence so the record always finishes.
    console.error('Draft failed unexpectedly', e)
    outcome = {
      status: 'error',
      text: job.text,
      error: `Something went wrong while writing: ${(e as Error)?.message ?? e}. The text that arrived is kept.`,
      failure: null,
      promptTokens: null,
      completionTokens: null,
      cost: null,
      finishReason: null,
      retries: 0,
      maxTokens: params.max_tokens,
      cutOff: false,
      sentParams: startParams(req),
      effort: thinkingEffort(req.provider, req.model.modelId, req.thinking)
    }
  }

  if (chunkTimer) clearTimeout(chunkTimer)
  if (saveTimer) clearTimeout(saveTimer)
  sendChunk()

  let status: StreamOutcome['status'] = job.closed ? 'stopped' : outcome.status
  let error = status === 'error' ? outcome.error : null
  // At strong content levels, a refusal (or a content filter cutting the scene short, or a reply that is
  // plainly a refusal) says that some models won't write at that level.
  const refused = job.closed
    ? null
    : strongContentRefusal({ status, failure: outcome.failure, finishReason: outcome.finishReason, text: outcome.text, intensity: req.intensity })
  if (refused) {
    status = 'error'
    error = refused
  }
  // A request the provider turned down (or never answered) costs nothing: don't make up a price for it.
  const f = outcome.failure?.type
  const neverRan =
    outcome.status === 'error' &&
    !outcome.text &&
    outcome.cost == null &&
    outcome.promptTokens == null &&
    outcome.completionTokens == null &&
    (f === 'http' || f === 'network' || f === 'timeout' || f === 'bad-response')
  const cost = neverRan ? null : draftCost(outcome, req.model, req.preview.budget.used)
  const cutOff = outcome.cutOff && status === 'complete'
  // The settings as actually sent: a smaller reply limit, a model that sets its own
  // creativity, or a reply that ran into the limit, so "What the AI saw" stays truthful.
  const used = withSent({ ...params, max_tokens: outcome.maxTokens }, outcome.sentParams, outcome.effort)
  if (cutOff) used.cutOff = true
  const paramsChanged = JSON.stringify(used) !== JSON.stringify(params)
  if (!job.closed && db.open) {
    try {
      gens.finishGeneration(db, job.id, {
        status,
        error,
        response: outcome.text,
        promptTokens: outcome.promptTokens,
        completionTokens: outcome.completionTokens,
        cost,
        finishedAt: now(),
        params: paramsChanged ? used : undefined
      })
    } catch (e) {
      console.error('Could not finish the draft record', e)
    }
  }
  active.delete(job.id)
  tellWatchers({ sceneId: job.sceneId, phase: 'end', variant: !!req.partOf?.variant })
  try {
    if (isKeyFailure(outcome.failure)) req.onKeyRejected?.()
    else if (outcome.status === 'complete') req.onWorked?.()
  } catch (e) {
    console.error('Could not note whether the provider worked', e)
  }
  emit('generation:done', {
    generationId: job.id,
    sceneId: job.sceneId,
    status,
    error,
    promptTokens: outcome.promptTokens,
    completionTokens: outcome.completionTokens,
    cost,
    cutOff
  })
}

/** Stops a draft; the text so far is kept. Resolves once its record is finished. */
export async function stopDraft(id: ID): Promise<void> {
  const job = active.get(id)
  if (!job) return
  job.controller.abort()
  await job.done
}

/**
 * The world is closing: stop its drafts and finish their records now, while
 * the database is still open.
 */
export function stopDraftsFor(db: DB): void {
  for (const job of active.values()) {
    if (job.db !== db) continue
    job.controller.abort()
    if (job.closed) continue
    job.closed = true
    try {
      gens.finishGeneration(db, job.id, {
        status: 'stopped',
        error: null,
        response: job.text,
        promptTokens: null,
        completionTokens: null,
        cost: null,
        finishedAt: now()
      })
    } catch (e) {
      console.error('Could not finish the draft record on close', e)
    }
  }
}
