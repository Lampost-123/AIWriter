// Check runs for the open world (milestone 5, AI checks): a scene, a chapter or a whole story checked on
// request, and the facts, knowledge and timeline checks that marking a scene done starts in the background.
// - One run at a time; the rest wait their turn. Adam can have one run of his own waiting or running at a
//   time (a second is refused in plain words); a scene marked done again while its check waits isn't
//   queued twice.
// - Each non-empty scene is checked in story order (run.ts). Before each, the memory catches up with the
//   scenes before it on the line, and with the scene's own queued read, as drafting does.
// - Checking a story ends by comparing it across stories (stories.ts) when it is a side story or a prequel.
// - Every run says how it goes ('checks:progress') and how it ended ('checks:done'); Stop keeps what was
//   found; closing the world stops everything at once and writes nothing more.
// No Electron imports: the window, the settings and the memory keeper come in through RunDeps.

import type Database from 'better-sqlite3'
import type { CheckDone, CheckKind, CheckProgress, CheckStart, CheckTarget } from '@shared/contracts/checks'
import { ALL_CHECKS, DONE_CHECKS } from '@shared/contracts/checks'
import type { ID, WritingPrefs } from '@shared/types'
import type { JobModel } from '../ai/jobModel'
import { stopTask, type Emit } from '../ai/tasks'
import { labeler } from '../memory/line'
import { loadShape } from '../memory/scene'
import type { WorldShape } from '../memory/types'
import { newId, UserError } from '../util'
import { checkScene, type CheckOptions } from './run'
import { compareStories, storyComparisons } from './stories'

type DB = Database.Database

export interface RunDeps {
  /** The consistency check model now, or a plain-words UserError saying what to set up. */
  model: () => JobModel
  prefs: () => WritingPrefs
  emit: Emit
  /** Brings the memory up to date for the scene (earlier scenes on its line, and its own queued read). */
  beforeScene?: (db: DB, sceneId: ID) => Promise<void>
  onKeyRejected?: (model: JobModel) => void
  fetchImpl?: typeof fetch
  retryDelays?: number[]
}

interface Run {
  id: ID
  db: DB
  target: CheckTarget
  checks: CheckKind[]
  /** Started by marking a scene done: quiet (nothing said if it can't run). */
  background: boolean
  sceneIds: ID[]
  labels: Map<ID, string>
  /** For a story: what it is compared with at the end. */
  stopped: boolean
  closed: boolean
  taskId: ID | null
  started: boolean
  finished: boolean
  done: Promise<void>
  resolve: () => void
}

let deps: RunDeps | null = null
let active: Run | null = null
const waiting: Run[] = []
let pumping = false

export function setRunDeps(d: RunDeps | null): void {
  deps = d
}

/** The live scenes with words in them that a target covers, in story order, with their places in plain words. */
export function scenesFor(db: DB, shape: WorldShape, target: CheckTarget): { ids: ID[]; labels: Map<ID, string> } {
  const label = labeler(shape)
  const all: { id: ID; storyId: ID; chapterId: ID }[] = []
  for (const s of shape.stories) for (const c of s.chapters) for (const sc of c.scenes) all.push({ id: sc.id, storyId: s.id, chapterId: c.id })
  const picked =
    target.scope === 'scene'
      ? all.filter((x) => x.id === target.id)
      : target.scope === 'chapter'
        ? all.filter((x) => x.chapterId === target.id)
        : all.filter((x) => x.storyId === target.id)
  const words = new Set(
    picked.length
      ? (
          db
            .prepare(`SELECT id FROM scenes WHERE id IN (${picked.map(() => '?').join(',')}) AND trim(text) <> ''`)
            .all(...picked.map((x) => x.id)) as { id: ID }[]
        ).map((r) => r.id)
      : []
  )
  const ids = picked.filter((x) => words.has(x.id)).map((x) => x.id)
  return { ids, labels: new Map(picked.map((x) => [x.id, label({ storyId: x.storyId, sceneId: x.id })])) }
}

