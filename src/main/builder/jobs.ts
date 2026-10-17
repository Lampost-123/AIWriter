// The builder's AI jobs: Quick start, Flesh out, Give me options, Interview and Suggest relationships. Each call is recorded
// (job 'builder', with no scene, so no Drafts list shows it), streams in the background, sends what has
// arrived to the window about every 40 ms, can be stopped (what has fully arrived is kept) and ends
// with 'builder:done'. A reply that can't be used is asked for once more, saying why. Quick start saves
// as it goes: the entry once it has a name, then each part of the reply as it completes, and the end.
// No Electron imports: events go through the `emit` the caller passes in.

import type Database from 'better-sqlite3'
import type { AppEvents } from '@shared/api'
import type {
  BuilderDone,
  BuilderJob,
  BuilderProgress,
  BuilderValues,
  FleshOutInput,
  InterviewInput,
  OptionsInput,
  QuestionsInput,
  QuickStartInput,
  RelationshipsInput,
  SuggestedRelationship
} from '@shared/contracts/builder'
import type { ChatMessage, Entry, ID } from '@shared/types'
import * as gens from '../db/generations'
import * as repo from '../db/repo'
import { knownParams, levelOfEffort, streamChat, thinkingEffort, type SentParams, type StreamOutcome } from '../ai/client'
import { isKeyFailure } from '../ai/errors'
import { parseLenient } from '../keeper/json'
import { memoryReplyLimits, sentAs } from '../keeper/model'
import { estimateTokens } from '../keeper/text'
import { newId, now, UserError } from '../util'
import { builderFailure, NOT_SAVED, UNEXPECTED, UNUSABLE } from './errors'
import type { BuilderModel } from './model'
import { parsePartial, type PartialJson } from './partial'
import {
  fleshOutTargets,
  fleshOutValues,
  hisKeys,
  interviewReply,
  optionsFrom,
  optionsFromText,
  partsBegun,
  pickThree,
  profileKeys,
  questionsFrom,
  questionsFromText,
  quickStartView,
  valuesOf,
  writingField,
  type QuickStartView
} from './profile'
import {
  fleshOutSystem,
  fleshOutUser,
  interviewMessages,
  interviewSystem,
  optionsSystem,
  optionsUser,
  answersText,
  briefVersions,
  MAX_QUESTIONS,
  MAX_RELATIONSHIPS,
  profileText,
  questionsSystem,
  questionsUser,
  quickStartSystem,
  quickStartUser,
  relationshipsSystem,
  relationshipsUser,
  retryMessage,
  sentTurns,
  worldText,
  type WorldBrief
} from './prompts'
import { cleanValues, createBuilt, linkedTo, noteWritten, sameEntry, saveBuilt, savedValues, type Written } from './save'
import { sharesName } from '../worldBuilder/names'
import { replyItems } from '../worldBuilder/parse'

type DB = Database.Database
export type Emit = <E extends keyof AppEvents>(event: E, payload: AppEvents[E]) => void

/** What has arrived goes to the window at most this often. */
export const PROGRESS_MS = 40
/** Context length assumed when the model's is unknown. */
export const DEFAULT_CONTEXT = 16_000
/** Room for each job's reply. Generous: a model that thinks first can spend much of it thinking. */
export const REPLY_TOKENS: Record<BuilderJob, number> = {
  'quick-start': 8000,
  'flesh-out': 4000,
  options: 3000,
  interview: 2000,
  questions: 2000,
  relationships: 2000
}
const TEMPERATURE: Record<BuilderJob, number> = { 'quick-start': 0.8, 'flesh-out': 0.85, options: 1, interview: 0.9, questions: 0.7, relationships: 0.8 }
const TOP_P = 0.95

export interface JobContext {
  db: DB
  model: BuilderModel
  emit: Emit
  /** Quick start saved an entry: lists and pages showing it reload. */
  onSaved?: (entryId: ID) => void
  /** A job ended, as 'builder:done' says (after it is sent): what comes after it (a character's voice) starts here. */
  onDone?: (done: BuilderDone) => void
  /** The provider turned the key down, so Settings can show it isn't working. */
  onKeyRejected?: () => void
  /** For tests. */
  fetchImpl?: typeof fetch
  retryDelays?: number[]
}

interface Run {
  id: ID
  job: BuilderJob
  db: DB
  controller: AbortController
  /** The world closed under this job: nothing more is written. */
  closed: boolean
  /** Records still streaming, with the text each has so far, finished as stopped if the world closes. */
  records: Map<ID, () => string>
  /** Saves what has arrived, straight away (the world is closing). */
  closing?: () => void
  done: Promise<void>
}

