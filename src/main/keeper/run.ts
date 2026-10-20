// One memory keeper run for one scene: plan what changed, ask the memory model about the new and
// changed paragraphs (in chunks that fit it; one whose reply ran past the reply limit is read again
// in halves), repair or retry a reply that can't be read once (the same request again, without the reply that couldn't
// be used, so a provider's cache serves it: overhaul phase 1), then apply everything in one transaction and mark the
// scene version processed. Read in one request, the same call can also say where things stand at the end of the words
// read and write the scene's summary (one reading of a scene, oneReading.ts). A failure leaves the memory as it was, marks
// the scene "Memory not updated" and lists it in What changed; it is tried again on the next trigger and
// at app start. Re-running a processed version changes nothing. A scene the memory model turns down (some models won't
// read explicit scenes) says so, and its words are remembered (refusals.ts), so the engine doesn't ask again until they
// change, another memory model is picked, or Adam presses Try again. Every request also asks a verdict on the pay-off of
// each open plot thread due here (oneReading.ts payoffAsks; applied in apply.ts settlePayoffs).
// Never writes once the world has closed. No Electron imports.

import type Database from 'better-sqlite3'
import type { ChatMessage, ID } from '@shared/types'
import * as kdb from '../db/keeper'
import * as repo from '../db/repo'
import { applyRead, type ChunkReply } from './apply'
import { callModel, type CallResult, type MemoryModel } from './model'
import { CUT_OFF, parseLenient, readingReply, type ReadingReply } from './json'
import { retryMessage } from './prompts'
import { buildRequest, planChunks, readingBudget, splitChunk, type ReadingChunk } from './request'
import { estimateTokens, hashText } from './text'
import { markRefused, modelKeyOf } from './refusals'
import { nothingToDo, planRead } from './track'
import { loadShapeSafe, memoryAt, placeWords, sideClashesFor } from './places'
import { oneReadingFor, payoffAsks, stageFromReply, summaryFromReply, type OneReading, type SummaryRead } from './oneReading'
import { keepStageRead } from '../continuity/tracker'

type DB = Database.Database

/** How many times one run may split a chunk whose reply ran past the reply limit. */
const MAX_SPLITS = 16

export interface RunOptions {
  db: DB
  /** The memory model, or null when none is chosen (then the scene waits). */
  model: MemoryModel | null
  /** Read every paragraph again, though the text hasn't changed since the last read (B8, "Re-read"). */
  whole?: boolean
  signal: AbortSignal
  /** True once the world has closed: nothing more is written. */
  closed: () => boolean
  /** Called just before the memory model is first asked about the scene. */
  onReading?: () => void
  /** Told each generation record's id as soon as it exists. */
  onRecord?: (generationId: ID) => void
  fetchImpl?: typeof fetch
  retryDelays?: number[]
  /**
   * One reading of a scene (oneReading.ts): a scene read in one request also says where things stand at the end of the
   * words read, when they are the ones the tracker would read next, and writes the scene's summary when every paragraph is
   * read and `summaryDue()` says it is due. Left out: the reading alone, as before.
   */
  oneReading?: { summaryDue: () => boolean }
}

export type RunOutcome =
  | { status: 'nothing' }
  | { status: 'gone' }
  | { status: 'no-model' }
  | { status: 'stopped' }
  | {
      status: 'done'
      runId: ID | null
      lines: number
      entryIds: ID[]
      readParagraphs: number
      newEntryIds?: ID[]
      /** Where things stand at the scene's end was kept from this reading (one reading of a scene): the tracker needn't ask. */
      staged?: boolean
      /** The scene's summary this reading wrote (one reading of a scene), for the engine to keep while it is due. */
      summary?: SummaryRead
    }
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

/** Common first words that start a sentence without being a name, so they can follow a colon or semicolon in lower case. */
const COMMON_START = /^(The|It|Its|A|An|Add|Try|Pick|Choose|Check|Set|Wait|This|That|Your|You|Something|Some|Nothing|There)\b/