/** What a target is called, for "already running" and progress. */
function targetWords(shape: WorldShape, target: CheckTarget, labels: Map<ID, string>): string {
  if (target.scope === 'scene') return labels.get(target.id) ?? 'this scene'
  if (target.scope === 'story') return shape.stories.find((s) => s.id === target.id)?.title || 'this story'
  for (const s of shape.stories) {
    const i = s.chapters.findIndex((c) => c.id === target.id)
    if (i >= 0) return `${s.title}, Ch ${i + 1}`
  }
  return 'this chapter'
}

const NOTHING: Record<CheckTarget['scope'], string> = {
  scene: 'This scene has no words to check yet.',
  chapter: 'No scene in this chapter has words to check yet.',
  story: 'No scene in this story has words to check yet.'
}

const cleanChecks = (checks: unknown): CheckKind[] => {
  const list = Array.isArray(checks) ? ALL_CHECKS.filter((c) => checks.includes(c)) : []
  return list.length ? list : [...ALL_CHECKS]
}

function newRun(db: DB, input: CheckStart, background: boolean, ids: ID[], labels: Map<ID, string>): Run {
  let resolve!: () => void
  const done = new Promise<void>((r) => (resolve = r))
  return {
    id: input.runId,
    db,
    target: input.target,
    checks: cleanChecks(input.checks),
    background,
    sceneIds: ids,
    labels,
    stopped: false,
    closed: false,
    taskId: null,
    started: false,
    finished: false,
    done,
    resolve
  }
}

/**
 * Starts a check Adam asked for (it waits its turn behind a check already running). Refuses, in plain
 * words, when no model is set up, when there is nothing to check, or when another of his is under way.
 */
export function startCheck(db: DB, input: CheckStart): void {
  if (!deps) throw new UserError('The consistency checker isn’t ready yet. Try again in a moment.')
  if (!input?.runId || !input.target?.id || !['scene', 'chapter', 'story'].includes(input.target.scope)) {
    throw new UserError('Something went wrong starting the check. Try again.')
  }
  deps.model() // a plain-words UserError when there is no model to use
  const mine = [active, ...waiting].find((r) => r && !r.background && !r.finished && r.db === db)
  const shape = loadShape(db)
  if (mine) {
    throw new UserError(`${upper(targetWords(shape, mine.target, mine.labels))} is being checked already. Wait for it to finish, or stop it first.`)
  }
  const { ids, labels } = scenesFor(db, shape, input.target)
  if (!ids.length && !(input.target.scope === 'story' && storyComparisons(shape, input.target.id).length)) {
    throw new UserError(NOTHING[input.target.scope])
  }
  enqueue(newRun(db, input, false, ids, labels))
}

const upper = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s)

/**
 * Marking a scene done checks its facts, knowledge and timeline in the background. Never slows marking
 * done or says anything: with no model set up, or no words in the scene, nothing happens.
 */
export function checkWhenDone(db: DB, sceneId: ID): ID | null {
  if (!deps) return null
  try {
    deps.model()
  } catch {
    return null
  }
  // Already waiting for its turn: that check will read the scene as it is then.
  if (waiting.some((r) => r.background && r.db === db && r.target.id === sceneId)) return null
  try {
    const target: CheckTarget = { scope: 'scene', id: sceneId }
    const { ids, labels } = scenesFor(db, loadShape(db), target)
    if (!ids.length) return null
    const run = newRun(db, { runId: `done:${sceneId}:${newId()}`, target, checks: DONE_CHECKS }, true, ids, labels)
    enqueue(run)
    return run.id
  } catch (e) {
    console.warn('Could not start the checks for a scene marked done', e)
    return null
  }
}

/** Stops a run (what it found is kept). Resolves once it has stopped. */
export async function stopCheck(runId: ID): Promise<void> {
  const queued = waiting.findIndex((r) => r.id === runId)
  if (queued >= 0) {
    const [r] = waiting.splice(queued, 1)
    r.stopped = true
    finish(r, 'stopped', null, 0)
    return
  }
  const r = active
  if (!r || r.id !== runId || r.finished) return
  r.stopped = true
  if (r.taskId) await stopTask(r.taskId).catch(() => undefined)
  await r.done
}