const running = new Map<ID, Run>()

export const isRunning = (jobId: ID): boolean => running.has(jobId)

const progressOf = (run: Run, p: Partial<BuilderProgress> = {}): BuilderProgress => ({
  jobId: run.id,
  job: run.job,
  values: {},
  writing: null,
  fromNotes: [],
  entryId: null,
  options: [],
  text: '',
  ...p
})

/** Calls `fn` at most once every `ms`, after the first request. */
function ticker(fn: () => void, ms = PROGRESS_MS): { request(): void; cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | null = null
  return {
    request: () => {
      timer ??= setTimeout(() => {
        timer = null
        fn()
      }, ms)
    },
    cancel: () => {
      if (timer) clearTimeout(timer)
      timer = null
    }
  }
}

/** How long the reply may be, and how much of the world fits beside `fixed` tokens of instructions and notes. */
export function room(model: BuilderModel, job: BuilderJob, fixed: number): { reply: number; world: number } {
  const ctx = model.choice.contextLength && model.choice.contextLength > 0 ? model.choice.contextLength : DEFAULT_CONTEXT
  const reply = Math.max(512, Math.min(REPLY_TOKENS[job], model.choice.maxOutput ?? Infinity, Math.floor(ctx * 0.5)))
  return { reply, world: Math.max(300, ctx - reply - fixed - 300) }
}

const versionsOf = (brief: WorldBrief, ids: ID[]): { entryId: ID; version: string }[] => {
  const all = briefVersions(brief)
  return ids.map((entryId) => ({ entryId, version: all.get(entryId) ?? '' }))
}

const tokensOf = (messages: ChatMessage[]): number => estimateTokens(messages.map((m) => m.content).join('\n'))

interface Asked {
  status: StreamOutcome['status']
  text: string
  /** Plain words with a next step, when status is 'error'. */
  error: string | null
}

/** One request to the model, recorded, streamed into `onText`. Never throws. */
async function ask(
  ctx: JobContext,
  run: Run,
  messages: ChatMessage[],
  reply: number,
  onText: (t: string) => void,
  o: { direction: string; entries: { entryId: ID; version: string }[] }
): Promise<Asked> {
  const { db, model } = ctx
  if (run.closed || !db.open || run.controller.signal.aborted) return { status: 'stopped', text: '', error: null }
  const id = newId()
  const contextLength = model.choice.contextLength ?? DEFAULT_CONTEXT
  const prompt = tokensOf(messages)
  const known = knownParams(model.target, model.choice.modelId)
  const start: SentParams = model.choice.sampling === false ? { ...known, sampling: false } : known
  const temperature = TEMPERATURE[run.job]
  // Thinking counts against the reply limit, so the limit leaves room for it (as the memory keeper's does).
  const thinking = model.thinking ?? 'off'
  const { limit, thinkingRoom } = memoryReplyLimits({ ...model.choice, contextLength }, prompt, reply, thinking)
  const askedFor = levelOfEffort(thinkingEffort(model.target, model.choice.modelId, thinking))
  const params = {
    temperature,
    top_p: TOP_P,
    max_tokens: limit,
    ...(start.sampling ? {} : { sampling: false }),
    ...(askedFor ? { thinking: askedFor } : {})
  }
  try {
    gens.insertGeneration(db, {
      id,
      sceneId: '',
      job: 'builder',
      providerId: model.target.id,
      providerName: model.target.name,
      modelId: model.choice.modelId,
      params,
      direction: o.direction.slice(0, 4000),
      blocks: [],
      messages,
      budget: { contextLength, reserved: limit, available: Math.max(0, contextLength - limit), used: prompt },
      entries: o.entries,
      createdAt: now()
    })
  } catch (e) {
    // Milestone 6: refused before anything was sent (this month's spending reached Adam's limit part way
    // through a job), in its own plain words rather than as "Something went wrong".
    if (e instanceof UserError) return { status: 'error', text: '', error: e.message }
    throw e
  }
  let text = ''
  run.records.set(id, () => text)
  const outcome = await streamChat({
    target: model.target,
    body: { model: model.choice.modelId, messages, temperature, top_p: TOP_P, max_tokens: limit },
    signal: run.controller.signal,
    onText: (t) => {
      text += t
      onText(t)
    },
    onRetry: (info) => ctx.emit('builder:retrying', { jobId: run.id, ...info }),
    // A provider that turns the limit down is asked with the reply's own room, or less if that is turned down too.
    fallbackMaxTokens: limit > reply ? reply : reply > 2000 ? 2000 : undefined,
    startParams: start,
    thinking,
    thinkingRoom,
    fetchImpl: ctx.fetchImpl,
    delays: ctx.retryDelays
  }).catch((e: unknown): StreamOutcome => {
    // Plain words on screen (2026-10-17); what broke goes to the log.
    console.error('A builder request failed', e)
    return {
      status: 'error',
      text,
      error: UNEXPECTED,
      failure: null,
      promptTokens: null,
      cachedTokens: null,
      completionTokens: null,
      cost: null,
      finishReason: null,
      retries: 0,
      maxTokens: limit,
      cutOff: false,
      sentParams: start,
      effort: thinkingEffort(model.target, model.choice.modelId, thinking)
    }
  })
  run.records.delete(id)
  const status = run.closed ? 'stopped' : outcome.status
  const failed = outcome.status === 'error'
  const error = !failed ? null : outcome.failure ? builderFailure(outcome.failure, model.target, model.choice.modelId, thinking) : outcome.error
  const c = model.choice
  const cost =
    outcome.cost ??
    (c.promptPrice != null && c.completionPrice != null && (outcome.text || outcome.status !== 'error')
      ? (outcome.promptTokens ?? prompt) * c.promptPrice + (outcome.completionTokens ?? estimateTokens(outcome.text)) * c.completionPrice
      : null)
  if (!run.closed && db.open) {
    try {
      gens.finishGeneration(db, id, {
        status,
        error,
        response: outcome.text,
        promptTokens: outcome.promptTokens,
        cachedTokens: outcome.cachedTokens,
        completionTokens: outcome.completionTokens,
        cost,
        finishedAt: now(),
        // The reply limit and thinking as finally sent, so "What the AI saw" stays truthful.
        params: sentAs(params, outcome)
      })
    } catch (e) {
      console.error('Could not finish the builder record', e)
    }
  }
  if (isKeyFailure(outcome.failure)) ctx.onKeyRejected?.()
  return { status, text: outcome.text, error }
}