const lowerStart = (s: string): string => s.replace(COMMON_START, (w) => w.toLowerCase())

/** A message of a sentence or two, as one plain sentence: "X needs a key. Add it in Settings." → "X needs a key; add it in Settings." */
export function oneSentence(message: string): string {
  const parts = message
    .trim()
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .map((p) => p.trim().replace(/[.!?]+$/, ''))
    .filter(Boolean)
  if (!parts.length) return 'Something went wrong.'
  return `${[parts[0], ...parts.slice(1).map(lowerStart)].join('; ')}.`
}

/**
 * The scene couldn't be read: it shows "Memory not updated" (tried again on the next trigger and at
 * app start) and is listed in What changed (once while it stays failed; the line keeps the latest
 * reason). `reason` is one plain sentence; the status adds where the scene is. The memory is left as it was.
 */
export function failScene(db: DB, sceneId: ID, runId: ID | null, where: string, reason: string, totals: kdb.RunTotals | null): RunOutcome {
  const id = runId ?? kdb.startRun(db, sceneId, kdb.keeperScene(db, sceneId)?.textVersion ?? 0)
  const text = oneSentence(reason)
  const error = `The memory couldn't read ${where || 'this scene'}: ${lowerStart(text)}`
  db.transaction(() => {
    const wasFailed = kdb.keeperScene(db, sceneId)?.memoryState === 'failed'
    kdb.markFailed(db, sceneId, error)
    if (!wasFailed || !kdb.updateFailedLine(db, sceneId, text)) {
      kdb.insertLog(db, {
        runId: id,
        sceneId,
        entryName: '',
        text,
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
  if (!o.whole && scene.memoryVersion >= scene.textVersion && scene.memoryState === 'current') return { status: 'nothing' }

  const plan = planRead(db, scene, { whole: o.whole })
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
  const fail = (reason: string): RunOutcome =>
    o.closed() || !db.open ? { status: 'stopped' } : failScene(db, sceneId, runId, where, reason, totals.of(model))
  const stopped = (): RunOutcome => {
    if (!o.closed() && db.open) kdb.finishRun(db, runId, 'stopped', null, totals.of(model))
    return { status: 'stopped' }
  }

  const budget = readingBudget(model.choice)
  if (!budget) {
    return fail('The memory model can take too little text at once, so pick another memory model in Settings › Models.')
  }
  const memory = memoryAt(db, scene.storyId, sceneId)
  const chunks = planChunks(plan.paras, plan.toRead, plan.atRisk, budget)
  const card = repo.getScene(db, sceneId).card
  const versions = new Map(memory.entries.map((e) => [e.id, e.updatedAt]))
  // The open plot threads due here: every request asks a verdict on their pay-off (overhaul, 2026-10-19).
  const payoffs = payoffAsks(db, sceneId, card, memory)
  o.onReading?.()

  // One reading of a scene: read in one request, the same call can say where things stand and write the summary.
  const oneAsked = o.oneReading && chunks.length === 1 ? oneReadingFor(db, scene, plan.paras, chunks[0], model, o.oneReading.summaryDue) : null
  /** What the one request also said (one reading of a scene), when it asked and its reply could be read. */
  let also: { one: OneReading; value: unknown; generationId: ID } | null = null

  const replies: ChunkReply[] = []
  let splits = 0
  while (chunks.length) {
    const chunk = chunks.shift()!
    const request = (one: OneReading | null): ReturnType<typeof buildRequest> =>
      buildRequest({ where, title: scene.title, card, chunk, found: plan.found, memory, budget, one, maxOutput: model.choice.maxOutput, payoffs })
    let req = request(chunks.length === 0 && !replies.length ? oneAsked : null)
    const ask = (messages: ChatMessage[]): Promise<CallResult> =>
      callModel({
        db,
        model,
        targetId: sceneId,
        job: 'memory',
        task: 'read',
        messages,
        blocks: req.blocks,
        maxTokens: req.maxTokens,
        entries: req.entryIds.map((id) => ({ entryId: id, version: versions.get(id) ?? '' })),
        signal: o.signal,
        closed: o.closed,
        onRecord: o.onRecord,
        // Read in the background: a provider that has stopped answering is given up on sooner (ai/patience.ts).
        background: true,
        fetchImpl: o.fetchImpl,
        retryDelays: o.retryDelays
      })
    let reply: ReadingReply | null = null
    let halves: ReadingChunk[] | null = null
    let messages = req.messages
    for (let attempt = 0; attempt < 2 && !reply; attempt++) {
      const call = await ask(messages)
      totals.add(call)
      if (o.closed() || call.status === 'stopped' || o.signal.aborted) return stopped()
      if (call.status === 'error') {
        if (call.failure?.type === 'refused' && db.open && !o.closed()) markRefused(db, 'read', sceneId, hashText(scene.text), modelKeyOf(model))
        return fail(call.error ?? 'Something went wrong.')
      }
      const parsed = parseLenient(call.text)
      const checked = parsed.ok ? readingReply(parsed.value) : parsed
      if (checked.ok) {
        reply = checked.reply
        if (req.one) also = { one: req.one, value: parsed.ok ? parsed.value : null, generationId: call.generationId }
        break
      }
      // A long reply cut off by the reply limit: asking again would be cut off the same way. A reading that also asked
      // where things stand or for the summary is asked again for the reading alone (they make their own calls, as
      // before); otherwise the chunk is read in two smaller halves instead.
      const cutOff = checked.why === CUT_OFF && estimateTokens(call.text) >= budget.reply * 0.6
      if (cutOff && req.one) {
        req = request(null)
        messages = req.messages
        attempt = -1
        continue
      }
      halves = cutOff && splits < MAX_SPLITS ? splitChunk(chunk) : null
      if (halves) break
      // Asked once more (overhaul phase 1): the same request without the reply that couldn't be used, so a provider's
      // cache serves all of it, with what was wrong said at its end. A reading that also asked where things stand or for
      // the summary is asked for the reading alone, the way that has always worked (they make their own calls).
      if (req.one) req = request(null)
      messages = withCorrection(req.messages, retryMessage(checked.why))
    }
    if (halves) {
      splits++
      chunks.unshift(...halves)
      continue
    }
    if (!reply) {
      return fail(
        "The memory model's reply wasn't in the right format; it will try again, or you can pick another memory model in Settings › Models."
      )
    }
    replies.push({ ids: req.ids, reply, paras: chunk.paras, payoffs: req.payoffs })
  }

  if (o.closed() || !db.open) return { status: 'stopped' }
  // The scene may have been deleted while the model was reading it.
  if (!kdb.keeperScene(db, sceneId)) return stopped()
  const result = db.transaction(() => applyRead(db, { runId, memory, shape, sideClashes: sideClashesFor(db, shape) }, plan, replies))()
  kdb.finishRun(db, runId, 'done', null, totals.of(model))
  // Where things stand at the end of the words read, kept by the tracker's own rules (never on a start that changed since).
  let staged = false
  const stage = also?.one.stage ? stageFromReply(also.value) : undefined
  if (also?.one.stage && stage) {
    try {
      staged = keepStageRead(db, also.one.stage, stage)
    } catch (e) {
      console.warn('Could not keep where things stand from the reading', e)
    }
  }
  const summary = also ? summaryFromReply(also.value, also.one.summary, also.generationId) : undefined
  return {
    status: 'done',
    runId,
    lines: result.lines,
    entryIds: result.entryIds,
    readParagraphs: plan.toRead.length,
    newEntryIds: result.newEntryIds ?? [],
    ...(staged ? { staged } : {}),
    ...(summary ? { summary } : {})
  }
}

/** The request asked once more: the same messages, with a short line on what was wrong after the last one. */
export function withCorrection(messages: ChatMessage[], correction: string): ChatMessage[] {
  const last = messages.length - 1
  return messages.map((m, i) => (i === last ? { ...m, content: `${m.content}\n\n${correction}` } : m))
}
