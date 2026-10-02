// Building the world from a summary (milestone 4): the build itself. One click lays out everything the
// summary names, saving each thing as it is made: a first look lists everything by kind (each part of a
// long summary in turn), then each character's full profile (one request each, as Quick start writes
// it), then places, groups, items, lore, events, plot threads and glossary words (several of one kind at a
// time), the relationships between the characters, and the world's themes and tone while they are empty.
// Characters and places come first, so the rest can link to them. Anything the world has already (by name,
// other name or a near-duplicate name) is left as it is; where the summary disagrees with what a page
// says, that becomes a consistency issue. Every request goes through the shared task runner
// (src/main/ai/tasks.ts) as a 'world' record. One build runs at a time and goes on while Adam is on other
// pages; Cancel (or the world closing) keeps what was saved. No Electron imports: events go through `emit`.

import type Database from 'better-sqlite3'
import type { TaskDone, TaskProgress } from '@shared/contracts/tasks'
import type {
  WorldBuildConflict,
  WorldBuildDone,
  WorldBuildInput,
  WorldBuildProgress,
  WorldBuildStage,
  WorldBuilderState
} from '@shared/contracts/worldBuilder'
import type { ChatMessage, EntryKind, ID, WritingPrefs } from '@shared/types'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import * as kdb from '../db/keeper'
import { entryNames, entryState, lastBuildRun } from '../db/worldBuilder'
import { runTask, stopTask, type Emit } from '../ai/tasks'
import type { JobModel } from '../ai/jobModel'
import { gatherWorld } from '../builder/context'
import { retryMessage, worldText } from '../builder/prompts'
import { parsePartial } from '../builder/partial'
import { hisWordsIn, splitAliases, valuesOf } from '../builder/profile'
import { isBuilderKind } from '../builder/save'
import { CUT_OFF, parseLenient } from '../keeper/json'
import { fieldLabel, fieldValue } from '../keeper/facts'
import { clip, estimateTokens, findQuote, hashText, plain, sentences } from '../keeper/text'
import { newId, now, UserError } from '../util'
import { bareName, findMatch, type Named } from './names'
import {
  asProfileKind,
  BUILD_KINDS,
  conflictItems,
  hasOverviewLists,
  overviewItems,
  profileExtras,
  readProfile,
  relationshipItems,
  replyItems,
  sentencesNaming,
  splitSummary,
  textAbout,
  themesReply,
  type ConflictReply,
  type PlanItem,
  type Profile
} from './parse'
import {
  batchSystem,
  batchUser,
  characterSystem,
  characterUser,
  checkSystem,
  checkUser,
  existingText,
  JOB_OF,
  overviewSystem,
  overviewUser,
  pageText,
  planText,
  relationshipsSystem,
  relationshipsUser,
  SHAPES,
  themesSystem,
  themesUser,
  type WorldJob
} from './prompts'
import { earlierBuilds, madeItems } from './lines'
import { finishWriter, newWriter, saveEntry, saveMeta, saveRelationship, setParent, type Source, type Writer } from './save'
import { BATCH_ITEM_TOKENS, BATCH_MOST, MAX_SUMMARY_CHARS, NAMES_TOKENS, replyRoom, summaryRoom, worldRoom } from './sizes'

type DB = Database.Database

/** The reply could be read, but held nothing the build could use, even when asked again. */
export const UNUSABLE =
  "The AI's reply wasn't something AI Write could use. Try again, or pick another world builder model in Settings › Models."
const WENT_WRONG = 'Something went wrong while building. What was made so far is kept. Try again.'

/** How creative each request is: low for reading the summary, higher for writing profiles. */
const TEMPERATURE: Record<'overview' | 'character' | 'batch' | 'relationships' | 'themes' | 'check', number> = {
  overview: 0.2,
  character: 0.7,
  batch: 0.6,
  relationships: 0.3,
  themes: 0.5,
  check: 0.2
}
const temperatureOf = (job: WorldJob): number => TEMPERATURE[job in TEMPERATURE ? (job as keyof typeof TEMPERATURE) : 'batch']

/** Each kind's step, as progress says it: "Laying out lore and rules: 2 of 3". */
const STEP_WORDS: Record<EntryKind, string> = {
  character: 'characters',
  place: 'places',
  group: 'groups',
  item: 'items',
  lore: 'lore and rules',
  event: 'events',
  thread: 'plot threads',
  glossary: 'glossary words'
}
const STAGE_OF: Record<EntryKind, WorldBuildStage> = {
  character: 'characters',
  place: 'places',
  group: 'groups',
  item: 'items',
  lore: 'lore',
  event: 'events',
  thread: 'threads',
  glossary: 'glossary'
}

export interface BuildContext {
  db: DB
  /** The open world: its last build is kept under its id for the rest of the session. */
  worldId: ID
  model: JobModel
  /** Adam's writing preferences, under the style guide every profile is written in. */
  prefs: WritingPrefs
  emit: Emit
  /** Something was saved: lists and pages showing these entries reload, and backups see the world changed. */
  onSaved?: (entryIds: ID[]) => void
  /** The build ended, so What changed's latest update is this build. */
  onFinished?: () => void
  /** The provider turned the key down, so Settings can show it isn't working. */
  onKeyRejected?: () => void
  /** For tests. */
  fetchImpl?: typeof fetch
  retryDelays?: number[]
}