/** Starts a job in the background. */
function begin(ctx: JobContext, jobId: ID, job: BuilderJob, work: (run: Run) => Promise<BuilderDone>): void {
  if (!jobId || running.has(jobId)) throw new UserError('That is already being written. Stop it first, or wait for it to finish.')
  const run: Run = {
    id: jobId,
    job,
    db: ctx.db,
    controller: new AbortController(),
    closed: false,
    records: new Map(),
    done: Promise.resolve()
  }
  running.set(jobId, run)
  run.done = work(run)
    .catch(
      (e: unknown): BuilderDone => {
        console.error('A builder job failed', e)
        return { ...progressOf(run), status: 'error', error: e instanceof UserError ? e.message : UNEXPECTED }
      }
    )
    .then((done) => {
      running.delete(jobId)
      const said: BuilderDone = run.closed ? { ...done, status: 'stopped', error: null } : done
      ctx.emit('builder:done', said)
      try {
        ctx.onDone?.(said)
      } catch (e) {
        console.warn('Could not follow on from a builder job', e)
      }
    })
}

/** Why a reply couldn't be read, for asking again. */
const whyOf = (text: string, fallback: string): string => {
  const p = parseLenient(text)
  return p.ok ? fallback : p.why
}

const asObject = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null

/** The whole reply when it reads as JSON, else as much of it as had arrived. */
function finalValue(text: string): Record<string, unknown> | null {
  const whole = parseLenient(text)
  return whole.ok ? asObject(whole.value) : parsePartial(text).value
}

// ---------- Quick start ----------

const QUICK_SHAPE = '{"fromNotes": {"key": "the author\'s words", ...}, "drafted": {"name": "...", "key": "...", ...}}'

export function startQuickStart(ctx: JobContext, input: QuickStartInput, brief: WorldBrief): void {
  const notes = (input.notes ?? '').trim()
  if (!notes) throw new UserError('Type or paste something about them first. One line is enough.')
  // Finish the rest: the entry an earlier build saved before it stopped part way.
  const existing = input.entryId ? repo.getEntry(ctx.db, input.entryId) : null
  if (existing && existing.kind !== input.kind) throw new UserError('That page can’t be finished here.')
  if (existing && !fleshOutTargets(input.kind, profileKeys(input.kind), valuesOf(input.kind, existing)).length) {
    throw new UserError('Every field is filled in already. Look it over step by step to change any of them.')
  }
  begin(ctx, input.jobId, 'quick-start', (run) => quickStart(ctx, run, input, notes.slice(0, 20_000), brief, existing))
}

/** What Quick start says while it adds to a page the world already had. */
export const addingTo = (name: string): string => `Adding to ${name}’s page`

