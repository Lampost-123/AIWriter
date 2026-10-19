// What the outline helper holds while the app is open, one for each story in each world: how much to
// suggest, the suggestions as they arrived and what Adam decided about each (kept, discarded, his own
// words). A request keeps going when he leaves the page, so coming back shows it with Stop, never an
// empty page inviting him to ask twice. The page itself (OutlineHelper.tsx) is drawn from this.
//
// Keep and Discard are undone from a toast. Several in a row share one toast ("Added 2 chapters and
// 6 scenes to the story."), so an earlier Undo is never pushed away and one Undo takes them all back.
//
// A chapter's interview (planInterviewStore.ts) plans one chapter on the same page, with a session of
// its own for that chapter (`chapterId`): its run's reply has no chapter heading, so `lead` gives it the
// chapter's, and that chapter node starts out kept (it is the chapter itself), so its scene cards are
// kept into it one by one exactly as the outline's are.
//
// Suggest again (2026-10-19, after "the only way back is an Undo that goes at the first Keep"): the new suggestions
// come in at the top, and the ones Adam hadn't decided on stay, as they were, under "Earlier suggestions" (`earlier`),
// to keep, change or discard just the same, until he keeps them or puts them away. Nothing he hasn't decided on goes
// without his say. Each batch is its own run, found by its task id, so every Keep, Discard and Undo works on either.
//
// The outline in stages (2026-10-19, stages.ts): the first request asks only for the acts (or, with no new acts, the
// chapters); "Plan its chapters" on an act and "Plan its scenes" on a chapter ask for just that part (`stage`), which
// arrives under it and then goes into the suggestions' text there, so every other suggestion keeps its key. Keep can go
// where Adam chooses in the binder (KeepOptions.place), and its toast says when it starts building the story's cast.
import { create } from 'zustand'
import type { KeptItem, OutlineSize, PlanAnswer } from '@shared/contracts/outline'
import type { TaskDone } from '@shared/contracts/tasks'
import type { ID } from '@shared/types'
import { toast, useToasts } from '@/components/ui'
import { api, ApiError, onEvent } from '@/lib/api'
import { editorBridge } from '@/lib/editorBridge'
import { useApp } from '@/lib/store'
import { neighbourAfterRemoval, readingOrder } from '@/features/binder/outlineModel'
import { useOutlineStore } from '@/features/binder/outlineStore'
import { notifyChapterCard } from '@/features/chapterCard/chapterCardEvents'
import { buildStoryWorldSoon } from '@/features/worldBuilder/storyBuild'
import { parseOutline } from './parse'
import { nodeText } from './outlineText'
import { carryRevision, type RevisionTrail } from './revision'
import { chaptersFor, isUnder, markArriving, planSoFar, spliceStage, stageParts, type PlanMode, type StageLevel } from './stages'
import {
  countKinds,
  describeCounts,
  discardedMessage,
  discardKeys,
  findNode,
  goneIds,
  keepPlan,
  keptMessage,
  madePagesNote,
  placedEventsNote,
  outlineTree,
  placeKeep,
  withDiscarded,
  withKept,
  withoutDiscarded,
  withoutGone,
  withoutKept,
  type Decisions,
  type Edits,
  type KeepPlace,
  type NodeEdit,
  type TreeNode
} from './tree'

export interface Problem {
  message: string
  code?: string
}

/**
 * One stage asked for under a suggestion (the outline in stages): an act's chapters or a chapter's scenes. While it
 * arrives it shows under that act or chapter; once it ends with anything to read it goes into the run's text there.
 */
export interface HelperStage {
  taskId: ID
  generationId: ID | null
  /** The act or chapter it plans inside, by its key in the run. */
  key: string
  level: StageLevel
  /** The reply so far. */
  text: string
  status: 'running' | 'complete' | 'stopped' | 'error'
  cutOff: boolean
  retrying: string | null
  error: string | null
  /** How many parts the act or chapter held when it was asked for. */
  before: number
  /** Its parts are in the run's text now (how many: `count`). */
  merged: boolean
  count: number
}

/** One request for an outline and what came of it. */
export interface HelperRun {
  taskId: ID
  generationId: ID | null
  /** The reply so far. */
  text: string
  status: 'running' | 'complete' | 'stopped' | 'error'
  /** The reply reached its length limit, so it stops before the end. */
  cutOff: boolean
  /** Plain words while a busy service is being tried again. */
  retrying: string | null
  /** What was asked for. */
  size: OutlineSize
  decisions: Decisions
  edits: Edits
  /** A chapter's plan: the chapter's heading, read before the reply (which has none). */
  lead?: string
  /** When it was asked for (ms), for naming it among the earlier suggestions. */
  at?: number
  /** The last stage asked for under one of its acts or chapters (the outline in stages), while it arrives and after. */
  stage?: HelperStage | null
}

/** A request is arriving: the run itself, or a stage under one of its suggestions. */
export const runBusy = (run: HelperRun | null | undefined): boolean => !!run && (run.status === 'running' || run.stage?.status === 'running')

export interface HelperSession {
  /** How much to suggest; null until Adam picks (the page then suggests a size that suits the story). */
  size: OutlineSize | null
  /** The newest suggestions. */
  run: HelperRun | null
  /**
   * Earlier suggestions, newest first: each batch there was when Adam suggested again, as he left it (shown while it
   * has anything still to decide). Never asked for again, so never running.
   */
  earlier: HelperRun[]
  problem: Problem | null
  /** What was kept but has since been deleted from the story (in the binder): it waits for a decision again. */
  gone: ID[]
  /**
   * The story has nothing planned or written yet, so the AI plans it from the premise, as the page says.
   * The main process decides, by the rule it uses for what the AI is told (api.outlineBlank). Null until known.
   */
  blank: boolean | null
  /** How to plan: in stages or all at once; null until Adam picks (the page then picks by the story's length, stages.ts defaultMode). */
  mode?: PlanMode | null
}