interface Build {
  id: ID
  ctx: BuildContext
  summary: string
  storyId: ID | null
  writer: Writer
  stage: WorldBuildStage
  step: string
  retrying: string | null
  /** Cancel was pressed (or the window reloaded, which stops every request). */
  cancelled: boolean
  /** The world closed: nothing more is written or sent. */
  closed: boolean
  /** Plain words when a request failed: the build stops there. */
  failure: string | null
  finished: boolean
  /** The request being made now, so Cancel can stop it. */
  taskId: ID | null
  cost: number | null
  generationIds: ID[]
  /** What is being laid out, as the first look listed it, so each profile can link to the rest. */
  plan: PlanItem[]
  found: Map<ID, { entryId: ID; kind: EntryKind; name: string }>
  missed: string[]
  skipped: string[]
  conflicts: WorldBuildConflict[]
  /** What earlier builds say not to add again, and the entries they made, under the summary's names. */
  blocked: Set<string>
  planned: Named[]
  /** Places made before the place they are inside, with its name: put inside it once it is made. */
  parents: Map<ID, string>
  done: Promise<void>
}

let current: Build | null = null
/** The last build to end in each world, for the rest of the session. */
const last = new Map<ID, WorldBuildDone>()

export const buildRunning = (): boolean => current !== null

const halted = (b: Build): boolean => b.cancelled || b.closed || b.failure !== null

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

// ---------- Starting, cancelling, closing ----------

/** Starts a build in the background; its events say how it goes. Throws (plain words) only before anything starts. Resolves when it ends. */
export function startBuild(ctx: BuildContext, input: WorldBuildInput): Promise<void> {
  if (!input?.buildId) throw new UserError('Something went wrong starting that. Try again.')
  if (current) throw new UserError('A build is already running. Wait for it to finish, or cancel it first.')
  const summary = String(input.summary ?? '').trim()
  if (!summary) throw new UserError('Write or paste a summary first.')
  if (summary.length > MAX_SUMMARY_CHARS) {
    throw new UserError('That summary is longer than AI Write can build from in one go. Build from the first part, then add the rest.')
  }
  const storyId = input.storyId ?? null
  if (storyId && !repo.listStories(ctx.db).some((s) => s.id === storyId)) {
    throw new UserError('That story no longer exists. Choose again when this is true.')
  }
  const earlier = earlierBuilds(ctx.db)
  const b: Build = {
    id: input.buildId,
    ctx,
    summary,
    storyId,
    writer: newWriter(ctx.db, storyId),
    stage: 'reading',
    step: 'Reading your summary',
    retrying: null,
    cancelled: false,
    closed: false,
    failure: null,
    finished: false,
    taskId: null,
    cost: null,
    generationIds: [],
    plan: [],
    found: new Map(),
    missed: [],
    skipped: [],
    conflicts: [],
    blocked: earlier.blocked,
    planned: earlier.planned,
    parents: new Map(),
    done: Promise.resolve()
  }
  current = b
  b.done = build(b)
  return b.done
}

/** Cancels a build: what it has saved stays. Resolves once it has stopped. */
export async function cancelBuild(buildId: ID): Promise<void> {
  const b = current
  if (!b || b.id !== buildId) return
  b.cancelled = true
  if (b.taskId) await stopTask(b.taskId)
  await b.done
}

/**
 * The world is closing: its build stops, and its run is finished now, while the database is still open
 * (the request's own record is finished by the task runner, which hears of the closing after this).
 */
export function closeBuildsFor(db: DB): void {
  const b = current
  if (!b || b.ctx.db !== db || b.finished) return
  b.cancelled = true
  if (db.open) finishRun(b, 'cancelled')
  b.closed = true
  end(b, 'cancelled')
}

/**
 * The newest build saved in the world, when none has ended this session (the app was restarted): how it
 * ended and what it cost, from its run. What it found, missed and left out isn't kept, only what it made.
 */
function savedBuild(db: DB): WorldBuildDone | null {
  const r = lastBuildRun(db)
  if (!r) return null
  return {
    buildId: '',
    status: r.status === 'done' ? 'complete' : r.status === 'failed' ? 'error' : 'cancelled',
    error: null,
    code: null,
    runId: r.id,
    made: [],
    found: [],
    missed: [],
    skipped: [],
    conflicts: [],
    cost: r.cost,
    storyId: null,
    finishedAt: r.finishedAt
  }
}