async function quickStart(
  ctx: JobContext,
  run: Run,
  input: QuickStartInput,
  notes: string,
  brief: WorldBrief,
  finishing: Entry | null
): Promise<BuilderDone> {
  const { db } = ctx
  const kind = input.kind
  const system = quickStartSystem(kind)
  // Finishing an entry: what it holds stays as it is, and is shown with what arrives. So too (2026-10-17) for one
  // the world already has under the name that arrives (`joined`): it is finished rather than made a second time.
  let existing = finishing
  let joined: Entry | null = null
  let before = existing ? valuesOf(kind, existing) : {}
  let beforeHis = existing ? hisKeys(kind, existing) : []
  const sofar = existing ? profileText(kind, before) : ''
  // His answers to the follow-up questions are his words, as the notes are (one left to the AI is the AI's to decide).
  const answers = (input.answers ?? [])
    .filter((a) => a && typeof a.question === 'string' && a.question.trim())
    .slice(0, MAX_QUESTIONS)
    .map((a) => ({ question: a.question.slice(0, 400), answer: typeof a.answer === 'string' ? a.answer.slice(0, 2000) : null }))
  const his = [notes, ...answers.map((a) => a.answer ?? '').filter((t) => t.trim())].join('\n')
  const space = room(ctx.model, 'quick-start', estimateTokens(system) + estimateTokens(notes) + estimateTokens(answersText(answers)) + estimateTokens(sofar) + 150)
  const world = worldText(brief, kind, space.world, `${his}\n${sofar}`)
  let messages: ChatMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: quickStartUser(kind, notes, world.text, !!input.sceneId, sofar, answers) }
  ]
  const entries = versionsOf(brief, world.entryIds)
  const state = { entryId: existing?.id ?? null, written: {} as Written, failed: null as string | null }
  let text = ''
  let view: QuickStartView = { values: { ...before }, fromNotes: beforeHis, writing: null }
  const onto = (v: QuickStartView): QuickStartView => {
    if (!existing) return v
    const values: BuilderValues = { ...before }
    for (const [k, x] of Object.entries(v.values)) values[k] ??= x
    const fromNotes = [...beforeHis, ...v.fromNotes.filter((k) => !(k in before))]
    return { values, fromNotes, writing: v.writing && !(v.writing.key in before) ? v.writing : null }
  }
  const viewOf = (parsed: Pick<PartialJson, 'value' | 'open'>): QuickStartView => onto(quickStartView(kind, his, parsed))
  const progress = (): BuilderProgress =>
    progressOf(run, {
      values: view.values,
      fromNotes: view.fromNotes,
      writing: view.writing,
      entryId: state.entryId,
      ...(joined ? { text: addingTo(joined.name) } : {})
    })
  // A page the world had counts as built once the name arrived, even when every field of it was filled already.
  const arrived = (): boolean => (existing && !joined ? Object.keys(view.values).some((k) => !(k in before)) : !!view.values.name)

  // Saves the fields that have fully arrived. Only now and then, since each save writes a version of
  // the entry's history: once there is a name, as each part of the reply (Adam's words, the AI's) is
  // complete, and at the end, on Stop or when the world closes. A reply without the two parts is
  // saved once it has a name and then at the end. Only what the reply adds is saved (2026-10-17): the page's own
  // fields stay out, so one Adam clears while it is finished stays empty rather than put back from the copy shown.
  const added = (): BuilderValues => Object.fromEntries(Object.entries(view.values).filter(([k]) => !(k in before)))
  const save = (): void => {
    if (run.closed || !db.open || state.failed || !view.values.name) return
    try {
      // The name is one the world has for this kind already, exactly: what arrives fills only that page's empty fields.
      const same = !state.entryId ? sameEntry(db, kind, view.values) : null
      if (same) {
        existing = joined = same
        before = valuesOf(kind, same)
        beforeHis = hisKeys(kind, same)
        view = onto(view)
        state.entryId = same.id
        saveBuilt(db, kind, same.id, added(), view.fromNotes, state.written)
        ctx.onSaved?.(same.id)
      } else if (!state.entryId) {
        const drafted = Object.keys(view.values).filter((k) => !view.fromNotes.includes(k))
        const e = createBuilt(db, kind, view.values, drafted, input.storyId ?? null)
        state.entryId = e.id
        noteWritten(state.written, e, savedValues(kind, view.values, new Set(drafted)))
        ctx.onSaved?.(e.id)
      } else saveBuilt(db, kind, state.entryId, added(), view.fromNotes, state.written)
    } catch (e) {
      if (!(e instanceof UserError)) console.error('Quick start could not save', e)
      state.failed = e instanceof UserError ? e.message : NOT_SAVED
      run.controller.abort()
    }
  }
  run.closing = () => {
    // The whole reply if it had all arrived (2026-10-17), else as much of it as had.
    view = viewOf({ value: finalValue(text), open: null })
    save()
  }

  for (let attempt = 0; ; attempt++) {
    text = ''
    let parts = 0
    const tick = ticker(() => {
      const parsed = parsePartial(text)
      view = viewOf(parsed)
      // A new part of the reply has begun, so the one before it is complete.
      const n = partsBegun(parsed.value)
      if (!state.entryId || n > parts) save()
      parts = n
      ctx.emit('builder:progress', progress())
    })
    const asked = await ask(
      ctx,
      run,
      messages,
      space.reply,
      (t) => {
        text += t
        tick.request()
      },
      { direction: notes, entries }
    )
    tick.cancel()
    if (run.closed) return { ...progress(), writing: null, status: 'stopped', error: null }
    view = viewOf({ value: finalValue(text), open: null })
    // Nothing usable came back: ask once more, saying why.
    if (asked.status === 'complete' && !arrived() && attempt === 0) {
      messages = [
        ...messages,
        { role: 'assistant', content: text },
        { role: 'user', content: retryMessage(whyOf(text, existing ? 'it had none of the empty fields' : 'it had no "name"'), QUICK_SHAPE) }
      ]
      view = viewOf({ value: null, open: null })
      ctx.emit('builder:progress', progress())
      continue
    }
    save()
    if (state.entryId) ctx.onSaved?.(state.entryId)
    const done = { ...progress(), writing: null }
    if (state.failed) return { ...done, status: 'error', error: state.failed }
    // What had arrived is saved: the screen says so, and offers to finish the rest.
    if (asked.status === 'error') return { ...done, status: 'error', error: asked.error }
    if (asked.status === 'stopped') return { ...done, status: 'stopped', error: null }
    if (!state.entryId || !arrived()) return { ...done, status: 'error', error: UNUSABLE }
    return { ...done, status: 'complete', error: null }
  }
}