/** The world is closing: its runs stop now, and nothing more is written. */
export function closeRunsFor(db: DB): void {
  for (const r of waiting.filter((x) => x.db === db)) {
    r.stopped = r.closed = true
    finish(r, 'stopped', null, 0)
  }
  for (let i = waiting.length - 1; i >= 0; i--) if (waiting[i].db === db) waiting.splice(i, 1)
  if (active && active.db === db) {
    active.stopped = active.closed = true
    if (active.taskId) void stopTask(active.taskId).catch(() => undefined)
  }
}

/** The runs going or waiting (for tests). */
export const runsNow = (): { active: ID | null; waiting: ID[] } => ({ active: active?.id ?? null, waiting: waiting.map((r) => r.id) })

/** For tests: forget every run. */
export function resetRunsForTests(): void {
  active = null
  waiting.length = 0
  pumping = false
}

function enqueue(r: Run): void {
  waiting.push(r)
  // Said straight away, so the window shows "Checking…" while it waits its turn.
  progress(r, 0, r.sceneIds[0] ?? null)
  void pump()
}

function progress(r: Run, done: number, current: ID | null, words?: string): void {
  if (r.closed) return
  const p: CheckProgress = {
    runId: r.id,
    target: r.target,
    done,
    total: r.sceneIds.length,
    current: words ?? (current ? (r.labels.get(current) ?? null) : null),
    sceneIds: r.sceneIds,
    currentSceneId: current
  }
  deps?.emit('checks:progress', p)
}

function finish(r: Run, status: CheckDone['status'], error: string | null, found: number): void {
  if (r.finished) return
  r.finished = true
  if (!r.closed) deps?.emit('checks:done', { runId: r.id, target: r.target, status, error, found, background: r.background })
  r.resolve()
}

async function pump(): Promise<void> {
  if (pumping) return
  pumping = true
  try {
    while (waiting.length) {
      const r = waiting.shift()!
      active = r
      try {
        await go(r)
      } catch (e) {
        console.error('A consistency check stopped unexpectedly', e)
        finish(r, r.stopped ? 'stopped' : 'error', r.stopped ? null : 'Something went wrong while checking. Try again.', 0)
      }
      active = null
    }
  } finally {
    pumping = false
  }
}

async function go(r: Run): Promise<void> {
  if (!deps) return finish(r, 'stopped', null, 0)
  r.started = true
  let model: JobModel
  try {
    model = deps.model()
  } catch (e) {
    return finish(r, 'error', e instanceof UserError ? e.message : 'Something went wrong starting the check. Try again.', 0)
  }
  const d = deps
  const o: CheckOptions = {
    db: r.db,
    model,
    prefs: d.prefs(),
    stopped: () => r.stopped || !r.db.open,
    closed: () => r.closed || !r.db.open,
    onTask: (id) => (r.taskId = id),
    onKeyRejected: () => d.onKeyRejected?.(model),
    fetchImpl: d.fetchImpl,
    retryDelays: d.retryDelays
  }
  let found = 0
  let n = 0
  for (const sceneId of r.sceneIds) {
    if (o.stopped()) return finish(r, 'stopped', null, found)
    progress(r, n, sceneId)
    if (d.beforeScene) {
      try {
        await d.beforeScene(r.db, sceneId)
      } catch (e) {
        console.warn('The memory could not catch up before a check; checking with what it has', e)
      }
    }
    if (o.stopped()) return finish(r, 'stopped', null, found)
    const out = await checkScene(o, sceneId, r.checks)
    if (out.status !== 'empty') found += out.found
    if (out.status === 'stopped') return finish(r, 'stopped', null, found)
    if (out.status === 'error') return finish(r, 'error', out.error, found)
    n++
  }
  progress(r, n, null)
  if (r.target.scope === 'story' && r.db.open) {
    const shape = loadShape(r.db)
    for (const c of storyComparisons(shape, r.target.id)) {
      if (o.stopped()) return finish(r, 'stopped', null, found)
      const other = shape.stories.find((s) => s.id === c.otherId)?.title ?? 'the other story'
      progress(r, n, null, c.kind === 'side' ? `Comparing with ${other}` : `Comparing the ending with how ${other} begins`)
      const out = await compareStories(o, c)
      found += out.found
      if (out.status === 'stopped') return finish(r, 'stopped', null, found)
      if (out.status === 'error') return finish(r, 'error', out.error, found)
    }
  }
  finish(r, 'complete', null, found)
}