const fresh = (): HelperSession => ({ size: null, run: null, earlier: [], problem: null, gone: [], blank: null, mode: null })

/** The decisions as the page shows them and its buttons go by: the run's, less what has left the story since. */
export const decisionsOf = (s: HelperSession, run: HelperRun | null = s.run): Decisions => (run ? withoutGone(run.decisions, s.gone) : {})

/** The run as the page shows it: its decisions less what has left the story since. */
export const shownRun = (s: HelperSession, run: HelperRun): HelperRun =>
  s.gone.length ? { ...run, decisions: withoutGone(run.decisions, s.gone) } : run

/** The session's run with this task id (an earlier batch's), or its newest when none is given. */
function runIn(s: HelperSession, taskId?: ID | null): HelperRun | null {
  if (!taskId || s.run?.taskId === taskId) return s.run
  return (s.earlier ?? []).find((r) => r.taskId === taskId) ?? null
}

/** Every batch of the session: the newest, then the earlier ones. */
const allRuns = (s: HelperSession): HelperRun[] => [...(s.run ? [s.run] : []), ...(s.earlier ?? [])]

export const useOutlineHelper = create<{ sessions: Record<string, HelperSession> }>(() => ({ sessions: {} }))

/** The session's key: the story, in the world that is open. */
export const helperKey = (worldId: ID | null | undefined, storyId: ID): string => `${worldId ?? ''}:${storyId}`
/** The session's key for a chapter's plan: the story's, then the chapter. */
export const chapterHelperKey = (worldId: ID | null | undefined, storyId: ID, chapterId: ID): string =>
  `${helperKey(worldId, storyId)}#${chapterId}`
const keyOf = (storyId: ID, chapterId?: ID | null): string =>
  chapterId ? chapterHelperKey(useApp.getState().world?.id, storyId, chapterId) : helperKey(useApp.getState().world?.id, storyId)
/** The story and the chapter (null for the story's own session) a key is for, after the world's prefix. */
const partsOf = (rest: string): { storyId: ID; chapterId: ID | null } => {
  const at = rest.indexOf('#')
  return at < 0 ? { storyId: rest, chapterId: null } : { storyId: rest.slice(0, at), chapterId: rest.slice(at + 1) }
}

const get = (key: string): HelperSession => useOutlineHelper.getState().sessions[key] ?? fresh()
const put = (key: string, patch: Partial<HelperSession>): void =>
  useOutlineHelper.setState((st) => ({ sessions: { ...st.sessions, [key]: { ...(st.sessions[key] ?? fresh()), ...patch } } }))

/**
 * Changes the run with this task id, the newest or an earlier batch (a newer request leaves an older one's events alone,
 * and a Keep's or Discard's Undo still finds its suggestions once they are among the earlier ones).
 */
function patchRun(key: string, taskId: ID, patch: Partial<HelperRun> | ((r: HelperRun) => Partial<HelperRun>)): boolean {
  const s = get(key)
  const next = (r: HelperRun): HelperRun => ({ ...r, ...(typeof patch === 'function' ? patch(r) : patch) })
  if (s.run?.taskId === taskId) {
    put(key, { run: next(s.run) })
    return true
  }
  const at = (s.earlier ?? []).findIndex((r) => r.taskId === taskId)
  if (at < 0) return false
  put(key, { earlier: s.earlier.map((r, i) => (i === at ? next(r) : r)) })
  return true
}

function findTask(taskId: ID): string | null {
  for (const [key, s] of Object.entries(useOutlineHelper.getState().sessions)) if (s.run?.taskId === taskId) return key
  return null
}

/** The session and run whose stage this task is (only the newest suggestions plan in stages). */
function findStage(taskId: ID): { key: string; runId: ID } | null {
  for (const [key, s] of Object.entries(useOutlineHelper.getState().sessions)) if (s.run?.stage?.taskId === taskId) return { key, runId: s.run.taskId }
  return null
}

/** A stage's reply ended: what it brought goes into the run's text under its act or chapter (see HelperStage). */
function settleStage(key: string, runId: ID, d: Pick<TaskDone, 'taskId' | 'text' | 'generationId' | 'status' | 'cutOff' | 'error'>): void {
  patchRun(key, runId, (r) => {
    const st = r.stage
    if (!st || st.taskId !== d.taskId || st.status !== 'running') return {}
    const ended: HelperStage = {
      ...st,
      text: d.text,
      generationId: d.generationId ?? st.generationId,
      status: d.status,
      cutOff: d.cutOff,
      retrying: null,
      error: d.status === 'error' ? (d.error ?? 'Something went wrong while that part was planned. Please try again.') : null
    }
    const count = stageParts(d.text, st.level, true).length
    const joined = count ? spliceStage(r.text, st.key, st.level, d.text, true) : null
    return joined ? { text: joined, stage: { ...ended, merged: true, count } } : { stage: ended }
  })
}