// ---------- Follow-up questions ----------

export function startQuestions(ctx: JobContext, input: QuestionsInput, brief: WorldBrief): void {
  const notes = (input.notes ?? '').trim()
  if (!notes) throw new UserError('Type or paste something about them first. One line is enough.')
  begin(ctx, input.jobId, 'questions', (run) => questions(ctx, run, input, notes.slice(0, 20_000), brief))
}

async function questions(ctx: JobContext, run: Run, input: QuestionsInput, notes: string, brief: WorldBrief): Promise<BuilderDone> {
  const { kind } = input
  const system = questionsSystem(kind)
  const space = room(ctx.model, 'questions', estimateTokens(system) + estimateTokens(notes) + 150)
  const world = worldText(brief, kind, space.world, notes)
  let messages: ChatMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: questionsUser(kind, notes, world.text, !!input.sceneId) }
  ]
  const entries = versionsOf(brief, world.entryIds)
  for (let attempt = 0; ; attempt++) {
    let text = ''
    const tick = ticker(() => {
      const p = parsePartial(text)
      // Only whole questions show: the one still arriving waits until it is complete.
      const list = questionsFrom(p.value, MAX_QUESTIONS)
      const open = p.open && p.open.path.some((x) => typeof x === 'number') ? list.slice(0, -1) : list
      ctx.emit('builder:progress', progressOf(run, { options: open }))
    })
    const asked = await ask(
      ctx,
      run,
      messages,
      space.reply,
      (t) => {
        text += t
        tick.request()
      },
      { direction: notes, entries }
    )
    tick.cancel()
    let list = questionsFrom(finalValue(text), MAX_QUESTIONS)
    if (!list.length) list = questionsFromText(text, MAX_QUESTIONS)
    if (asked.status === 'complete' && !list.length && attempt === 0) {
      messages = [
        ...messages,
        { role: 'assistant', content: text },
        { role: 'user', content: retryMessage(whyOf(text, 'it had no questions in it'), '{"questions": ["first question?", "second question?", "third question?"]}') }
      ]
      ctx.emit('builder:progress', progressOf(run))
      continue
    }
    if (asked.status === 'error') return { ...progressOf(run, { options: list }), status: 'error', error: asked.error }
    if (asked.status === 'stopped') return { ...progressOf(run, { options: list }), status: 'stopped', error: null }
    if (!list.length) return { ...progressOf(run), status: 'error', error: UNUSABLE }
    return { ...progressOf(run, { options: list }), status: 'complete', error: null }
  }
}

// ---------- Flesh out ----------

