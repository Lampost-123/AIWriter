// One memory keeper run for one scene: plan what changed, ask the memory model about the new and
// changed paragraphs (in chunks that fit it), repair or retry a reply that can't be read once, then
// apply everything in one transaction and mark the scene version processed. A failure leaves the
// memory as it was, marks the scene "Memory not updated" and lists it in What changed; it is tried
// again on the next trigger and at app start. Re-running a processed version changes nothing.
// Never writes once the world has closed. No Electron imports.

import type Database from 'better-sqlite3'
import type { ChatMessage, ID } from '@shared/types'
import * as kdb from '../db/keeper'
import * as repo from '../db/repo'
import { applyRead, type ChunkReply } from './apply'
import { callModel, type CallResult, type MemoryModel } from './model'
import { parseLenient, readingReply, type ReadingReply } from './json'
import { retryMessage } from './prompts'
import { buildRequest, planChunks, readingBudget } from './request'
import { nothingToDo, planRead } from './track'
import { loadShapeSafe, memoryAt, placeWords, sideClashesFor } from './places'

type DB = Database.Database

export interface RunOptions {
  db: DB
  /** The memory model, or null when none is chosen (then the scene waits). */
  model: MemoryModel | null
  signal: AbortSignal
  /** True once the world has closed: nothing more is written. */
  closed: () => boolean
  /** Called just before the memory model is first asked about the scene. */
  onReading?: () => void
  /** Told each generation record's id as soon as it exists. */
  onRecord?: (generationId: ID) => void
  fetchImpl?: typeof fetch
  retryDelays?: number[]
}

export type RunOutcome =
  | { status: 'nothing' }
  | { status: 'gone' }
  | { status: 'no-model' }
  | { status: 'stopped' }
  | { status: 'done'; runId: ID | null; lines: number; entryIds: ID[]; readParagraphs: number }
  | { status: 'failed'; runId: ID; error: string }

/** Tokens and cost of a run's calls, added up (null when nothing was reported). */
class Totals {
  promptTokens: number | null = null
  completionTokens: number | null = null
  cost: number | null = null
  generationIds: ID[] = []
  add(c: CallResult): void {
    this.generationIds.push(c.generationId)
    if (c.promptTokens != null) this.promptTokens = (this.promptTokens ?? 0) + c.promptTokens
    if (c.completionTokens != null) this.completionTokens = (this.completionTokens ?? 0) + c.completionTokens
    if (c.cost != null) this.cost = (this.cost ?? 0) + c.cost
  }
  of(model: MemoryModel | null): kdb.RunTotals {
    return {
      providerId: model?.target.id ?? null,
      modelId: model?.choice.modelId ?? null,
      promptTokens: this.promptTokens,
      completionTokens: this.completionTokens,
      cost: this.cost,
      generationIds: this.generationIds
    }
  }
}

/**
 * The scene couldn't be read: it shows "Memory not updated" (tried again on the next trigger and at
 * app start) and, the first time, is listed in What changed. The memory is left as it was.
 */
export function failScene(db: DB, sceneId: ID, runId: ID | null, error: string, totals: kdb.RunTotals | null): RunOutcome {
  const id = runId ?? kdb.startRun(db, sceneId, kdb.keeperScene(db, sceneId)?.textVersion ?? 0)
  db.transaction(() => {
    const wasFailed = kdb.keeperScene(db, sceneId)?.memoryState === 'failed'
    kdb.markFailed(db, sceneId, error)
    if (!wasFailed) {
      kdb.insertLog(db, {
        runId: id,
        sceneId,
        entryName: '',
        text: error,
        before: '',
        after: '',
        action: 'failed',
        what: 'scene',
        entryId: null,
        factId: null,
        quote: '',
        question: null,
        undo: null
      })
    }
    kdb.finishRun(db, id, 'failed', error, totals ?? new Totals().of(null))
  })()
  return { status: 'failed', runId: id, error }
}

