// The three story flows, each from the stories it needs to the memory written: what changed in a time
// gap, a prequel's starting cast, and "When did these happen?". Each reads the world, asks the model
// (see call.ts), and writes the result in one transaction once the reply is in. A job that is stopped,
// or whose model fails, writes nothing. Never throws for anything Adam can fix: the result says what
// happened in plain words. No Electron imports.

import type Database from 'better-sqlite3'
import type { EntryKind, ID, Story, WritingPrefs } from '@shared/types'
import type { StoryFlowKind } from '@shared/contracts/storyFlows'
import * as repo from '../db/repo'
import * as fdb from '../db/storyFlows'
import { UserError } from '../util'
import { loadMemoryData, loadShape } from '../memory/scene'
import { askForJson, flowBudget, TOO_SMALL, type CallTotals, type FlowModel } from './call'
import { castRequest, timeGapRequest, whenRequest } from './context'
import { castShape, gapShape, readCast, readGap, readWhen, whenShape } from './parse'
import { alreadySorted, applyCast, applyGap, applyWhen, hasOwnStart, type Applied, type RunTotals } from './apply'
import { CAST_KINDS, SYSTEMS } from './prompts'

type DB = Database.Database

export interface JobOptions {
  db: DB
  /** The model to use, or why there is none (flowTarget in model.ts). */
  model: () => FlowModel | { error: string }
  prefs: WritingPrefs
  signal: AbortSignal
  /** True once the world has closed: nothing more is written. */
  closed: () => boolean
  fetchImpl?: typeof fetch
  retryDelays?: number[]
}

export type JobResult =
  | { status: 'done'; message: string; entryIds: ID[]; runId: ID | null }
  | { status: 'failed'; message: string }
  | { status: 'stopped' }

/** What a flow is asked to do: which story, and the cast or the book when the flow needs one. */
export type FlowArgs =
  | { flow: 'time-gap'; storyId: ID }
  | { flow: 'starting-cast'; storyId: ID; entryIds: ID[] }
  | { flow: 'when'; storyId: ID; bookId: ID }

export const STOPPED = 'Stopped. Nothing was changed.'
export const NO_STORY = 'That story no longer exists.'
export const NO_GAP = 'Add the time since the previous story first.'
export const NOT_PREQUEL = 'Only a prequel gets a drafted starting cast. Make this story a prequel to a book first.'
export const NO_BOOK = 'Choose the book this prequel comes before first.'
/** Most entries one starting cast request drafts; a bigger cast is asked for in several. */
export const CAST_BATCH = 10

const failed = (message: string): JobResult => ({ status: 'failed', message })
const titleOf = (s: Story): string => s.title.trim() || 'Untitled story'

function storyOrNull(db: DB, id: ID): Story | null {
  try {
    return repo.getStory(db, id)
  } catch {
    return null
  }
}

const NUMBER_WORDS =
  /^(\d[\d,.]*|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|a hundred|a thousand|thousand)\b/i
const SPAN_WORDS = /^(a|an|some|several|many|a few|a couple of|about|almost|nearly|over|more than)\b/i
const UNITS = /\b(second|minute|hour|day|night|week|fortnight|month|season|year|decade|century|centuries|generation|age|winter|summer|spring|autumn|lifetime)s?$/i

/**
 * The running note for a time gap, with the gap in Adam's words when they read as a span of time:
 * "Working out what changed in the 200 years…", "…over a few weeks…".
 */
export function gapPhrase(timeGap: string, title: string): string {
  const gap = timeGap
    .trim()
    .replace(/[.!]+$/, '')
    .replace(/\s+(later|after|on|afterwards|have passed|has passed|passed)$/i, '')
    .trim()
  if (gap.length <= 40 && UNITS.test(gap)) {
    if (NUMBER_WORDS.test(gap)) return `Working out what changed in the ${gap}…`
    if (SPAN_WORDS.test(gap)) return `Working out what changed over ${gap}…`
  }
  return `Working out what changed before ${title} starts…`
}