export function startFleshOut(ctx: JobContext, input: FleshOutInput, brief: WorldBrief): void {
  const values = cleanValues(input.kind, input.values)
  const targets = fleshOutTargets(input.kind, input.keys ?? [], values)
  if (!targets.length) throw new UserError('Every field here is filled in already. Give me options can offer others for any one of them.')
  begin(ctx, input.jobId, 'flesh-out', (run) => fleshOut(ctx, run, input, values, targets, brief))
}

async function fleshOut(
  ctx: JobContext,
  run: Run,
  input: FleshOutInput,
  values: BuilderValues,
  targets: string[],
  brief: WorldBrief
): Promise<BuilderDone> {
  const kind = input.kind
  const system = fleshOutSystem(kind)
  const space = room(ctx.model, 'flesh-out', estimateTokens(system) + estimateTokens(profileText(kind, values)) + 200)
  const world = worldText(brief, kind, space.world, profileText(kind, values))
  let messages: ChatMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: fleshOutUser(kind, values, targets, world.text) }
  ]
  const entries = versionsOf(brief, world.entryIds)
  let found: BuilderValues = {}
  let writing: BuilderProgress['writing'] = null
  for (let attempt = 0; ; attempt++) {
    let text = ''
    const tick = ticker(() => {
      const p = parsePartial(text)
      found = fleshOutValues(kind, p.value, targets)
      writing = writingField(kind, p.open, targets)
      ctx.emit('builder:progress', progressOf(run, { values: found, writing }))
    })
    const asked = await ask(
      ctx,
      run,
      messages,
      space.reply,
      (t) => {
        text += t
        tick.request()
      },
      { direction: '', entries }
    )
    tick.cancel()
    found = fleshOutValues(kind, finalValue(text), targets)
    if (asked.status === 'complete' && !Object.keys(found).length && attempt === 0) {
      const shape = `{${targets.map((k) => `"${k}": "..."`).join(', ')}}`
      messages = [
        ...messages,
        { role: 'assistant', content: text },
        { role: 'user', content: retryMessage(whyOf(text, 'it had none of the fields asked for'), shape) }
      ]
      ctx.emit('builder:progress', progressOf(run))
      continue
    }
    const done = progressOf(run, { values: found })
    if (asked.status === 'error') return { ...done, status: 'error', error: asked.error }
    if (asked.status === 'stopped') return { ...done, status: 'stopped', error: null }
    if (!Object.keys(found).length) return { ...done, status: 'error', error: UNUSABLE }
    return { ...done, status: 'complete', error: null }
  }
}

// ---------- Give me options ----------

export function startOptions(ctx: JobContext, input: OptionsInput, brief: WorldBrief): void {
  const values = cleanValues(input.kind, input.values)
  if (!fleshOutTargets(input.kind, [input.key], {}).length) throw new UserError('That field has no options to offer.')
  begin(ctx, input.jobId, 'options', (run) => options(ctx, run, input, values, brief))
}

async function options(ctx: JobContext, run: Run, input: OptionsInput, values: BuilderValues, brief: WorldBrief): Promise<BuilderDone> {
  const { kind, key } = input
  const system = optionsSystem(kind)
  const space = room(ctx.model, 'options', estimateTokens(system) + estimateTokens(profileText(kind, values)) + 200)
  const world = worldText(brief, kind, space.world, profileText(kind, values))
  let messages: ChatMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: optionsUser(kind, values, key, world.text) }
  ]
  const entries = versionsOf(brief, world.entryIds)
  for (let attempt = 0; ; attempt++) {
    let text = ''
    const tick = ticker(() => {
      const p = parsePartial(text)
      const open = p.open && p.open.path.some((x) => typeof x === 'number') ? { key, text: p.open.text } : null
      ctx.emit('builder:progress', progressOf(run, { options: optionsFrom(kind, key, p.value).slice(0, 3), writing: open }))
    })
    const asked = await ask(
      ctx,
      run,
      messages,
      space.reply,
      (t) => {
        text += t
        tick.request()
      },
      { direction: '', entries }
    )
    tick.cancel()
    let list = optionsFrom(kind, key, finalValue(text))
    if (!list.length) list = optionsFromText(kind, key, text)
    const three = pickThree(list)
    if (asked.status === 'complete' && !three && attempt === 0) {
      const why = list.length
        ? `it gave ${list.length === 1 ? 'one option' : `${list.length} different options`} rather than three`
        : whyOf(text, 'it had no options in it')
      messages = [
        ...messages,
        { role: 'assistant', content: text },
        { role: 'user', content: retryMessage(why, '{"options": ["first", "second", "third"]}') }
      ]
      ctx.emit('builder:progress', progressOf(run))
      continue
    }
    if (asked.status === 'error') return { ...progressOf(run, { options: list.slice(0, 3) }), status: 'error', error: asked.error }
    if (asked.status === 'stopped') return { ...progressOf(run, { options: list.slice(0, 3) }), status: 'stopped', error: null }
    if (!three) {
      return {
        ...progressOf(run),
        status: 'error',
        error: "The AI didn't come up with three different options. Try again, or pick another character builder model in Settings › Models."
      }
    }
    return { ...progressOf(run, { options: three }), status: 'complete', error: null }
  }
}

