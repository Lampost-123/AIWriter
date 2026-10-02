// The builder's AI jobs: Quick start, Flesh out, Give me options and Interview. Each call is recorded
// (job 'builder', with no scene, so no Drafts list shows it), streams in the background, sends what has
// arrived to the window about every 40 ms, can be stopped (what has fully arrived is kept) and ends
// with 'builder:done'. A reply that can't be used is asked for once more, saying why. Quick start saves
// as it goes: the entry once it has a name, then its fields every second or so and at the end.
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
  QuickStartInput
} from '@shared/contracts/builder'
import type { ChatMessage, ID } from '@shared/types'
import * as gens from '../db/generations'
import { knownParams, streamChat, type SentParams, type StreamOutcome } from '../ai/client'
import { isKeyFailure } from '../ai/errors'
import { parseLenient } from '../keeper/json'
import { estimateTokens } from '../keeper/text'
import { newId, now, UserError } from '../util'
import { builderFailure, UNUSABLE } from './errors'
import type { BuilderModel } from './model'
import { parsePartial } from './partial'
import {
  fleshOutTargets,
  fleshOutValues,
  interviewReply,
  optionsFrom,
  optionsFromText,
  pickThree,
  quickStartView,
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
  profileText,
  quickStartSystem,
  quickStartUser,
  retryMessage,
  worldText,
  type WorldBrief
} from './prompts'
import { cleanValues, createBuilt, noteWritten, saveBuilt, type Written } from './save'

type DB = Database.Database
export type Emit = <E extends keyof AppEvents>(event: E, payload: AppEvents[E]) => void

/** What has arrived goes to the window at most this often. */
export const PROGRESS_MS = 40
/** A Quick start profile is saved at most this often while it arrives (and always at the end). */
export const SAVE_MS = 1500
/** Context length assumed when the model's is unknown. */
export const DEFAULT_CONTEXT = 16_000
/** Room for each job's reply. Generous: a model that thinks first can spend much of it thinking. */
export const REPLY_TOKENS: Record<BuilderJob, number> = { 'quick-start': 8000, 'flesh-out': 4000, options: 3000, interview: 2000 }
const TEMPERATURE: Record<BuilderJob, number> = { 'quick-start': 0.8, 'flesh-out': 0.85, options: 1, interview: 0.9 }
const TOP_P = 0.95

export interface JobContext {
  db: DB
  model: BuilderModel
  emit: Emit
  /** Quick start saved an entry: lists and pages showing it reload. */
  onSaved?: (entryId: ID) => void
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
  const all = new Map([...brief.lore, ...brief.groups, ...brief.characters, ...brief.same].map((e) => [e.id, e.updatedAt]))
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
  gens.insertGeneration(db, {
    id,
    sceneId: '',
    job: 'builder',
    providerId: model.target.id,
    providerName: model.target.name,
    modelId: model.choice.modelId,
    params: { temperature, top_p: TOP_P, max_tokens: reply, ...(start.sampling ? {} : { sampling: false }) },
    direction: o.direction.slice(0, 4000),
    blocks: [],
    messages,
    budget: { contextLength, reserved: reply, available: Math.max(0, contextLength - reply), used: prompt },
    entries: o.entries,
    createdAt: now()
  })
  let text = ''
  run.records.set(id, () => text)
  const outcome = await streamChat({
    target: model.target,
    body: { model: model.choice.modelId, messages, temperature, top_p: TOP_P, max_tokens: reply },
    signal: run.controller.signal,
    onText: (t) => {
      text += t
      onText(t)
    },
    onRetry: (info) => ctx.emit('builder:retrying', { jobId: run.id, ...info }),
    fallbackMaxTokens: reply > 2000 ? 2000 : undefined,
    startParams: start,
    fetchImpl: ctx.fetchImpl,
    delays: ctx.retryDelays
  }).catch(
    (e: unknown): StreamOutcome => ({
      status: 'error',
      text,
      error: `Something went wrong: ${(e as Error)?.message ?? e}`,
      failure: null,
      promptTokens: null,
      completionTokens: null,
      cost: null,
      finishReason: null,
      retries: 0,
      maxTokens: reply,
      cutOff: false,
      sentParams: start
    })
  )
  run.records.delete(id)
  const status = run.closed ? 'stopped' : outcome.status
  const error = outcome.status === 'error' ? (outcome.failure ? builderFailure(outcome.failure, model.target, model.choice.modelId) : outcome.error) : null
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
        completionTokens: outcome.completionTokens,
        cost,
        finishedAt: now()
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
  const run: Run = { id: jobId, job, db: ctx.db, controller: new AbortController(), closed: false, records: new Map(), done: Promise.resolve() }
  running.set(jobId, run)
  run.done = work(run)
    .catch(
      (e: unknown): BuilderDone => {
        console.error('A builder job failed', e)
        return { ...progressOf(run), status: 'error', error: `Something went wrong: ${(e as Error)?.message ?? e}` }
      }
    )
    .then((done) => {
      running.delete(jobId)
      ctx.emit('builder:done', run.closed ? { ...done, status: 'stopped', error: null } : done)
    })
}