let listening = false
/** Follows outline requests for as long as the window is open, whichever page is showing. */
function listen(): void {
  if (listening) return
  listening = true
  onEvent('task:progress', (p) => {
    if (p.job !== 'outline') return
    const key = findTask(p.taskId)
    if (key) return void patchRun(key, p.taskId, { text: p.text, generationId: p.generationId, retrying: null })
    const stage = findStage(p.taskId)
    if (stage)
      patchRun(stage.key, stage.runId, (r) =>
        r.stage?.taskId === p.taskId && r.stage.status === 'running' ? { stage: { ...r.stage, text: p.text, generationId: p.generationId, retrying: null } } : {}
      )
  })
  onEvent('task:retrying', (p) => {
    const key = findTask(p.taskId)
    if (key) return void patchRun(key, p.taskId, { retrying: p.reason })
    const stage = findStage(p.taskId)
    if (stage) patchRun(stage.key, stage.runId, (r) => (r.stage?.taskId === p.taskId ? { stage: { ...r.stage, retrying: p.reason } } : {}))
  })
  onEvent('task:done', (d) => {
    if (d.job !== 'outline') return
    const stage = findStage(d.taskId)
    if (stage) return settleStage(stage.key, stage.runId, d)
    const key = findTask(d.taskId)
    if (!key) return
    patchRun(key, d.taskId, { text: d.text, generationId: d.generationId, status: d.status, cutOff: d.cutOff, retrying: null })
    if (d.status === 'error')
      put(key, { problem: { message: d.error ?? 'Something went wrong while the outline was suggested. Please try again.' } })
  })
  // Whenever the story changes (a delete in the binder, its Undo, words written), the page showing asks
  // again whether the story has anything planned yet, and looks for what was kept, so it never says
  // "Kept" for something the story no longer has. So does a Keep's toast, wherever Adam is, so its Undo
  // never takes back what has gone. Other stories' pages ask when they next open (see checkBlank), so
  // typing in a scene, which saves every few seconds, asks nothing for them.
  useApp.subscribe((now, before) => {
    if (now.outlineRev === before.outlineRev) return
    const prefix = helperKey(now.world?.id, '')
    const view =
      now.view.kind === 'outline' ? now.view : now.view.kind === 'storyBuilder' ? { storyId: now.view.storyId, chapterId: undefined as ID | undefined } : null
    for (const [key, s] of Object.entries(useOutlineHelper.getState().sessions)) {
      if (!key.startsWith(prefix)) continue
      const { storyId, chapterId } = partsOf(key.slice(prefix.length))
      const showing = !!view && view.storyId === storyId && (view.chapterId ?? null) === chapterId
      const toastShows = keepBatch?.key === key && liveToast(keepBatch.toastId)
      if ((showing || toastShows) && (s.gone.length || allRuns(s).some(hasKept))) void checkKept(storyId, chapterId)
      // A chapter's plan doesn't ask whether the story is blank.
      if (chapterId) continue
      if (showing) {
        void checkBlank(storyId)
      } else {
        // Not known now, and an answer on its way is out of date: the page asks when it opens.
        blankChecks.set(key, (blankChecks.get(key) ?? 0) + 1)
        if (s.blank !== null) put(key, { blank: null })
      }
    }
  })
}

/** How many asks each session has started, so only the latest one's answer counts. */
const blankChecks = new Map<string, number>()

/**
 * Asks whether the story has anything planned or written yet (see HelperSession.blank). When that isn't
 * known (the page draws nothing until it is), what was kept is looked for too, so the page's first frame
 * never shows "Kept" for something deleted from the story while it wasn't showing.
 */
export async function checkBlank(storyId: ID): Promise<void> {
  listen()
  const key = keyOf(storyId)
  const turn = (blankChecks.get(key) ?? 0) + 1
  blankChecks.set(key, turn)
  const looking = get(key).blank === null ? checkKept(storyId) : null
  let blank: boolean
  try {
    blank = await api.outlineBlank(storyId)
  } catch {
    // The story may have gone (the page says so); otherwise the page carries on from what it knew.
    blank = get(key).blank ?? false
  }
  await looking
  if (blankChecks.get(key) === turn && get(key).blank !== blank) put(key, { blank })
}

const hasKept = (run: HelperRun | null): boolean => !!run && Object.values(run.decisions).some((d) => d.status === 'kept')
/** How many looks each session has started, so only the latest one's answer counts. */
const checks = new Map<string, number>()

/**
 * Looks at what the story has now, so anything kept that has been deleted since waits for a decision
 * again (and keeping it makes it anew). Only what was kept before it looked is judged, so something kept
 * while it looked is never taken for gone.
 */
export async function checkKept(storyId: ID, chapterId?: ID | null): Promise<void> {
  const key = keyOf(storyId, chapterId)
  const runs = allRuns(get(key))
  if (!runs.length || (!runs.some(hasKept) && !get(key).gone.length)) return
  // What every batch had kept when it looked (ids are the story's, so one list serves them all).
  const decisions: Decisions = Object.fromEntries(runs.flatMap((r, i) => Object.entries(r.decisions).map(([k, d]) => [`${i}:${k}`, d])))
  const turn = (checks.get(key) ?? 0) + 1
  checks.set(key, turn)
  let present: Set<ID>
  try {
    const o = await api.getOutline(storyId)
    present = new Set([...(o.acts ?? []).map((a) => a.id), ...o.chapters.map((c) => c.id), ...o.scenes.map((sc) => sc.id)])
  } catch {
    return
  }
  const now = get(key)
  // A later look knows better.
  if (checks.get(key) !== turn) return
  const gone = goneIds(decisions, present)
  if (gone.length !== now.gone.length || gone.some((id, i) => id !== now.gone[i])) put(key, { gone })
  // The last Keep's toast speaks of what has left the story since: the next Keep gets a toast of its
  // own, and a toast offering to take back only what is gone already goes.
  const batch = keepBatch
  if (batch?.key === key && batch.kept.some((k) => gone.includes(k.id))) {
    if (batch.kept.every((k) => gone.includes(k.id))) useToasts.getState().dismiss(batch.toastId)
    keepBatch = null
  }
}