// ---------- Interview ----------

export function startInterview(ctx: JobContext, input: InterviewInput, brief: WorldBrief): void {
  const values = cleanValues('character', input.values)
  if (!values.name) throw new UserError('Give the character a name first, so there is someone to talk to.')
  const question = (input.question ?? '').trim()
  if (!question) throw new UserError('Type a question first.')
  begin(ctx, input.jobId, 'interview', (run) => interview(ctx, run, input, values, question.slice(0, 2000), brief))
}

async function interview(
  ctx: JobContext,
  run: Run,
  input: InterviewInput,
  values: BuilderValues,
  question: string,
  brief: WorldBrief
): Promise<BuilderDone> {
  const name = values.name
  const turns = (input.turns ?? []).filter((t) => t && typeof t.text === 'string')
  // Only the turns that are sent take room (2026-10-17), so a long interview doesn't crowd out the world.
  const sent = sentTurns(turns)
  const fixed = estimateTokens(profileText('character', values)) + estimateTokens([...sent.map((t) => t.text), question].join('\n')) + 600
  const space = room(ctx.model, 'interview', fixed)
  const world = worldText(brief, 'character', space.world, [profileText('character', values), ...sent.slice(-4).map((t) => t.text), question].join('\n'))
  const messages = interviewMessages(interviewSystem(values, world.text), turns, question)
  let text = ''
  const tick = ticker(() => ctx.emit('builder:progress', progressOf(run, { text: interviewReply(text, name, true) })))
  const asked = await ask(
    ctx,
    run,
    messages,
    space.reply,
    (t) => {
      text += t
      tick.request()
    },
    { direction: question, entries: versionsOf(brief, world.entryIds) }
  )
  tick.cancel()
  const done = progressOf(run, { text: interviewReply(text, name) })
  if (asked.status === 'error') return { ...done, status: 'error', error: asked.error }
  if (asked.status === 'stopped') return { ...done, status: 'stopped', error: null }
  return { ...done, status: 'complete', error: null }
}

// ---------- Suggest relationships ----------

/** The most of the list of who they can be linked to one request carries, in tokens. */
const CANDIDATE_TOKENS = 1500

type Linkable = Entry & { kind: 'character' | 'group' }

/** Who a character can be linked to: the world's other live characters and its groups, not linked to them already. */
function linkable(db: DB, self: Entry): { others: Linkable[]; taken: Entry[] } {
  const linked = linkedTo(db, self.id)
  const all = repo
    .listEntries(db)
    .filter((e): e is Linkable => (e.kind === 'character' || e.kind === 'group') && e.id !== self.id)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
  return { others: all.filter((e) => !linked.has(e.id)), taken: all.filter((e) => linked.has(e.id)) }
}

const textOf = (o: Record<string, unknown>, keys: string[], n: number): string => {
  for (const k of keys) {
    const v = o[k]
    if (typeof v === 'string' && v.trim()) return v.trim().slice(0, n)
  }
  return ''
}

/**
 * The suggestions in a reply, each with the entry it names: only an entry of the world's under exactly that name or
 * another of its names (a character before a group), never the character themselves, one they are linked to already,
 * or one suggested twice.
 */
export function suggestedRelationships(value: unknown, self: Entry, others: readonly Linkable[]): SuggestedRelationship[] {
  const out: SuggestedRelationship[] = []
  for (const item of replyItems(value, ['relationships'])) {
    const name = textOf(item, ['with', 'to', 'name', 'other', 'who'], 120)
    if (!name) continue
    const want = { name, aliases: [] }
    if (sharesName(want, self)) continue
    const found = others.find((e) => e.kind === 'character' && sharesName(want, e)) ?? others.find((e) => sharesName(want, e))
    if (!found || out.some((s) => s.otherId === found.id)) continue
    out.push({
      otherId: found.id,
      otherName: found.name,
      otherKind: found.kind,
      type: textOf(item, ['type', 'relationship', 'is'], 80),
      feels: textOf(item, ['feels', 'fromFeels'], 300),
      otherFeels: found.kind === 'group' ? '' : textOf(item, ['otherFeels', 'otherfeels', 'toFeels'], 300)
    })
    if (out.length >= MAX_RELATIONSHIPS) break
  }
  return out
}