/** Reads one scene's latest text into the memory. */
export async function runScene(o: RunOptions, sceneId: ID): Promise<RunOutcome> {
  const { db } = o
  if (o.closed() || !db.open) return { status: 'stopped' }
  const scene = kdb.keeperScene(db, sceneId)
  if (!scene) return { status: 'gone' }
  if (scene.memoryVersion >= scene.textVersion && scene.memoryState === 'current') return { status: 'nothing' }

  const plan = planRead(db, scene)
  const shape = loadShapeSafe(db)
  const where = placeWords(db, shape, { storyId: scene.storyId, chapterId: scene.chapterId, sceneId }) || 'this scene'

  // Nothing new to read: links that moved and facts whose words were deleted need no model.
  if (!plan.toRead.length) {
    if (nothingToDo(plan)) {
      db.transaction(() =>
        kdb.markProcessed(
          db,
          sceneId,
          plan.version,
          plan.paras.map((p) => ({ id: p.id, hash: p.hash, text: p.text }))
        )
      )()
      return { status: 'nothing' }
    }
    const runId = kdb.startRun(db, sceneId, plan.version)
    const result = db.transaction(() =>
      applyRead(db, { runId, memory: memoryAt(db, scene.storyId, sceneId), shape, sideClashes: sideClashesFor(db, shape) }, plan, [])
    )()
    kdb.finishRun(db, runId, 'done', null, new Totals().of(null))
    return { status: 'done', runId, lines: result.lines, entryIds: result.entryIds, readParagraphs: 0 }
  }

  if (!o.model) return { status: 'no-model' }
  const model = o.model
  const runId = kdb.startRun(db, sceneId, plan.version)
  const totals = new Totals()
  const fail = (error: string): RunOutcome =>
    o.closed() || !db.open ? { status: 'stopped' } : failScene(db, sceneId, runId, error, totals.of(model))
  const stopped = (): RunOutcome => {
    if (!o.closed() && db.open) kdb.finishRun(db, runId, 'stopped', null, totals.of(model))
    return { status: 'stopped' }
  }

  const budget = readingBudget(model.choice)
  if (!budget) {
    return fail(
      `The memory couldn't read ${where}: the memory model can take too little text at once. Pick another memory model in Settings > Models.`
    )
  }
  const memory = memoryAt(db, scene.storyId, sceneId)
  const chunks = planChunks(plan.paras, plan.toRead, plan.atRisk, budget)
  const card = repo.getScene(db, sceneId).card
  const versions = new Map(memory.entries.map((e) => [e.id, e.updatedAt]))
  o.onReading?.()

  const replies: ChunkReply[] = []
  for (const chunk of chunks) {
    const req = buildRequest({ where, title: scene.title, card, chunk, found: plan.found, memory, budget })
    const ask = (messages: ChatMessage[]): Promise<CallResult> =>
      callModel({
        db,
        model,
        targetId: sceneId,
        job: 'memory',
        messages,
        blocks: req.blocks,
        maxTokens: budget.reply,
        entries: req.entryIds.map((id) => ({ entryId: id, version: versions.get(id) ?? '' })),
        signal: o.signal,
        closed: o.closed,
        onRecord: o.onRecord,
        fetchImpl: o.fetchImpl,
        retryDelays: o.retryDelays
      })
    let reply: ReadingReply | null = null
    let messages = req.messages
    for (let attempt = 0; attempt < 2 && !reply; attempt++) {
      const call = await ask(messages)
      totals.add(call)
      if (o.closed() || call.status === 'stopped' || o.signal.aborted) return stopped()
      if (call.status === 'error') return fail(`The memory couldn't read ${where}. ${call.error ?? 'Something went wrong.'}`)
      const parsed = parseLenient(call.text)
      const checked = parsed.ok ? readingReply(parsed.value) : parsed
      if (checked.ok) {
        reply = checked.reply
        break
      }
      // Asked once more, saying what was wrong.
      messages = [...req.messages, { role: 'assistant', content: call.text }, { role: 'user', content: retryMessage(checked.why) }]
    }
    if (!reply) {
      return fail(
        `The memory couldn't read ${where}: the memory model's reply wasn't in the right format. It will try again; or pick another memory model in Settings > Models.`
      )
    }
    replies.push({ ids: req.ids, reply, paras: chunk.paras })
  }

  if (o.closed() || !db.open) return { status: 'stopped' }
  // The scene may have been deleted while the model was reading it.
  if (!kdb.keeperScene(db, sceneId)) return stopped()
  const result = db.transaction(() => applyRead(db, { runId, memory, shape, sideClashes: sideClashesFor(db, shape) }, plan, replies))()
  kdb.finishRun(db, runId, 'done', null, totals.of(model))
  return { status: 'done', runId, lines: result.lines, entryIds: result.entryIds, readParagraphs: plan.toRead.length }
}