/** The World builder page's state: a build running in this world, and the last one to end (with what it made as it is now). */
export function buildState(db: DB, worldId: ID, summary: string): WorldBuilderState {
  const b = current && current.ctx.db === db && !current.finished ? current : null
  let l = last.get(worldId) ?? null
  if (!l && !b) {
    try {
      l = savedBuild(db)
    } catch (e) {
      console.warn('Could not read the last build', e)
    }
  }
  let made = l?.made ?? []
  if (l?.runId) {
    try {
      made = madeItems(db, l.runId)
    } catch (e) {
      console.warn('Could not read what the last build made', e)
    }
  }
  return { summary, running: b ? { ...snapshot(b), storyId: b.storyId } : null, last: l ? { ...l, made } : null }
}

/** For tests: forget every build (as a fresh start would). */
export function resetBuildsForTests(): void {
  current = null
  last.clear()
}

// ---------- Progress ----------

const snapshot = (b: Build): WorldBuildProgress => ({
  buildId: b.id,
  stage: b.stage,
  step: b.step,
  made: [...b.writer.made],
  retrying: b.retrying
})

function progress(b: Build): void {
  if (b.closed || b.finished) return
  b.ctx.emit('worldBuilder:progress', snapshot(b))
}

function setStep(b: Build, stage: WorldBuildStage, step: string): void {
  b.stage = stage
  b.step = step
  progress(b)
}

function saved(b: Build, entryIds: ID[]): void {
  try {
    b.ctx.onSaved?.([...new Set(entryIds)])
  } catch (e) {
    console.warn('Could not say what the build saved', e)
  }
  progress(b)
}

/** Ends the build's run in What changed, with its model, cost and requests. */
function finishRun(b: Build, status: WorldBuildDone['status']): void {
  try {
    const totals = {
      providerId: b.ctx.model.target.id,
      modelId: b.ctx.model.choice.modelId,
      promptTokens: null,
      completionTokens: null,
      cost: b.cost,
      generationIds: b.generationIds
    }
    const error = status === 'error' ? (b.failure ?? WENT_WRONG) : null
    finishWriter(b.writer, status === 'complete' ? 'done' : status === 'cancelled' ? 'stopped' : 'failed', error, totals)
  } catch (e) {
    console.error("Could not finish the build's run", e)
  }
}

function end(b: Build, status: WorldBuildDone['status']): void {
  if (b.finished) return
  b.finished = true
  if (current === b) current = null
  const error = status === 'error' ? (b.failure ?? WENT_WRONG) : null
  if (!b.closed && b.ctx.db.open) finishRun(b, status)
  const done: WorldBuildDone = {
    buildId: b.id,
    status,
    error,
    code: null,
    runId: b.writer.runId,
    made: [...b.writer.made],
    found: [...b.found.values()],
    missed: [...new Set(b.missed)],
    skipped: [...new Set(b.skipped)],
    conflicts: b.conflicts,
    cost: b.cost,
    storyId: b.storyId,
    finishedAt: now()
  }
  last.set(b.ctx.worldId, done)
  if (b.closed) return
  b.ctx.emit('worldBuilder:done', done)
  try {
    b.ctx.onFinished?.()
  } catch (e) {
    console.warn('Could not say the build ended', e)
  }
}

// ---------- The build ----------

async function build(b: Build): Promise<void> {
  try {
    const plan = await firstLook(b)
    if (plan && !halted(b)) {
      const todo = sortOut(b, plan)
      b.plan = todo
      for (const kind of BUILD_KINDS) {
        const items = todo.filter((p) => p.kind === kind)
        if (!items.length) continue
        if (kind === 'character') await layOutCharacters(b, items)
        else await layOutKind(b, kind, items)
        if (halted(b)) break
      }
      if (!halted(b)) fixParents(b)
      if (!halted(b)) await relationships(b)
      if (!halted(b)) await themesAndTone(b)
      if (!halted(b)) await check(b)
    }
    end(b, b.closed || b.cancelled ? 'cancelled' : b.failure ? 'error' : 'complete')
  } catch (e) {
    console.error('The world build failed', e)
    if (!b.failure) b.failure = e instanceof UserError ? e.message : WENT_WRONG
    end(b, b.closed || b.cancelled ? 'cancelled' : 'error')
  }
}

const chat = (system: string, user: string): ChatMessage[] => [
  { role: 'system', content: system },
  { role: 'user', content: user }
]

/** The same request again, after a reply that couldn't be used, saying why. */
const again = (messages: ChatMessage[], reply: string, why: string, shape: string): ChatMessage[] => [
  ...messages,
  { role: 'assistant', content: reply },
  { role: 'user', content: retryMessage(why, shape) }
]

/** Passes on what has arrived of a reply, and a busy service being tried again; the build says how it goes itself. */
function relay(b: Build, onText?: (text: string) => void): Emit {
  return ((event: string, payload: unknown) => {
    if (b.closed) return
    if (event === 'task:progress') {
      try {
        onText?.((payload as TaskProgress).text)
      } catch (e) {
        console.warn('Could not read a reply as it arrived', e)
      }
    } else if (event === 'task:retrying') {
      b.retrying = `${(payload as { reason: string }).reason}. Trying again…`
      progress(b)
    }
  }) as Emit
}