/** The helper opened for a story: its session as it was, or a new one. */
export function openHelper(storyId: ID): void {
  listen()
  const key = keyOf(storyId)
  if (!useOutlineHelper.getState().sessions[key]) put(key, fresh())
}

export function setHelperSize(storyId: ID, size: OutlineSize): void {
  put(keyOf(storyId), { size })
}

/** In stages or all at once, as Adam picked. */
export function setHelperMode(storyId: ID, mode: PlanMode): void {
  put(keyOf(storyId), { mode })
}

/** The suggestions so far as a tree. A reply that has ended (complete, stopped or failed) counts as whole. */
export function treeOf(run: HelperRun): TreeNode[] {
  // A chapter's plan: a chapter heading the model added anyway is the chapter's own, already in `lead`.
  const text = run.lead ? run.lead + run.text.replace(/^\s*[#*\s]*chapter\b[^\n]*\n/i, '') : run.text
  // A stage still arriving shows under its act or chapter, its last part not complete yet.
  const st = run.stage
  if (st && !st.merged && st.status === 'running' && !run.lead && st.text.trim()) {
    const joined = spliceStage(text, st.key, st.level, st.text, false)
    if (joined) return markArriving(outlineTree(parseOutline(joined, true)), st.key, st.before)
  }
  return outlineTree(parseOutline(text, run.status !== 'running'))
}

// ---------- Suggest ----------

// The toast offering back the suggestions as they were before a talk's revision took their place, while it shows.
let replaced: { toastId: number; key: string; taskId: ID; run: HelperRun } | null = null
const dropReplaced = (): void => {
  if (replaced) useToasts.getState().dismiss(replaced.toastId)
  replaced = null
}

/** At most this many earlier batches are held; the oldest with nothing left to decide go first, never one that has. */
const MOST_EARLIER = 10

/**
 * The earlier batches once `previous` joins them (newest first). Batches with nothing left to decide stay, out of
 * sight, so a Keep's Undo can still open them again; past MOST_EARLIER the oldest of those go.
 */
function withEarlier(s: HelperSession, previous: HelperRun | null): HelperRun[] {
  const list = [...(previous && treeOf(previous).length ? [previous] : []), ...(s.earlier ?? [])]
  let spare = list.length - MOST_EARLIER
  if (spare <= 0) return list
  const out: HelperRun[] = []
  for (let i = list.length - 1; i >= 0; i--) {
    if (spare > 0 && !hasOpen(list[i], s.gone)) {
      spare--
      continue
    }
    out.unshift(list[i])
  }
  return out
}

/** The earlier batches the page shows: those with something still to decide, newest first, as the page shows them. */
export function earlierShown(s: HelperSession): HelperRun[] {
  return (s.earlier ?? []).filter((r) => hasOpen(r, s.gone)).map((r) => shownRun(s, r))
}

/** Says where the suggestions Adam hadn't decided on went, when a new request moves them. */
function noteEarlier(): void {
  toast('Your earlier suggestions are still here, under “Earlier suggestions”.')
}

/**
 * Asks for an outline from the premise as it is in the box. Suggestions still waiting for a decision move under
 * "Earlier suggestions" (see `earlier`). A story with nothing planned yet is
 * planned from its premise alone, so that needs a word or two first (a hint, not a failure: 'no-premise').
 */
export async function suggestOutline(
  storyId: ID,
  premise: string,
  size: OutlineSize,
  o: { premiseOptional?: boolean; mode?: PlanMode } = {}
): Promise<void> {
  const s = get(keyOf(storyId))
  if (runBusy(s.run)) return
  // With a plot in the Story builder, the AI writes the premise from it.
  if (!premise.trim() && s.blank !== false && !o.premiseOptional) {
    put(keyOf(storyId), { problem: { message: 'Write the premise first: a line or two on what the story is about is enough.', code: 'no-premise' } })
    return
  }
  // In stages: only the acts (or, with no new acts, the chapters) come now; each is planned further when Adam asks.
  if (o.mode === 'stages') {
    const level = size.acts > 0 ? 'acts' : 'chapters'
    await suggestOutlineWith(storyId, size, (taskId) =>
      api.startOutlineStage({ taskId, storyId, level, premise, acts: size.acts, chapters: size.chapters })
    )
    return
  }
  await suggestOutlineWith(storyId, size, (taskId) => api.startOutline({ taskId, storyId, premise, size }))
}

/**
 * "Plan its chapters" on an act, "Plan its scenes" on a chapter (the outline in stages): asks for just that part, told
 * the outline as it stands (Adam's changes in) and, for one kept already, where it is in the story. It arrives under it.
 */
export async function planStage(storyId: ID, nodeKey: string): Promise<void> {
  listen()
  const key = keyOf(storyId)
  const s = get(key)
  const run = s.run
  if (!run || runBusy(run) || run.lead) return
  const tree = treeOf(run)
  const node = findNode(tree, nodeKey)
  if (!node || node.kind === 'scene') return
  const decisions = decisionsOf(s, run)
  const level: StageLevel = node.kind === 'act' ? 'chapters' : 'scenes'
  const kept = decisions[nodeKey]?.status === 'kept' ? (decisions[nodeKey] as { id: ID }).id : null
  const taskId = crypto.randomUUID()
  const stage: HelperStage = {
    taskId,
    generationId: null,
    key: nodeKey,
    level,
    text: '',
    status: 'running',
    cutOff: false,
    retrying: null,
    error: null,
    before: node.children.length,
    merged: false,
    count: 0
  }
  dropReplaced()
  patchRun(key, run.taskId, { stage })
  put(key, { problem: null })
  try {
    const { generationId } = await api.startOutlineStage({
      taskId,
      storyId,
      level,
      premise: (useApp.getState().stories ?? []).find((x) => x.id === storyId)?.premise,
      chapters: level === 'chapters' ? chaptersFor(node, run.edits[nodeKey]) : undefined,
      plan: planSoFar(run.text, decisions, run.edits, nodeKey),
      target: nodeText(run.text, nodeKey, run.edits),
      actId: level === 'chapters' ? kept : null,
      chapterId: level === 'scenes' ? kept : null
    })
    patchRun(key, run.taskId, (r) => (r.stage?.taskId === taskId ? { stage: { ...r.stage, generationId: r.stage.generationId ?? generationId } } : {}))
  } catch (e) {
    // Nothing started: it says why, beside the act or chapter.
    patchRun(key, run.taskId, (r) =>
      r.stage?.taskId === taskId ? { stage: { ...r.stage, status: 'error', error: (e as Error).message || 'That didn’t work. Please try again.' } } : {}
    )
  }
}

/**
 * The same, with another way of asking (Story recipes: a new story planned from a recipe). `start` begins the
 * request with the task id given; its answer is read, kept, edited and discarded as the outline helper's is.
 */
export async function suggestOutlineWith(storyId: ID, size: OutlineSize, start: (taskId: ID) => Promise<{ generationId: ID }>): Promise<void> {
  listen()
  const key = keyOf(storyId)
  const s = get(key)
  if (runBusy(s.run)) return
  const taskId = crypto.randomUUID()
  const previous = s.run ? { ...s.run, stage: null } : null
  const wasOpen = !!previous && hasOpen(previous, s.gone)
  dropReplaced()
  put(key, {
    size,
    problem: null,
    earlier: withEarlier(s, previous),
    run: { taskId, generationId: null, text: '', status: 'running', cutOff: false, retrying: null, size, decisions: {}, edits: {}, at: Date.now() }
  })
  try {
    const { generationId } = await start(taskId)
    patchRun(key, taskId, (r) => ({ generationId: r.generationId ?? generationId }))
  } catch (e) {
    if (get(key).run?.taskId !== taskId) return
    // Nothing started: what was on the page stays where it was.
    put(key, { run: previous, earlier: s.earlier, problem: { message: (e as Error).message, code: e instanceof ApiError ? e.code : undefined } })
    return
  }
  if (wasOpen) noteEarlier()
}

/** True while the run has a suggestion still waiting for a decision (what has left the story since counts as waiting). */
export function hasOpen(run: HelperRun, gone: ID[]): boolean {
  const decisions = withoutGone(run.decisions, gone)
  const open = (nodes: TreeNode[]): boolean => nodes.some((n) => !decisions[n.key] || open(n.children))
  return open(treeOf(run))
}

/** The Undo for a talk's revision: the suggestions as they were before it (until one of the new ones is decided on). */
function offerBack(storyId: ID, taskId: ID, run: HelperRun, keptAsWas: string[] = []): void {
  const key = keyOf(storyId)
  const toastId = toast(`Changed the suggestions as you asked.${keptNote(keptAsWas)}`, {
    action: {
      label: 'Undo',
      run: () => {
        const now = get(key).run
        // As it is now: an Undo of one of its keeps since then opens those suggestions again (see undoKeep).
        const back = replaced?.toastId === toastId ? replaced.run : run
        if (replaced?.toastId === toastId) replaced = null
        if (!now || now.taskId !== taskId) return
        if (now.status === 'running') void api.stopTask(taskId).catch(() => undefined)
        put(key, { run: back, problem: null })
        // What it kept may have been deleted from the story since.
        void checkKept(storyId)
      }
    }
  })
  replaced = { toastId, key, taskId, run }
}

/** What a revision's toast adds for kept parts the talk would have changed (they are in the story already). */
function keptNote(titles: string[]): string {
  const named = [...new Set(titles.filter(Boolean))].map((t) => `“${t}”`)
  if (!named.length) return ''
  const list = named.length === 1 ? named[0] : `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`
  return ` ${list} ${named.length === 1 ? 'is' : 'are'} already in the story, so ${named.length === 1 ? 'it wasn’t' : 'they weren’t'} changed here.`
}

/**
 * A first Keep or Discard among a revision's suggestions settles on them: the toast offering back the ones
 * they replaced goes, rather than swapping away what Adam has started deciding on.
 */
function settledOnNew(key: string, taskId: ID): void {
  if (replaced?.key === key && replaced.taskId === taskId) dropReplaced()
}

/**
 * A chapter's plan, from its interview's answers (none: from the chapter and the outline around it).
 * Scene cards still waiting from an earlier plan move under "Earlier suggestions", as on the outline's page.
 */
export async function suggestChapter(storyId: ID, chapterId: ID, title: string, answers: PlanAnswer[]): Promise<void> {
  listen()
  const key = keyOf(storyId, chapterId)
  const s = get(key)
  if (runBusy(s.run)) return
  const taskId = crypto.randomUUID()
  const lead = `## Chapter: ${title.replace(/\s+/g, ' ').trim() || 'This chapter'}\n`
  // The chapter itself is kept from the start: its scene cards go into it.
  const chapterKey = outlineTree(parseOutline(lead, false))[0]?.key
  const decisions: Decisions = chapterKey ? { [chapterKey]: { status: 'kept', id: chapterId } } : {}
  const previous = s.run
  const wasOpen = !!previous && hasOpen(previous, s.gone)
  dropReplaced()
  const size: OutlineSize = { acts: 0, chapters: 1, scenes: 0 }
  put(key, {
    size,
    problem: null,
    blank: false,
    earlier: withEarlier(s, previous),
    run: { taskId, generationId: null, text: '', status: 'running', cutOff: false, retrying: null, size, decisions, edits: {}, lead, at: Date.now() }
  })
  try {
    const { generationId } = await api.startChapterPlan({ taskId, chapterId, answers })
    patchRun(key, taskId, (r) => ({ generationId: r.generationId ?? generationId }))
  } catch (e) {
    if (get(key).run?.taskId !== taskId) return
    put(key, { run: previous, earlier: s.earlier, problem: { message: (e as Error).message, code: e instanceof ApiError ? e.code : undefined } })
    return
  }
  if (wasOpen) noteEarlier()
}

// ---------- Talking it over, and doing one again (the Story builder, 2026-10-17) ----------

/**
 * The session's run as the page shows it (what has left the story since waits for a decision again); null when there
 * is none, or a request is still arriving.
 */
export function settledRun(storyId: ID): HelperRun | null {
  const s = get(keyOf(storyId))
  return s.run && !runBusy(s.run) ? shownRun(s, s.run) : null
}

/** A talk's revised plan, and what it knows of where its parts came from (planTalk.ts PlanRevision). */
export interface RevisionInput extends RevisionTrail {
  text: string
  /** The suggestions' text its trail goes by: the trail holds only while they still read so. */
  base?: string
}

/**
 * Applies a revised plan from talking it over: it takes the place of the suggestions, and Undo in a toast brings them
 * back. What Adam did carries over (revision.ts): what was kept stays kept, in its place, and is never offered to keep
 * twice; what he discarded since stays discarded; his own changes stay his where the talk didn't change that part.
 */
export function applyRevision(storyId: ID, revision: RevisionInput): boolean {
  listen()
  const key = keyOf(storyId)
  const s = get(key)
  const previous = s.run
  if (!previous || runBusy(previous)) return false
  // A redo or another revision since moves the parts about: then they are matched by their titles alone.
  const trail: RevisionTrail = revision.base === undefined || revision.base === previous.text ? revision : {}
  const next = carryRevision(previous.text, decisionsOf(s), previous.edits, revision.text, trail)
  const taskId = crypto.randomUUID()
  const run: HelperRun = {
    ...previous,
    taskId,
    generationId: null,
    text: next.text,
    status: 'complete',
    cutOff: false,
    retrying: null,
    decisions: next.decisions,
    edits: next.edits,
    stage: null
  }
  dropReplaced()
  put(key, { run, problem: null })
  offerBack(storyId, taskId, previous, next.keptAsWas)
  return true
}

/**
 * Puts a new version of one suggestion in its place (Use this, after doing it again): every other suggestion keeps its
 * decision and Adam's changes; the old version's are cleared. Undo in a toast puts the old one back.
 */
export function applyRedo(storyId: ID, nodeKey: string, nextText: string, under: string[]): boolean {
  const key = keyOf(storyId)
  const run = get(key).run
  if (!run || runBusy(run)) return false
  const before = run
  const decisions = { ...run.decisions }
  const edits = { ...run.edits }
  for (const k of under) {
    if (decisions[k]?.status !== 'kept') delete decisions[k]
    delete edits[k]
  }
  put(key, { run: { ...run, text: nextText, decisions, edits, stage: null } })
  toast('Swapped in the new version.', {
    action: {
      label: 'Undo',
      run: () => {
        const now = get(key).run
        if (now?.taskId === before.taskId && now.status !== 'running') put(key, { run: { ...before, decisions: { ...now.decisions, ...pick(before.decisions, under) } } })
      }
    }
  })
  return true
}

const pick = (d: Decisions, keys: string[]): Decisions => Object.fromEntries(Object.entries(d).filter(([k]) => keys.includes(k)))

/** Stops the request; what has arrived stays, to keep or discard. */
export function stopOutline(storyId: ID, chapterId?: ID | null): void {
  const run = get(keyOf(storyId, chapterId)).run
  if (run?.status === 'running') void api.stopTask(run.taskId).catch(() => undefined)
  // A stage arriving under one act or chapter: what has come stays, as it does for the outline.
  if (run?.stage?.status === 'running') void api.stopTask(run.stage.taskId).catch(() => undefined)
}

/** Puts away what a stage said went wrong (or that nothing came), under its act or chapter. */
export function dismissStage(storyId: ID): void {
  const key = keyOf(storyId)
  const run = get(key).run
  if (run?.stage && run.stage.status !== 'running') patchRun(key, run.taskId, { stage: null })
}

export function dismissProblem(storyId: ID, chapterId?: ID | null): void {
  put(keyOf(storyId, chapterId), { problem: null })
}

// ---------- Edit ----------

/** Adam's own words for a suggestion. `runId`: an earlier batch's (left out: the newest suggestions). */
export function saveEdit(storyId: ID, nodeKey: string, edit: NodeEdit, chapterId?: ID | null, runId?: ID | null): void {
  const key = keyOf(storyId, chapterId)
  const run = runIn(get(key), runId)
  if (run) patchRun(key, run.taskId, (r) => ({ edits: { ...r.edits, [nodeKey]: edit } }))
}

// ---------- Keep ----------

export interface KeepOptions {
  /**
   * When a keep starts the story's World build: 'always' (it named new pages, plot threads, or started a fresh story;
   * the default), or 'new-pages' (only when it made pages for names the world didn't have: the Story builder, once its
   * codex is built).
   */
  build?: 'always' | 'new-pages'
  /** The suggestions to keep from: an earlier batch's task id (left out: the newest suggestions). */
  runId?: ID | null
  /**
   * Where Adam chose to put the one act or chapter kept (2026-10-19), and how the toast says it ("after “The Docks”");
   * left out: where the outline puts it (after the one it follows that is kept, else at the end).
   */
  place?: KeepPlace
  placeWords?: string
}

/** What a Keep's toast adds when it starts building the story's cast, so the build is never a surprise later. */
export const BUILD_NOTE = ' AI Write builds the story’s characters and places next.'

/** Stories whose keeps build as the Story builder says (see KeepOptions), whichever page the Keep is clicked on. */
const keepBuild = new Map<ID, 'always' | 'new-pages'>()
export function setKeepBuild(storyId: ID, build: 'always' | 'new-pages'): void {
  keepBuild.set(storyId, build)
}

interface KeepBatch {
  toastId: number
  key: string
  storyId: ID
  taskId: ID
  /** Everything kept while the toast showed, in the order it was made. */
  kept: KeptItem[]
  /** One of its keeps starts building the story's cast (the toast says so). */
  building?: boolean
}

let keepBatch: KeepBatch | null = null
const liveToast = (id: number): boolean => useToasts.getState().items.some((t) => t.id === id)

// One keep at a time for each session, so two quick clicks never add the same thing twice.
const queues = new Map<string, Promise<void>>()
function inTurn(key: string, job: () => Promise<void>): Promise<void> {
  const next = (queues.get(key) ?? Promise.resolve()).then(job, job)
  queues.set(key, next)
  return next
}

/**
 * Keep: adds these suggestions to the story (with what is still open inside them, and the act and
 * chapter around them), after what the story has. `keys` 'all': every suggestion still open.
 */
export function keepSuggestions(storyId: ID, keys: string[] | 'all', chapterId?: ID | null, o: KeepOptions = {}): Promise<void> {
  const key = keyOf(storyId, chapterId)
  return inTurn(key, async () => {
    // What was kept but deleted from the story since is made anew, rather than looked for in vain.
    await checkKept(storyId, chapterId)
    const s = get(key)
    const run = runIn(s, o.runId)
    if (!run || run.status === 'running' || stageHolds(run, keys)) return
    const tree = treeOf(run)
    const planned = keepPlan(tree, decisionsOf(s, run), run.edits, keys)
    const items = o.place && keys !== 'all' && keys.length === 1 ? placeKeep(planned, keys[0], o.place) : planned
    if (!items.length) return
    let kept: KeptItem[]
    try {
      kept = await api.keepOutline(storyId, items)
    } catch (e) {
      toast((e as Error).message || 'That didn’t work. Please try again.', { tone: 'danger' })
      useApp.getState().bumpOutline()
      return
    }
    patchRun(key, run.taskId, (r) => ({ decisions: withKept(r.decisions, kept) }))
    settledOnNew(key, run.taskId)
    useApp.getState().bumpOutline()
    // Chapter cards it filled may have changed what an open scene card follows.
    if (items.some((i) => i.card)) notifyChapterCard()
    // The World builder lays out what the story needs when this keep named characters, places or plot threads the world
    // didn't have, or started a fresh story (it took the place of its empty first chapter): a plan whose cast is named
    // only in its premise and summaries (a recipe's story often is, 0.7.5) still gets its characters built.
    // The Story builder, once its codex is built, builds again only for pages this keep made.
    const build = (keepBuild.get(storyId) ?? o.build ?? 'always') === 'new-pages' ? kept.some((k) => k.entryIds?.length) : kept.some((k) => k.entryIds?.length || k.threadIds?.length || k.reused)
    if (build) buildStoryWorldSoon(storyId)
    const said =
      keys === 'all'
        ? `Added ${describeCounts(countKinds(kept.map((k) => k.kind)))} to the ${chapterId ? 'chapter' : 'story'}.`
        : chapterId
          ? keptMessage(tree, keys[0], items).replace(' to the story', ' to the chapter')
          : keptMessage(tree, keys[0], items)
    const message = o.place && o.placeWords ? said.replace(/\.$/, `, ${o.placeWords}.`) : said
    announceKept({ key, storyId, taskId: run.taskId, kept, building: build }, message)
  })
}

/** A stage arriving under one of these suggestions (or around them): they wait for it, and so does Keep all. */
function stageHolds(run: HelperRun, keys: string[] | 'all'): boolean {
  const st = run.stage
  if (st?.status !== 'running') return false
  return keys === 'all' || keys.some((k) => isUnder(k, st.key) || isUnder(st.key, k))
}

function announceKept(b: Omit<KeepBatch, 'toastId'>, message: string): void {
  if (keepBatch && liveToast(keepBatch.toastId) && keepBatch.key === b.key && keepBatch.taskId === b.taskId) {
    keepBatch.kept.push(...b.kept)
    keepBatch.building ||= b.building
    useToasts.getState().update(keepBatch.toastId, {
      // A chapter's plan (its session's key names the chapter) adds to the chapter.
      message: `Added ${describeCounts(countKinds(keepBatch.kept.map((k) => k.kind)))} to the ${keepBatch.key.includes('#') ? 'chapter' : 'story'}.${madePagesNote(keepBatch.kept)}${placedEventsNote(keepBatch.kept)}${keepBatch.building ? BUILD_NOTE : ''}`
    })
    return
  }
  const batch: KeepBatch = { ...b, toastId: 0, kept: [...b.kept] }
  // It names the characters and places it made pages for (2026-10-17), the events it put in their scenes, and says when it
  // starts building them (2026-10-19).
  batch.toastId = toast(`${message}${madePagesNote(b.kept)}${placedEventsNote(b.kept)}${b.building ? BUILD_NOTE : ''}`, {
    action: {
      label: 'Undo',
      run: () => {
        if (keepBatch === batch) keepBatch = null
        void undoKeep(batch)
      }
    }
  })
  keepBatch = batch
}

/** Undo for Keep: takes what was added back out of the story, and the suggestions are open again. */
async function undoKeep(b: KeepBatch): Promise<void> {
  await inTurn(b.key, async () => {
    // The open scene may go with what is taken back: a kept chapter or act takes the scenes in it,
    // even ones added since. What Adam typed last is saved first.
    const bridge = editorBridge()
    if (bridge?.sceneId) await bridge.flush()
    let gone: ID[]
    try {
      gone = (await api.unkeepOutline(b.kept)).sceneIds
    } catch (e) {
      toast((e as Error).message || 'That didn’t work. Please try again.', { tone: 'danger' })
      useApp.getState().bumpOutline()
      return
    }
    moveOffScenes(gone)
    patchRun(b.key, b.taskId, (r) => ({ decisions: withoutKept(r.decisions, b.kept) }))
    // A talk's revision since carried those keeps over, under keys of its own: open there too.
    const ids = new Set(b.kept.map((k) => k.id))
    const reopen = (d: Decisions): Decisions => Object.fromEntries(Object.entries(d).filter(([, x]) => !(x.status === 'kept' && ids.has(x.id))))
    for (const r of allRuns(get(b.key)))
      if (r.taskId !== b.taskId && Object.values(r.decisions).some((x) => x.status === 'kept' && ids.has(x.id)))
        patchRun(b.key, r.taskId, (x) => ({ decisions: reopen(x.decisions) }))
    // Suggestions replaced since, and offered back: they show these as open again too.
    if (replaced?.run.taskId === b.taskId) replaced.run = { ...replaced.run, decisions: withoutKept(replaced.run.decisions, b.kept) }
    useApp.getState().bumpOutline()
    if (b.kept.some((k) => k.card)) notifyChapterCard()
  })
}

/** The open scene was taken back out: open the one beside it instead, staying on this page. */
function moveOffScenes(sceneIds: ID[]): void {
  const app = useApp.getState()
  const open = app.sceneId
  if (!open || !sceneIds.includes(open)) return
  const o = useOutlineStore.getState().outline
  const next = o ? neighbourAfterRemoval(readingOrder(o), sceneIds, open) : null
  const view = app.view
  app.selectScene(next)
  app.navigate(view)
}

// ---------- Discard ----------

interface DiscardBatch {
  toastId: number
  key: string
  taskId: ID
  keys: string[]
}

let discardBatch: DiscardBatch | null = null

/**
 * Discard: the suggestion, and everything still open inside it, goes from the list. Undo brings it back. `runId`: an
 * earlier batch's (left out: the newest suggestions).
 */
export function discardSuggestion(storyId: ID, nodeKey: string, chapterId?: ID | null, runId?: ID | null): void {
  const key = keyOf(storyId, chapterId)
  const s = get(key)
  const run = runIn(s, runId)
  if (!run || run.status === 'running' || stageHolds(run, [nodeKey])) return
  const tree = treeOf(run)
  const keys = discardKeys(tree, decisionsOf(s, run), nodeKey)
  if (!keys.length) return
  patchRun(key, run.taskId, (r) => ({ decisions: withDiscarded(r.decisions, keys) }))
  settledOnNew(key, run.taskId)
  if (discardBatch && liveToast(discardBatch.toastId) && discardBatch.key === key && discardBatch.taskId === run.taskId) {
    discardBatch.keys.push(...keys)
    const kinds = discardBatch.keys.map((k) => findKind(tree, k)).filter((k): k is TreeNode['kind'] => !!k)
    useToasts.getState().update(discardBatch.toastId, { message: `Discarded ${describeCounts(countKinds(kinds))}.` })
    return
  }
  const batch: DiscardBatch = { toastId: 0, key, taskId: run.taskId, keys: [...keys] }
  batch.toastId = toast(discardedMessage(tree, keys, run.edits), {
    action: {
      label: 'Undo',
      run: () => {
        if (discardBatch === batch) discardBatch = null
        patchRun(batch.key, batch.taskId, (r) => ({ decisions: withoutDiscarded(r.decisions, batch.keys) }))
      }
    }
  })
  discardBatch = batch
}

/**
 * "Put these away" on an earlier batch: everything in it still waiting for a decision is discarded at once, so the
 * batch leaves the page. Undo in a toast brings it all back.
 */
export function putAwayEarlier(storyId: ID, runId: ID, chapterId?: ID | null): void {
  const key = keyOf(storyId, chapterId)
  const s = get(key)
  const run = (s.earlier ?? []).find((r) => r.taskId === runId)
  if (!run) return
  const decisions = decisionsOf(s, run)
  const open: TreeNode[] = []
  const walk = (nodes: TreeNode[]): void =>
    nodes.forEach((n) => {
      if (!decisions[n.key]) open.push(n)
      walk(n.children)
    })
  walk(treeOf(run))
  if (!open.length) return
  const keys = open.map((n) => n.key)
  patchRun(key, runId, (r) => ({ decisions: withDiscarded(r.decisions, keys) }))
  toast(`Put away ${describeCounts(countKinds(open.map((n) => n.kind)))} from earlier.`, {
    action: { label: 'Undo', run: () => void patchRun(key, runId, (r) => ({ decisions: withoutDiscarded(r.decisions, keys) })) }
  })
}

function findKind(tree: TreeNode[], key: string): TreeNode['kind'] | null {
  for (const n of tree) {
    if (n.key === key) return n.kind
    const inner = findKind(n.children, key)
    if (inner) return inner
  }
  return null
}