export function startRelationships(ctx: JobContext, input: RelationshipsInput, brief: WorldBrief): void {
  let self: Entry | null = null
  try {
    self = input.entryId ? repo.getEntry(ctx.db, input.entryId) : null
  } catch {
    self = null
  }
  if (!self || self.kind !== 'character') throw new UserError('Give the character a name first, so there is someone to link.')
  const { others, taken } = linkable(ctx.db, self)
  if (!others.length) {
    throw new UserError(
      taken.length
        ? `${self.name || 'They'} is linked to everyone in the world already.`
        : 'Your world has no other characters or groups yet. Add some first, then the AI can suggest how they are linked.'
    )
  }
  const me = self
  begin(ctx, input.jobId, 'relationships', (run) => relationships(ctx, run, input, me, others, taken, brief))
}

async function relationships(
  ctx: JobContext,
  run: Run,
  input: RelationshipsInput,
  self: Entry,
  others: Linkable[],
  taken: Entry[],
  brief: WorldBrief
): Promise<BuilderDone> {
  const values = { ...cleanValues('character', input.values) }
  values.name ||= self.name
  const system = relationshipsSystem()
  const profile = profileText('character', values)
  // As many of who they can be linked to as fit, newest first.
  const candidates: string[] = []
  let size = 0
  for (const e of others) {
    const line = `${e.name.trim() || 'Unnamed'} (${e.kind})`
    size += estimateTokens(line) + 1
    if (size > CANDIDATE_TOKENS) break
    candidates.push(line)
  }
  const takenNames = taken.map((e) => e.name.trim()).filter(Boolean).slice(0, 60)
  const fixed = estimateTokens(system) + estimateTokens(profile) + size + estimateTokens(takenNames.join('\n')) + 200
  const space = room(ctx.model, 'relationships', fixed)
  const world = worldText(brief, 'character', space.world, profile)
  let messages: ChatMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: relationshipsUser(values, world.text, candidates, takenNames) }
  ]
  const entries = versionsOf(brief, world.entryIds)
  const read = (value: unknown): SuggestedRelationship[] => suggestedRelationships(value, self, others)
  for (let attempt = 0; ; attempt++) {
    let text = ''
    const tick = ticker(() => {
      const p = parsePartial(text)
      // Only whole suggestions show: the last waits until the next begins, or the reply ends.
      const items = replyItems(p.value, ['relationships'])
      ctx.emit('builder:progress', progressOf(run, { relationships: read(p.done ? items : items.slice(0, -1)) }))
    })
    const asked = await ask(
      ctx,
      run,
      messages,
      space.reply,
      (t) => {
        text += t
        tick.request()
      },
      { direction: '', entries }
    )
    tick.cancel()
    const value = finalValue(text)
    const list = read(value)
    // No list at all (not an empty one, which says nothing fits): ask once more, saying why.
    if (asked.status === 'complete' && !list.length && !Array.isArray(value?.relationships) && attempt === 0) {
      messages = [
        ...messages,
        { role: 'assistant', content: text },
        { role: 'user', content: retryMessage(whyOf(text, 'it had no "relationships" list'), '{"relationships": [{"with": "...", "type": "...", "feels": "...", "otherFeels": "..."}]}') }
      ]
      ctx.emit('builder:progress', progressOf(run, { relationships: [] }))
      continue
    }
    const done = progressOf(run, { relationships: list })
    if (asked.status === 'error') return { ...done, status: 'error', error: asked.error }
    if (asked.status === 'stopped') return { ...done, status: 'stopped', error: null }
    return { ...done, status: 'complete', error: null }
  }
}

// ---------- Stopping ----------

/** Stops a job; what has fully arrived is kept. Resolves once it has finished. */
export async function stopJob(jobId: ID): Promise<void> {
  const run = running.get(jobId)
  if (!run) return
  run.controller.abort()
  await run.done
}

/** The world is closing: save what each of its jobs has, finish their records, and stop them. */
export function stopJobsFor(db: DB): void {
  for (const run of running.values()) {
    if (run.db !== db || run.closed) continue
    try {
      run.closing?.()
    } catch (e) {
      console.error('Could not save what the builder had on close', e)
    }
    run.closed = true
    run.controller.abort()
    for (const [id, text] of run.records) {
      try {
        gens.finishGeneration(db, id, {
          status: 'stopped',
          error: null,
          response: text(),
          promptTokens: null,
          completionTokens: null,
          cost: null,
          finishedAt: now()
        })
      } catch (e) {
        console.error('Could not finish the builder record on close', e)
      }
    }
  }
}