/**
 * One request to the World builder model, recorded and streamed by the task runner. Null when the build
 * has stopped (Cancel, the world closing, or a request that failed, whose plain words are kept).
 */
async function ask(
  b: Build,
  job: WorldJob,
  messages: ChatMessage[],
  o: { onText?: (text: string) => void; entries?: { entryId: ID; version: string }[] } = {}
): Promise<TaskDone | null> {
  if (halted(b)) return null
  const taskId = newId()
  b.taskId = taskId
  let done: TaskDone
  try {
    done = await runTask({
      db: b.ctx.db,
      taskId,
      job: 'world',
      sceneId: null,
      model: b.ctx.model,
      messages,
      reply: replyRoom(b.ctx.model.choice, job),
      temperature: temperatureOf(job),
      direction: b.summary,
      entries: o.entries,
      emit: relay(b, o.onText),
      onKeyRejected: b.ctx.onKeyRejected,
      fetchImpl: b.ctx.fetchImpl,
      retryDelays: b.ctx.retryDelays
    })
  } catch (e) {
    if (!b.closed) b.failure = e instanceof UserError ? e.message : WENT_WRONG
    return null
  } finally {
    b.taskId = null
  }
  b.generationIds.push(done.generationId)
  if (done.cost != null) b.cost = (b.cost ?? 0) + done.cost
  if (b.retrying) {
    b.retrying = null
    progress(b)
  }
  if (done.status === 'stopped') {
    // Stopped without Cancel: the window reloaded, so nothing is listening; the build stops as if cancelled.
    b.cancelled = true
    return null
  }
  if (done.status === 'error') {
    b.failure = done.error ?? WENT_WRONG
    return null
  }
  if (halted(b)) return null
  return done
}

/** A reply read as JSON: whole, or as far as it got when it was cut off. `complete` when nothing is missing from its end. */
function readReply(done: TaskDone): { value: unknown; complete: boolean; why: string | null } {
  const whole = parseLenient(done.text)
  if (whole.ok) return { value: whole.value, complete: true, why: null }
  const part = parsePartial(done.text)
  if (part.value) return { value: part.value, complete: part.done, why: done.cutOff ? CUT_OFF : whole.why }
  return { value: null, complete: false, why: done.cutOff ? CUT_OFF : whole.why }
}

/** The summary's sentences that name all of these. */
const sentencesNamingAll = (summary: string, names: string[][]): string[] =>
  sentences(summary).filter((s) => names.every((n) => sentencesNaming(s, n).length > 0))

/** What a line leaves when undone, and the summary's sentence shown on it (the first of `said`, unless another is given). */
function sourceOf(b: Build, fingerprint: string, said: string[], quote = said[0] ?? ''): Source {
  return {
    fingerprint,
    words: hashText(plain(said.length ? said.join(' ') : b.summary)),
    quote: quote ? clip(quote, 60) : ''
  }
}

/** The sentence that says what a thing is: the first starting with one of its names, else the first naming it. */
function sayingWhat(said: string[], names: string[]): string {
  const bare = names.map(bareName).filter(Boolean)
  const starts = (s: string): boolean => {
    const t = bareName(s)
    return bare.some((n) => t === n || t.startsWith(`${n} `))
  }
  return said.find(starts) ?? said[0] ?? ''
}

export const entryFingerprint = (kind: EntryKind, name: string): string => `world-build:entry:${kind}:${bareName(name)}`
export const relationshipFingerprint = (a: string, b: string): string =>
  `world-build:relationship:${[bareName(a), bareName(b)].sort().join('|')}`

const namesOf = (p: Pick<PlanItem, 'name' | 'aliases'>): string[] => [p.name, ...p.aliases]

function entrySource(b: Build, p: PlanItem): Source {
  const said = sentencesNaming(b.summary, namesOf(p))
  return sourceOf(b, entryFingerprint(p.kind, p.name), said, sayingWhat(said, namesOf(p)))
}

const blockedKey = (s: Source): string => `${s.fingerprint}\n${s.words}`

/** The world told with a profile: its style guide, rules, lore, groups and characters, as the character builder tells it. */
function worldFor(b: Build, kind: EntryKind): { text: string; entries: { entryId: ID; version: string }[] } {
  const builderKind = isBuilderKind(kind) ? kind : 'character'
  const brief = gatherWorld(b.ctx.db, { kind: builderKind, excludeId: null, storyId: b.storyId, prefs: b.ctx.prefs })
  const { text, entryIds } = worldText(brief, builderKind, worldRoom(b.ctx.model.choice, JOB_OF[kind]))
  const versions = new Map([...brief.lore, ...brief.groups, ...brief.characters, ...brief.same].map((e) => [e.id, e.updatedAt]))
  return { text, entries: entryIds.map((entryId) => ({ entryId, version: versions.get(entryId) ?? '' })) }
}

// ---------- The first look ----------

