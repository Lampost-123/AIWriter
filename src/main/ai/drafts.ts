// Runs a draft: records it, streams it in the background, sends the text to
// the window in small batches, saves it as it arrives (so a crash or a Stop
// keeps it) and finishes the record. No Electron imports: events go through
// the `emit` function the caller passes in.

import type Database from 'better-sqlite3'
import type { AppEvents } from '@shared/api'
import type { ContextPreview, DraftOptions, ID, ModelChoice } from '@shared/types'
import { CREATIVITY_PRESETS, countWords } from '@shared/defaults'
import * as gens from '../db/generations'
import { newId, now, UserError } from '../util'
import { streamChat, type ChatTarget, type StreamOutcome } from './client'
import { replyTokenLimit, sentEntryIds, TOKENS_PER_WORD } from './context'

type DB = Database.Database
type GenerationParams = { temperature: number; top_p: number; max_tokens: number; creativity: DraftOptions['creativity']; targetWords: number }
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

export function startDraftJob(req: DraftRequest): { generationId: ID } {
  if (isDrafting(req.sceneId)) {
    throw new UserError('A draft is already being written for this scene. Stop it first, or wait for it to finish.')
  }
  const id = newId()
  const preset = CREATIVITY_PRESETS[req.options.creativity] ?? CREATIVITY_PRESETS.balanced
  const reply = replyTokenLimit(req.preview.budget, req.model.maxOutput)
  const params = {
    temperature: preset.temperature,
    top_p: preset.top_p,
    max_tokens: reply.limit,
    creativity: req.options.creativity,
    targetWords: req.options.targetWords
  }
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
      maxTokens: params.max_tokens
    }
  }

  if (chunkTimer) clearTimeout(chunkTimer)
  if (saveTimer) clearTimeout(saveTimer)
  sendChunk()

  const status = job.closed ? 'stopped' : outcome.status
  const cost = draftCost(outcome, req.model, req.preview.budget.used)
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
        // The reply limit actually used, if the provider asked for a smaller one.
        params: outcome.maxTokens !== params.max_tokens ? { ...params, max_tokens: outcome.maxTokens } : undefined
      })
    } catch (e) {
      console.error('Could not finish the draft record', e)
    }
  }
  active.delete(job.id)
  emit('generation:done', {
    generationId: job.id,
    sceneId: job.sceneId,
    status,
    error: status === 'error' ? outcome.error : null,
    promptTokens: outcome.promptTokens,
    completionTokens: outcome.completionTokens,
    cost
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
