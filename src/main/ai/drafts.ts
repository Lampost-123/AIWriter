// Runs a draft: records it, streams it in the background, sends the text to
// the window in small batches, saves it as it arrives (so a crash or a Stop
// keeps it) and finishes the record. No Electron imports: events go through
// the `emit` function the caller passes in.

import type Database from 'better-sqlite3'
import type { AppEvents } from '@shared/api'
import type { ContextPreview, DraftOptions, GenerationRecord, ID, ModelChoice } from '@shared/types'
import { CREATIVITY_PRESETS, countWords } from '@shared/defaults'
import * as gens from '../db/generations'
import { newId, now, UserError } from '../util'
import { knownParams, streamChat, type ChatTarget, type SentParams, type StreamOutcome } from './client'
import { replyTokenLimit, sentEntryIds, TOKENS_PER_WORD } from './context'
import { isKeyFailure } from './errors'

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

export interface DraftRequest {
  db: DB
  sceneId: ID
  options: DraftOptions
  preview: ContextPreview
  provider: ChatTarget & { id: ID }
  model: ModelChoice
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

/** The params with how they were actually sent (only noted when it differs from the usual). */
function withSent(p: GenerationParams, sent: SentParams): GenerationParams {
  const { tokenParam: _t, sampling: _s, cutOff: _c, ...rest } = p
  const out: GenerationParams = { ...rest }
  if (sent.tokenParam !== 'max_tokens') out.tokenParam = sent.tokenParam
  if (!sent.sampling) out.sampling = false
  return out
}

export function startDraftJob(req: DraftRequest): { generationId: ID } {
  if (isDrafting(req.sceneId)) {
    throw new UserError('A draft is already being written for this scene. Stop it first, or wait for it to finish.')
  }
  const id = newId()
  const preset = CREATIVITY_PRESETS[req.options.creativity] ?? CREATIVITY_PRESETS.balanced
  const reply = replyTokenLimit(req.preview.budget, req.model.maxOutput)
  const sent = startParams(req)
  const params: GenerationParams = withSent(
    {
      temperature: preset.temperature,
      top_p: preset.top_p,
      max_tokens: reply.limit,
      creativity: req.options.creativity,
      targetWords: req.options.targetWords
    },
    sent
  )
  gens.insertGeneration(req.db, {
    id,
    sceneId: req.sceneId,
    job: 'draft',
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
        max_tokens: params.max_tokens
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
      sentParams: startParams(req)
    }
  }

  if (chunkTimer) clearTimeout(chunkTimer)
  if (saveTimer) clearTimeout(saveTimer)
  sendChunk()

  const status = job.closed ? 'stopped' : outcome.status
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
  const used = withSent({ ...params, max_tokens: outcome.maxTokens }, outcome.sentParams)
  if (cutOff) used.cutOff = true
  const paramsChanged = JSON.stringify(used) !== JSON.stringify(params)
  if (!job.closed && db.open) {
    try {
      gens.finishGeneration(db, job.id, {
        status,
        error: status === 'error' ? outcome.error : null,
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
    error: status === 'error' ? outcome.error : null,
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