/** One list of everything the summary names, merged across its parts: the same thing named twice is one. */
export function mergePlan(items: PlanItem[]): PlanItem[] {
  const out: PlanItem[] = []
  for (const p of items) {
    const same = findMatch(
      p,
      out.map((x, i) => ({ id: String(i), kind: x.kind, name: x.name, aliases: x.aliases }))
    )
    if (!same) {
      out.push({ ...p, aliases: [...p.aliases] })
      continue
    }
    const x = out[Number(same.id)]
    for (const a of [p.name, ...p.aliases]) {
      if (bareName(a) !== bareName(x.name) && !x.aliases.some((y) => bareName(y) === bareName(a))) x.aliases.push(a)
    }
    x.about ||= p.about
    x.in ||= p.in
    x.when ||= p.when
    x.rule ||= p.rule
  }
  return out
}

async function firstLook(b: Build): Promise<PlanItem[] | null> {
  const choice = b.ctx.model.choice
  const system = overviewSystem()
  const existing = existingText(entryNames(b.ctx.db), NAMES_TOKENS)
  const parts = splitSummary(b.summary, summaryRoom(choice, 'overview', estimateTokens(system + existing) + 60))
  const items: PlanItem[] = []
  for (const [i, part] of parts.entries()) {
    setStep(b, 'reading', parts.length > 1 ? `Reading your summary: part ${i + 1} of ${parts.length}` : 'Reading your summary')
    const messages = chat(system, overviewUser(existing, part, [i + 1, parts.length]))
    let done = await ask(b, 'overview', messages)
    if (!done) return null
    let got = readReply(done)
    if (!hasOverviewLists(got.value)) {
      done = await ask(b, 'overview', again(messages, done.text, got.why ?? 'it had none of the lists asked for', SHAPES.overview))
      if (!done) return null
      got = readReply(done)
    }
    if (hasOverviewLists(got.value)) items.push(...overviewItems(got.value))
    else if (parts.length === 1) {
      b.failure = UNUSABLE
      return null
    } else b.missed.push(`Part ${i + 1} of your summary`)
  }
  return mergePlan(items)
}

/** Notes something the summary names that is in the world already. */
function noteFound(b: Build, id: ID): void {
  if (b.found.has(id) || b.writer.made.some((m) => m.entryId === id)) return
  const e = repo.getEntries(b.ctx.db, [id])[0]
  if (e) b.found.set(id, { entryId: e.id, kind: e.kind, name: e.name })
}

/** What the world has (and earlier builds made) is left as it is; what Adam undid or deleted isn't added again from the same words. The rest is laid out. */
function sortOut(b: Build, plan: PlanItem[]): PlanItem[] {
  const world = [...entryNames(b.ctx.db), ...b.planned]
  const todo: PlanItem[] = []
  for (const p of plan) {
    const there = findMatch(p, world)
    if (there) noteFound(b, there.id)
    else if (b.blocked.has(blockedKey(entrySource(b, p)))) b.skipped.push(p.name)
    else todo.push(p)
  }
  return todo
}

// ---------- Saving a profile ----------

/** True when a profile has something besides a name. */
const hasProfile = (p: Profile | null): p is Profile => !!p && Object.entries(p.values).some(([k, v]) => k !== 'name' && !!v.trim())

/**
 * Saves one profile as a new entry, unless the world has it by now (Adam made it meanwhile, or it was laid
 * out under another name earlier in this build). The summary's own name, other names and dates fill in
 * where the profile left them out.
 */
function saveProfile(b: Build, p: PlanItem, profile: Profile, raw: Record<string, unknown>): void {
  if (halted(b)) return
  const db = b.ctx.db
  const values = { ...profile.values }
  const his = new Set(profile.his)
  const isHis = hisWordsIn(b.summary)
  if (!values.name?.trim() || (!his.has('name') && isHis(p.name))) {
    values.name = p.name
    if (isHis(p.name)) his.add('name')
    else his.delete('name')
  }
  if (!values.aliases?.trim() && p.aliases.length) {
    values.aliases = p.aliases.join(', ')
    if (isHis(values.aliases)) his.add('aliases')
  }
  if (p.kind === 'event' && !values.when?.trim() && p.when) {
    values.when = p.when
    if (isHis(p.when)) his.add('when')
  }
  const extras = profileExtras(raw)
  const world = entryNames(db)
  const there = findMatch({ kind: p.kind, name: values.name, aliases: splitAliases(values.aliases ?? '') }, world) ?? findMatch(p, world)
  if (there) {
    noteFound(b, there.id)
    return
  }
  const inside = p.kind === 'place' ? extras.in || p.in : ''
  const parent = inside
    ? findMatch(
        { kind: 'place', name: inside, aliases: [] },
        world.filter((e) => e.kind === 'place')
      )
    : null
  const people = world.filter((e) => e.kind === 'character')
  const involved =
    p.kind === 'event'
      ? [...new Set(extras.involved.flatMap((n) => findMatch({ kind: 'character', name: n, aliases: [] }, people)?.id ?? []))]
      : []
  const made = saveEntry(b.writer, {
    kind: p.kind,
    planned: p.name,
    profile: { values, his: [...his] },
    parentId: parent?.id ?? null,
    hardRule: p.kind === 'lore' && (extras.rule ?? p.rule),
    involved,
    source: entrySource(b, p)
  })
  if (!made) {
    b.missed.push(p.name)
    return
  }
  if (inside && !parent) b.parents.set(made.entry.id, inside)
  saved(b, [made.entry.id, ...involved])
}