/** Why a reply couldn't be read, for asking again. */
const whyOf = (text: string, fallback: string): string => {
  const p = parseLenient(text)
  return p.ok ? fallback : p.why
}

const asObject = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null)

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
  begin(ctx, input.jobId, 'quick-start', (run) => quickStart(ctx, run, input, notes.slice(0, 20_000), brief))
}

async function quickStart(ctx: JobContext, run: Run, input: QuickStartInput, notes: string, brief: WorldBrief): Promise<BuilderDone> {
  const { db } = ctx
  const kind = input.kind
  const system = quickStartSystem(kind)
  const space = room(ctx.model, 'quick-start', estimateTokens(system) + estimateTokens(notes) + 150)
  const world = worldText(brief, kind, space.world)
  let messages: ChatMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: quickStartUser(kind, notes, world.text, !!input.sceneId) }
  ]
  const entries = versionsOf(brief, world.entryIds)
  const state = { entryId: null as ID | null, written: {} as Written, lastSave: 0, failed: null as string | null }
  let text = ''
  let view: QuickStartView = { values: {}, fromNotes: [], writing: null }
  const progress = (): BuilderProgress =>
    progressOf(run, { values: view.values, fromNotes: view.fromNotes, writing: view.writing, entryId: state.entryId })

  // Saves the fields that have fully arrived: the entry once there is a name, then every second or so.
  const save = (force: boolean): void => {
    if (run.closed || !db.open || state.failed || !view.values.name) return
    if (!force && state.entryId && Date.now() - state.lastSave < SAVE_MS) return
    try {
      if (!state.entryId) {
        const drafted = Object.keys(view.values).filter((k) => !view.fromNotes.includes(k))
        const e = createBuilt(db, kind, view.values, drafted, input.storyId ?? null)
        state.entryId = e.id
        noteWritten(state.written, e, cleanValues(kind, view.values))
        ctx.onSaved?.(e.id)
      } else saveBuilt(db, kind, state.entryId, view.values, view.fromNotes, state.written)
      state.lastSave = Date.now()
    } catch (e) {
      state.failed = e instanceof UserError ? e.message : `Something went wrong while saving: ${(e as Error)?.message ?? e}`
      run.controller.abort()
    }
  }
  run.closing = () => {
    view = quickStartView(kind, notes, { value: parsePartial(text).value, open: null })
    save(true)
  }

  for (let attempt = 0; ; attempt++) {
    text = ''
    const tick = ticker(() => {
      view = quickStartView(kind, notes, parsePartial(text))
      save(false)
      ctx.emit('builder:progress', progress())
    })
    const asked = await ask(ctx, run, messages, space.reply, (t) => {
      text += t
      tick.request()
    }, { direction: notes, entries })
    tick.cancel()
    if (run.closed) return { ...progress(), writing: null, status: 'stopped', error: null }
    view = quickStartView(kind, notes, { value: finalValue(text), open: null })
    // Nothing usable came back: ask once more, saying why.
    if (asked.status === 'complete' && !view.values.name && !state.entryId && attempt === 0) {
      messages = [...messages, { role: 'assistant', content: text }, { role: 'user', content: retryMessage(whyOf(text, 'it had no "name"'), QUICK_SHAPE) }]
      view = { values: {}, fromNotes: [], writing: null }
      ctx.emit('builder:progress', progress())
      continue
    }
    save(true)
    if (state.entryId) ctx.onSaved?.(state.entryId)
    const done = { ...progress(), writing: null }
    if (state.failed) return { ...done, status: 'error', error: state.failed }
    if (asked.status === 'error') return { ...done, status: 'error', error: `${asked.error}${state.entryId ? ' What arrived is saved.' : ''}` }
    if (asked.status === 'stopped') return { ...done, status: 'stopped', error: null }
    if (!state.entryId) return { ...done, status: 'error', error: UNUSABLE }
    return { ...done, status: 'complete', error: null }
  }
}