/** The quiet note while a flow runs. */
export function runningMessage(db: DB, args: FlowArgs): string {
  const story = storyOrNull(db, args.storyId)
  const title = story ? titleOf(story) : 'the story'
  switch (args.flow) {
    case 'time-gap':
      return gapPhrase(story?.timeGap ?? '', title)
    case 'starting-cast':
      return `Drafting the starting cast for ${title}…`
    case 'when': {
      const book = storyOrNull(db, args.bookId)
      return `Working out when the changes at the start of ${book ? titleOf(book) : 'the next book'} happened…`
    }
  }
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

/** "Added 4 changes and closed 1 plot thread, listed under What changed". */
function doneMessage(parts: string[], none: string): string {
  if (!parts.length) return none
  const said = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
  return `${said[0].toUpperCase()}${said.slice(1)}, listed under What changed`
}

const nothingDone: Applied = { runId: null, lines: 0, entryIds: [], added: 0, removed: 0, closed: 0, moved: 0, left: 0, carried: 0 }

function gapDone(a: Applied): string {
  const parts: string[] = []
  if (a.added) parts.push(`added ${plural(a.added, 'change', 'changes')}`)
  if (a.closed) parts.push(`closed ${plural(a.closed, 'plot thread', 'plot threads')}`)
  if (a.removed) parts.push(`took out ${plural(a.removed, 'earlier change', 'earlier changes')}`)
  return doneMessage(parts, 'Nothing needed changing')
}

const castDone = (a: Applied): string =>
  doneMessage(a.lines ? [`drafted ${plural(a.lines, 'starting description', 'starting descriptions')}`] : [], 'Nothing needed drafting')

const whenDone = (a: Applied): string =>
  doneMessage(a.lines ? [`sorted ${plural(a.lines, 'change', 'changes')}`] : [], 'Nothing needed sorting')

function totalsFor(model: FlowModel, calls: CallTotals[]): RunTotals {
  const sum = (k: 'promptTokens' | 'completionTokens' | 'cost'): number | null =>
    calls.some((c) => c[k] != null) ? calls.reduce((n, c) => n + (c[k] ?? 0), 0) : null
  return {
    providerId: model.target.id,
    modelId: model.choice.modelId,
    promptTokens: sum('promptTokens'),
    completionTokens: sum('completionTokens'),
    cost: sum('cost'),
    generationIds: calls.flatMap((c) => c.generationIds)
  }
}

const halted = (o: JobOptions): boolean => o.signal.aborted || o.closed() || !o.db.open

/** Writes a flow's result in one transaction, unless it was stopped meanwhile. */
function write(o: JobOptions, apply: () => Applied, message: (a: Applied) => string): JobResult {
  if (halted(o)) return { status: 'stopped' }
  const a = o.db.transaction(apply)()
  if (a.lines) repo.touchWorld(o.db)
  return { status: 'done', message: message(a), entryIds: [...new Set(a.entryIds)], runId: a.runId }
}

type Budget = NonNullable<ReturnType<typeof flowBudget>>

function modelAndBudget(o: JobOptions, flow: StoryFlowKind): { model: FlowModel; budget: Budget } | string {
  const model = o.model()
  if ('error' in model) return model.error
  const budget = flowBudget(model.choice, SYSTEMS[flow])
  if (!budget) return TOO_SMALL
  return { model, budget }
}

const callOptions = (o: JobOptions, model: FlowModel, budget: Budget) => ({
  db: o.db,
  model,
  budget,
  signal: o.signal,
  closed: o.closed,
  fetchImpl: o.fetchImpl,
  retryDelays: o.retryDelays
})

// ---------- What changed before this story starts? ----------

export async function runTimeGap(o: JobOptions, storyId: ID): Promise<JobResult> {
  const story = storyOrNull(o.db, storyId)
  if (!story) return failed(NO_STORY)
  if (!story.timeGap.trim()) return failed(NO_GAP)
  // A prequel's time is before its book, not after an earlier story: its starting cast is drafted instead.
  if (story.kind === 'prequel') return { status: 'done', message: gapDone(nothingDone), entryIds: [], runId: null }
  const got = modelAndBudget(o, 'time-gap')
  if (typeof got === 'string') return failed(got)
  const { model, budget } = got

  const shape = loadShape(o.db)
  const data = loadMemoryData(o.db)
  const req = timeGapRequest(o.db, { story, shape, data, prefs: o.prefs, budget })
  let plan = { changes: [], closed: [] } as ReturnType<typeof readGap>
  const calls: CallTotals[] = []
  // With nobody there yet and no threads open, there is nothing for the time to change.
  if (req.cast.size || req.threads.size) {
    const call = await askForJson({ ...callOptions(o, model, budget), ...req }, gapShape)
    calls.push(call.totals)
    if (call.status === 'stopped') return { status: 'stopped' }
    if (call.status === 'failed') return failed(call.error)
    const kinds = new Map<ID, EntryKind>(data.entries.filter((e) => req.cast.has(e.id)).map((e) => [e.id, e.kind]))
    plan = readGap(call.value, req.ids, kinds, req.threads)
  }
  return write(
    o,
    () => {
      const now = repo.getStory(o.db, storyId)
      return applyGap(o.db, now, plan, totalsFor(model, calls))
    },
    gapDone
  )
}

// ---------- A prequel's starting cast ----------

export async function runStartingCast(o: JobOptions, storyId: ID, entryIds: ID[]): Promise<JobResult> {
  const story = storyOrNull(o.db, storyId)
  if (!story) return failed(NO_STORY)
  if (story.kind !== 'prequel') return failed(NOT_PREQUEL)
  const bookId = story.leadsIntoId ?? story.startStoryId
  const book = bookId ? storyOrNull(o.db, bookId) : null
  if (!book) return failed(NO_BOOK)

  // Only characters, places, groups and items, and only those without a starting description of Adam's.
  const here = fdb.startChanges(o.db, story.id)
  const live = new Map(repo.getEntries(o.db, [...new Set(entryIds)]).map((e) => [e.id, e]))
  const wanted = [...live.values()].filter((e) => CAST_KINDS.includes(e.kind) && !hasOwnStart(here, e.id)).map((e) => e.id)
  if (!wanted.length) return { status: 'done', message: castDone(nothingDone), entryIds: [], runId: null }

  const got = modelAndBudget(o, 'starting-cast')
  if (typeof got === 'string') return failed(got)
  const { model, budget } = got
  const shape = loadShape(o.db)
  const data = loadMemoryData(o.db)
  const calls: CallTotals[] = []
  const drafts: ReturnType<typeof readCast> = []
  for (let i = 0; i < wanted.length; i += CAST_BATCH) {
    const req = castRequest(o.db, { story, book, entryIds: wanted.slice(i, i + CAST_BATCH), shape, data, prefs: o.prefs, budget })
    if (!req.drafting.length) continue
    const call = await askForJson({ ...callOptions(o, model, budget), ...req }, castShape)
    calls.push(call.totals)
    if (call.status === 'stopped') return { status: 'stopped' }
    if (call.status === 'failed') return failed(call.error)
    drafts.push(...readCast(call.value, req.ids, req.drafting))
  }
  return write(o, () => applyCast(o.db, repo.getStory(o.db, storyId), drafts, totalsFor(model, calls)), castDone)
}

// ---------- When did these happen? ----------

export async function runWhen(o: JobOptions, storyId: ID, bookId: ID): Promise<JobResult> {
  const story = storyOrNull(o.db, storyId)
  const book = storyOrNull(o.db, bookId)
  if (!story || !book) return failed(NO_STORY)
  if (book.startStoryId !== story.id) {
    return failed(`${titleOf(book)} doesn't continue after ${titleOf(story)}. Set it to continue after ${titleOf(story)} first.`)
  }
  const all = fdb.startChanges(o.db, book.id)
  const done = alreadySorted(o.db, story.id, book.id, all)
  const changes = all.filter((c) => !done.has(c.id))
  if (!changes.length) return { status: 'done', message: whenDone(nothingDone), entryIds: [], runId: null }

  const got = modelAndBudget(o, 'when')
  if (typeof got === 'string') return failed(got)
  const { model, budget } = got
  const shape = loadShape(o.db)
  const data = loadMemoryData(o.db)
  const req = whenRequest(o.db, { story, book, changes, shape, data, prefs: o.prefs, budget })
  const call = await askForJson({ ...callOptions(o, model, budget), ...req }, whenShape)
  if (call.status === 'stopped') return { status: 'stopped' }
  if (call.status === 'failed') return failed(call.error)
  const picks = readWhen(call.value, req.changeIds, req.sceneIds)
  const apply = (): Applied =>
    applyWhen(o.db, repo.getStory(o.db, storyId), repo.getStory(o.db, bookId), req.changeIds.ids(), picks, totalsFor(model, [call.totals]))
  return write(o, apply, whenDone)
}

/** Runs one flow. Anything unexpected becomes a failure in plain words, so the note never sticks at "running". */
export async function runFlow(o: JobOptions, args: FlowArgs): Promise<JobResult> {
  try {
    switch (args.flow) {
      case 'time-gap':
        return await runTimeGap(o, args.storyId)
      case 'starting-cast':
        return await runStartingCast(o, args.storyId, args.entryIds)
      case 'when':
        return await runWhen(o, args.storyId, args.bookId)
    }
  } catch (e) {
    if (halted(o)) return { status: 'stopped' }
    if (e instanceof UserError) return failed(e.message)
    console.error('A story flow stopped unexpectedly', e)
    return failed(`Something went wrong: ${e instanceof Error ? e.message : String(e)}. Try again.`)
  }
}