/** Puts places made before the place they are inside into it, now that it is made. */
function fixParents(b: Build): void {
  if (!b.parents.size) return
  const places = entryNames(b.ctx.db).filter((e) => e.kind === 'place')
  const touched: ID[] = []
  for (const [id, inside] of b.parents) {
    const parent = findMatch({ kind: 'place', name: inside, aliases: [] }, places)
    if (!parent || parent.id === id || entryState(b.ctx.db, id) !== 'live') continue
    try {
      setParent(b.writer, id, parent.id)
      touched.push(id)
    } catch (e) {
      console.warn('Could not put a place inside another', e)
    }
  }
  if (touched.length) saved(b, touched)
}

// ---------- Characters: one at a time ----------

async function layOutCharacters(b: Build, items: PlanItem[]): Promise<void> {
  const choice = b.ctx.model.choice
  const system = characterSystem()
  for (const [i, p] of items.entries()) {
    if (halted(b)) return
    setStep(b, 'characters', `Laying out characters: ${i + 1} of ${items.length}`)
    const world = worldFor(b, 'character')
    const plan = planText(b.plan)
    const fixed = estimateTokens(system + world.text + plan) + 150
    const about = textAbout(b.summary, namesOf(p), summaryRoom(choice, 'character', fixed))
    const messages = chat(system, characterUser(world.text, plan, about, p))
    let done = await ask(b, 'character', messages, { entries: world.entries })
    if (!done) return
    let got = readReply(done)
    let profile = isObject(got.value) ? readProfile('character', b.summary, got.value) : null
    if (!hasProfile(profile)) {
      done = await ask(b, 'character', again(messages, done.text, got.why ?? 'it had no profile in it', SHAPES.character), {
        entries: world.entries
      })
      if (!done) return
      got = readReply(done)
      profile = isObject(got.value) ? readProfile('character', b.summary, got.value) : null
    }
    if (hasProfile(profile) && isObject(got.value)) saveProfile(b, p, profile, got.value)
    else b.missed.push(p.name)
  }
}

// ---------- Everything else: several of one kind at a time ----------

/** Places inside others after the places they are inside, so each can go inside its place as it is made. */
export function parentsFirst(items: PlanItem[]): PlanItem[] {
  const depth = (p: PlanItem): number => {
    let d = 0
    let at = p
    const seen = new Set<PlanItem>([p])
    while (at.in && d < 10) {
      const up = items.find((x) => !seen.has(x) && findMatch({ kind: 'place', name: at.in, aliases: [] }, [{ id: '', ...x }]))
      if (!up) break
      seen.add(up)
      at = up
      d++
    }
    return d
  }
  return items
    .map((p, i) => ({ p, i, d: depth(p) }))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .map((x) => x.p)
}

async function layOutKind(b: Build, kind: EntryKind, items: PlanItem[]): Promise<void> {
  const total = items.length
  let handled = 0
  const step = (): void => setStep(b, STAGE_OF[kind], `Laying out ${STEP_WORDS[kind]}: ${Math.min(handled + 1, total)} of ${total}`)
  const size = Math.max(1, Math.min(BATCH_MOST, Math.floor(replyRoom(b.ctx.model.choice, JOB_OF[kind]) / BATCH_ITEM_TOKENS)))
  const askedTwice = new Set<PlanItem>()
  let queue = kind === 'place' ? parentsFirst(items) : [...items]
  while (queue.length && !halted(b)) {
    const batch = queue.slice(0, size)
    queue = queue.slice(size)
    step()
    const left = await layOutBatch(b, kind, batch, () => {
      handled++
      step()
    })
    if (halted(b)) return
    // What a reply left out is asked for once more, with the next ones; then it is missed.
    const retry: PlanItem[] = []
    for (const p of left) {
      if (askedTwice.has(p)) {
        b.missed.push(p.name)
        handled++
      } else {
        askedTwice.add(p)
        retry.push(p)
      }
    }
    queue = [...retry, ...queue]
  }
}