// ---------- Flesh out ----------

export function startFleshOut(ctx: JobContext, input: FleshOutInput, brief: WorldBrief): void {
  const values = cleanValues(input.kind, input.values)
  const targets = fleshOutTargets(input.kind, input.keys ?? [], values)
  if (!targets.length) throw new UserError('Every field here is filled in already. Give me options can offer others for any one of them.')
  begin(ctx, input.jobId, 'flesh-out', (run) => fleshOut(ctx, run, input, values, targets, brief))
}

async function fleshOut(ctx: JobContext, run: Run, input: FleshOutInput, values: BuilderValues, targets: string[], brief: WorldBrief): Promise<BuilderDone> {
  const kind = input.kind
  const system = fleshOutSystem(kind)
  const space = room(ctx.model, 'flesh-out', estimateTokens(system) + estimateTokens(profileText(kind, values)) + 200)
  const world = worldText(brief, kind, space.world)
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
    const asked = await ask(ctx, run, messages, space.reply, (t) => {
      text += t
      tick.request()
    }, { direction: '', entries })
    tick.cancel()
    found = fleshOutValues(kind, finalValue(text), targets)
    if (asked.status === 'complete' && !Object.keys(found).length && attempt === 0) {
      const shape = `{${targets.map((k) => `"${k}": "..."`).join(', ')}}`
      messages = [...messages, { role: 'assistant', content: text }, { role: 'user', content: retryMessage(whyOf(text, 'it had none of the fields asked for'), shape) }]
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
  const world = worldText(brief, kind, space.world)
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
    const asked = await ask(ctx, run, messages, space.reply, (t) => {
      text += t
      tick.request()
    }, { direction: '', entries })
    tick.cancel()
    let list = optionsFrom(kind, key, finalValue(text))
    if (!list.length) list = optionsFromText(kind, key, text)
    const three = pickThree(list)
    if (asked.status === 'complete' && !three && attempt === 0) {
      const why = list.length ? `it gave ${list.length === 1 ? 'one option' : `${list.length} different options`} rather than three` : whyOf(text, 'it had no options in it')
      messages = [...messages, { role: 'assistant', content: text }, { role: 'user', content: retryMessage(why, '{"options": ["first", "second", "third"]}') }]
      ctx.emit('builder:progress', progressOf(run))
      continue
    }
    if (asked.status === 'error') return { ...progressOf(run, { options: list.slice(0, 3) }), status: 'error', error: asked.error }
    if (asked.status === 'stopped') return { ...progressOf(run, { options: list.slice(0, 3) }), status: 'stopped', error: null }
    if (!three) {
      return {
        ...progressOf(run),
        status: 'error',
        error: "The AI didn't come up with three different options. Try again, or pick another writer model in Settings › Models."
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

async function interview(ctx: JobContext, run: Run, input: InterviewInput, values: BuilderValues, question: string, brief: WorldBrief): Promise<BuilderDone> {
  const name = values.name
  const turns = (input.turns ?? []).filter((t) => t && typeof t.text === 'string')
  const fixed = estimateTokens(profileText('character', values)) + estimateTokens(turns.map((t) => t.text).join('\n')) + 600
  const space = room(ctx.model, 'interview', fixed)
  const world = worldText(brief, 'character', space.world)
  const messages = interviewMessages(interviewSystem(values, world.text), turns, question)
  let text = ''
  const tick = ticker(() => ctx.emit('builder:progress', progressOf(run, { text: interviewReply(text, name, true) })))
  const asked = await ask(ctx, run, messages, space.reply, (t) => {
    text += t
    tick.request()
  }, { direction: question, entries: versionsOf(brief, world.entryIds) })
  tick.cancel()
  const done = progressOf(run, { text: interviewReply(text, name) })
  if (asked.status === 'error') return { ...done, status: 'error', error: asked.error }
  if (asked.status === 'stopped') return { ...done, status: 'stopped', error: null }
  return { ...done, status: 'complete', error: null }
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