/** Lays out one batch, saving each profile as soon as it has fully arrived. Returns the ones the reply left out. */
async function layOutBatch(b: Build, kind: EntryKind, batch: PlanItem[], onHandled: () => void): Promise<PlanItem[]> {
  const choice = b.ctx.model.choice
  const system = batchSystem(kind)
  const world = worldFor(b, kind)
  const plan = planText(b.plan)
  const fixed = estimateTokens(system + world.text + plan) + 60 * batch.length + 120
  const about = textAbout(
    b.summary,
    batch.flatMap((p) => namesOf(p)),
    summaryRoom(choice, JOB_OF[kind], fixed)
  )
  const messages = chat(system, batchUser(kind, world.text, plan, about, batch))
  const pending = [...batch]
  let taken = new Set<number>()
  const take = (list: Record<string, unknown>[], upTo: number): void => {
    for (let i = 0; i < Math.min(upTo, list.length); i++) {
      if (taken.has(i) || halted(b)) continue
      taken.add(i)
      const profile = readProfile(kind, b.summary, list[i])
      const p = pickFor(kind, profile, i, batch, pending)
      if (!p) continue
      pending.splice(pending.indexOf(p), 1)
      if (hasProfile(profile)) saveProfile(b, p, profile, list[i])
      else b.missed.push(p.name)
      onHandled()
    }
  }
  // While it arrives, every profile but the last is complete.
  const onText = (text: string): void => {
    const list = replyItems(parsePartial(text).value)
    take(list, list.length - 1)
  }
  let done = await ask(b, JOB_OF[kind], messages, { onText, entries: world.entries })
  if (!done) return pending
  let got = readReply(done)
  let list = replyItems(got.value)
  take(list, got.complete ? list.length : list.length - 1)
  if (!taken.size && !halted(b)) {
    done = await ask(b, JOB_OF[kind], again(messages, done.text, got.why ?? 'it had no profiles in it', SHAPES.batch(kind)), {
      entries: world.entries
    })
    if (!done) return pending
    taken = new Set()
    got = readReply(done)
    list = replyItems(got.value)
    take(list, got.complete ? list.length : list.length - 1)
  }
  return pending
}

/** Which of the batch a profile in the reply is: by its name, or by its place in the list when it has none. Null for one not asked for. */
function pickFor(kind: EntryKind, profile: Profile, index: number, batch: PlanItem[], pending: PlanItem[]): PlanItem | null {
  const name = profile.values.name?.trim() ?? ''
  if (!name) {
    const at = batch[index]
    return at && pending.includes(at) ? at : null
  }
  const hit = findMatch(
    { kind, name, aliases: splitAliases(profile.values.aliases ?? '') },
    pending.map((p, i) => ({ id: String(i), kind, name: p.name, aliases: p.aliases }))
  )
  return hit ? pending[Number(hit.id)] : null
}

// ---------- Relationships ----------

/** The live entries of a kind this build made or found named in the summary. */
function inBuild(b: Build, kind: EntryKind): Named[] {
  const ids = new Set<ID>([...b.writer.made.flatMap((m) => (m.kind === kind && m.entryId ? [m.entryId] : [])), ...b.found.keys()])
  return entryNames(b.ctx.db).filter((e) => e.kind === kind && ids.has(e.id))
}

/** True when the world already has a relationship between the two, either way round. */
export function related(db: DB, a: ID, c: ID): boolean {
  return mem.changesForEntry(db, a).some((x) => {
    if (x.kind === 'relationship') return (x.entryId === a && x.payload.otherId === c) || (x.entryId === c && x.payload.otherId === a)
    if (x.kind === 'full') {
      const other = x.entryId === a ? c : x.entryId === c ? a : null
      return !!other && x.payload.relationships.some((r) => r.otherId === other)
    }
    return false
  })
}

async function relationships(b: Build): Promise<void> {
  const people = inBuild(b, 'character')
  const groups = inBuild(b, 'group')
  const made = new Set(b.writer.made.flatMap((m) => (m.entryId ? [m.entryId] : [])))
  // Only worth asking when the build made at least one of the two sides.
  if (![...people, ...groups].some((e) => made.has(e.id)) || people.length + groups.length < 2 || !people.length) return
  setStep(b, 'relationships', 'Working out relationships')
  const choice = b.ctx.model.choice
  const system = relationshipsSystem()
  const all = [...people, ...groups]
  const fixed = estimateTokens(system + all.map((e) => e.name).join('; ')) + 120
  const about = textAbout(
    b.summary,
    all.flatMap((e) => [e.name, ...e.aliases]),
    summaryRoom(choice, 'relationships', fixed)
  )
  const messages = chat(
    system,
    relationshipsUser(
      about,
      people.map((e) => e.name),
      groups.map((e) => e.name)
    )
  )
  let done = await ask(b, 'relationships', messages)
  if (!done) return
  let got = readReply(done)
  if (!isObject(got.value) && !Array.isArray(got.value)) {
    done = await ask(b, 'relationships', again(messages, done.text, got.why ?? 'it had no list of relationships', SHAPES.relationships))
    if (!done) return
    got = readReply(done)
  }
  const db = b.ctx.db
  for (const r of relationshipItems(got.value)) {
    if (halted(b)) return
    let from = findMatch({ kind: 'character', name: r.from, aliases: [] }, all)
    let to = findMatch({ kind: 'character', name: r.to, aliases: [] }, all)
    if (!from || !to || from.id === to.id) continue
    if (from.kind === 'group' && to.kind === 'character') [from, to] = [to, from]
    if (from.kind !== 'character') continue
    if (entryState(db, from.id) !== 'live' || entryState(db, to.id) !== 'live' || related(db, from.id, to.id)) continue
    const source = sourceOf(b, relationshipFingerprint(from.name, to.name), sentencesNamingAll(b.summary, [namesOf(from), namesOf(to)]))
    if (b.blocked.has(blockedKey(source))) continue
    const twoPeople = to.kind === 'character'
    saveRelationship(b.writer, {
      from,
      to,
      type: r.type || (twoPeople ? 'knows' : 'member'),
      feels: twoPeople ? r.feels : '',
      otherFeels: twoPeople ? r.otherFeels : '',
      source
    })
    saved(b, [from.id, to.id])
  }
}

// ---------- Themes and tone ----------

async function themesAndTone(b: Build): Promise<void> {
  const db = b.ctx.db
  const source = (key: 'themes' | 'tone'): Source => sourceOf(b, `world-build:${key}`, [])
  const want = (['themes', 'tone'] as const).filter((k) => !(repo.getMeta(db, k) ?? '').trim() && !b.blocked.has(blockedKey(source(k))))
  if (!want.length) return
  setStep(b, 'themes', want.length === 2 ? "Setting the world's themes and tone" : `Setting the world's ${want[0]}`)
  const system = themesSystem([...want])
  const about = textAbout(b.summary, [], summaryRoom(b.ctx.model.choice, 'themes', estimateTokens(system) + 60))
  const messages = chat(system, themesUser(about))
  let done = await ask(b, 'themes', messages)
  if (!done) return
  let found = themesReply(readReply(done).value)
  if (!want.some((k) => found[k])) {
    done = await ask(b, 'themes', again(messages, done.text, 'it had nothing for the themes or tone', SHAPES.themes))
    if (!done) return
    found = themesReply(readReply(done).value)
  }
  for (const k of want) {
    if (halted(b)) return
    if (saveMeta(b.writer, k, found[k], source(k))) saved(b, [])
  }
}

// ---------- Where the summary disagrees with the world ----------

/** The most of the pages told to the check. */
const PAGES_TOKENS = 3000

async function check(b: Build): Promise<void> {
  const db = b.ctx.db
  const pages = repo
    .getEntries(db, [...b.found.keys()])
    .map((e) => ({ e, values: valuesOf(asProfileKind(e.kind), e) }))
    .filter((p) => Object.entries(p.values).some(([k, v]) => k !== 'name' && k !== 'aliases' && v.trim()))
  if (!pages.length) return
  setStep(b, 'checking', 'Checking your summary against the world')
  const texts: string[] = []
  let used = 0
  for (const p of pages) {
    const t = pageText(p.e, p.values)
    if (texts.length && used + estimateTokens(t) > PAGES_TOKENS) break
    texts.push(t)
    used += estimateTokens(t)
  }
  const system = checkSystem()
  const about = textAbout(
    b.summary,
    pages.flatMap((p) => [p.e.name, ...p.e.aliases]),
    summaryRoom(b.ctx.model.choice, 'check', estimateTokens(system) + used + 80)
  )
  const done = await ask(b, 'check', chat(system, checkUser(texts, about)))
  if (!done) return
  for (const c of conflictItems(readReply(done).value)) {
    if (halted(b)) return
    raiseConflict(
      b,
      pages.map((p) => p.e),
      c
    )
  }
}

/** A disagreement the check found: a consistency issue (nothing on the page changes), listed on the results page. */
function raiseConflict(b: Build, pages: ReturnType<typeof repo.getEntries>, c: ConflictReply): void {
  const hit = findMatch(
    { kind: 'character', name: c.name, aliases: [] },
    pages.map((e) => ({ id: e.id, kind: e.kind, name: e.name, aliases: e.aliases }))
  )
  const e = hit ? pages.find((x) => x.id === hit.id) : undefined
  if (!e) return
  const keys = Object.keys(valuesOf(asProfileKind(e.kind), e))
  const want = c.field.trim().toLowerCase()
  const field = keys.find((k) => k.toLowerCase() === want) ?? keys.find((k) => fieldLabel(e, k).toLowerCase() === want)
  if (!field || field === 'name') return
  const memory = fieldValue(e, field)
  const says = c.says.trim()
  if (!memory.trim() || !says || plain(memory).includes(plain(says))) return
  if (b.conflicts.some((x) => x.entryId === e.id && x.field === field)) return
  const quote =
    (c.quote && findQuote(b.summary, c.quote) ? c.quote.trim() : '') ||
    sentencesNaming(b.summary, [e.name, ...e.aliases]).find((s) => plain(s).includes(plain(says))) ||
    ''
  const message = `${e.name}: your summary says ${fieldLabel(e, field).toLowerCase()} is “${clip(says, 30)}”, but the page says “${clip(memory, 30)}”.`
  kdb.raiseIssue(b.ctx.db, {
    sceneId: '',
    storyId: b.storyId ?? '',
    kind: 'fact',
    severity: 'warning',
    quote: clip(quote, 80),
    message,
    key: `summary:${e.id}:${field}:${plain(says)}`,
    payload: { entryId: e.id, field, memory, text: says, from: 'summary' }
  })
  b.conflicts.push({ entryId: e.id, kind: e.kind, name: e.name, field, message })
}
