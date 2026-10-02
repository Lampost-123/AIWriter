// What the outline helper holds while the app is open, one for each story in each world: how much to
// suggest, the suggestions as they arrived and what Adam decided about each (kept, discarded, his own
// words). A request keeps going when he leaves the page, so coming back shows it with Stop, never an
// empty page inviting him to ask twice. The page itself (OutlineHelper.tsx) is drawn from this.
//
// Keep and Discard are undone from a toast. Several in a row share one toast ("Added 2 chapters and
// 6 scenes to the story."), so an earlier Undo is never pushed away and one Undo takes them all back.
import { create } from 'zustand'
import type { KeptItem, OutlineSize } from '@shared/contracts/outline'
import type { ID } from '@shared/types'
import { toast, useToasts } from '@/components/ui'
import { api, ApiError, onEvent } from '@/lib/api'
import { editorBridge } from '@/lib/editorBridge'
import { useApp } from '@/lib/store'
import { neighbourAfterRemoval, readingOrder } from '@/features/binder/outlineModel'
import { useOutlineStore } from '@/features/binder/outlineStore'
import { parseOutline } from './parse'
import {
  countKinds,
  describeCounts,
  discardedMessage,
  discardKeys,
  goneIds,
  keepPlan,
  keptMessage,
  outlineTree,
  withDiscarded,
  withKept,
  withoutDiscarded,
  withoutGone,
  withoutKept,
  type Decisions,
  type Edits,
  type NodeEdit,
  type TreeNode
} from './tree'

export interface Problem {
  message: string
  code?: string
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
}

export interface HelperSession {
  /** How much to suggest; null until Adam picks (the page then suggests a size that suits the story). */
  size: OutlineSize | null
  run: HelperRun | null
  problem: Problem | null
  /** What was kept but has since been deleted from the story (in the binder): it waits for a decision again. */
  gone: ID[]
  /**
   * The story has nothing planned or written yet, so the AI plans it from the premise, as the page says.
   * The main process decides, by the rule it uses for what the AI is told (api.outlineBlank). Null until known.
   */
  blank: boolean | null
}

const fresh = (): HelperSession => ({ size: null, run: null, problem: null, gone: [], blank: null })

/** The decisions as the page shows them and its buttons go by: the run's, less what has left the story since. */
export const decisionsOf = (s: HelperSession): Decisions => (s.run ? withoutGone(s.run.decisions, s.gone) : {})

export const useOutlineHelper = create<{ sessions: Record<string, HelperSession> }>(() => ({ sessions: {} }))

/** The session's key: the story, in the world that is open. */
export const helperKey = (worldId: ID | null | undefined, storyId: ID): string => `${worldId ?? ''}:${storyId}`
const keyOf = (storyId: ID): string => helperKey(useApp.getState().world?.id, storyId)

const get = (key: string): HelperSession => useOutlineHelper.getState().sessions[key] ?? fresh()
const put = (key: string, patch: Partial<HelperSession>): void =>
  useOutlineHelper.setState((st) => ({ sessions: { ...st.sessions, [key]: { ...(st.sessions[key] ?? fresh()), ...patch } } }))

/** Changes the run, if it is still the one with this task id (a newer request leaves an older one's events alone). */
function patchRun(key: string, taskId: ID, patch: Partial<HelperRun> | ((r: HelperRun) => Partial<HelperRun>)): boolean {
  const run = get(key).run
  if (!run || run.taskId !== taskId) return false
  put(key, { run: { ...run, ...(typeof patch === 'function' ? patch(run) : patch) } })
  return true
}

function findTask(taskId: ID): string | null {
  for (const [key, s] of Object.entries(useOutlineHelper.getState().sessions)) if (s.run?.taskId === taskId) return key
  return null
}

let listening = false
/** Follows outline requests for as long as the window is open, whichever page is showing. */
function listen(): void {
  if (listening) return
  listening = true
  onEvent('task:progress', (p) => {
    if (p.job !== 'outline') return
    const key = findTask(p.taskId)
    if (key) patchRun(key, p.taskId, { text: p.text, generationId: p.generationId, retrying: null })
  })
  onEvent('task:retrying', (p) => {
    const key = findTask(p.taskId)
    if (key) patchRun(key, p.taskId, { retrying: p.reason })
  })
  onEvent('task:done', (d) => {
    if (d.job !== 'outline') return
    const key = findTask(d.taskId)
    if (!key) return
    patchRun(key, d.taskId, { text: d.text, generationId: d.generationId, status: d.status, cutOff: d.cutOff, retrying: null })
    if (d.status === 'error')
      put(key, { problem: { message: d.error ?? 'Something went wrong while the outline was suggested. Please try again.' } })
  })
  // Whenever the binder changes (a delete, its Undo), what was kept is looked for again, so the page
  // never says "Kept" for something the story no longer has, even when it wasn't showing at the time.
  // Whether the story has anything planned yet is asked again too.
  useApp.subscribe((now, before) => {
    if (now.outlineRev === before.outlineRev) return
    const prefix = helperKey(now.world?.id, '')
    for (const [key, s] of Object.entries(useOutlineHelper.getState().sessions)) {
      if (!key.startsWith(prefix)) continue
      const storyId = key.slice(prefix.length)
      if (s.gone.length || hasKept(s.run)) void checkKept(storyId)
      void checkBlank(storyId)
    }
  })
}

/** How many asks each session has started, so only the latest one's answer counts. */
const blankChecks = new Map<string, number>()

/** Asks whether the story has anything planned or written yet (see HelperSession.blank). */
export async function checkBlank(storyId: ID): Promise<void> {
  listen()
  const key = keyOf(storyId)
  const turn = (blankChecks.get(key) ?? 0) + 1
  blankChecks.set(key, turn)
  let blank: boolean
  try {
    blank = await api.outlineBlank(storyId)
  } catch {
    // The story may have gone (the page says so); otherwise the page carries on from what it knew.
    blank = get(key).blank ?? false
  }
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
export async function checkKept(storyId: ID): Promise<void> {
  const key = keyOf(storyId)
  const run = get(key).run
  if (!run || (!hasKept(run) && !get(key).gone.length)) return
  const decisions = run.decisions
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
  if (checks.get(key) !== turn || now.run?.taskId !== run.taskId) return
  const gone = goneIds(decisions, present)
  if (gone.length !== now.gone.length || gone.some((id, i) => id !== now.gone[i])) put(key, { gone })
  // The last Keep's toast speaks of what has left the story since: the next Keep gets a toast of its
  // own, and a toast offering to take back only what is gone already goes.
  const batch = keepBatch
  if (batch?.key === key && batch.taskId === run.taskId && batch.kept.some((k) => gone.includes(k.id))) {
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

/** The suggestions so far as a tree. A reply that has ended (complete, stopped or failed) counts as whole. */
export function treeOf(run: HelperRun): TreeNode[] {
  return outlineTree(parseOutline(run.text, run.status !== 'running'))
}

// ---------- Suggest ----------

// The toast offering back suggestions that a new request replaced, while it shows.
let replaced: { toastId: number; key: string; taskId: ID; run: HelperRun } | null = null
const dropReplaced = (): void => {
  if (replaced) useToasts.getState().dismiss(replaced.toastId)
  replaced = null
}

/**
 * Asks for an outline from the premise as it is in the box. Suggestions still waiting for a decision
 * give way to the new ones, and Undo in a toast brings them back. A story with nothing planned yet is
 * planned from its premise alone, so that needs a word or two first (a hint, not a failure: 'no-premise').
 */
export async function suggestOutline(storyId: ID, premise: string, size: OutlineSize): Promise<void> {
  const key = keyOf(storyId)
  const s = get(key)
  if (s.run?.status === 'running') return
  if (!premise.trim() && s.blank !== false) {
    put(key, { problem: { message: 'Write the premise first: a line or two on what the story is about is enough.', code: 'no-premise' } })
    return
  }
  const taskId = crypto.randomUUID()
  const previous = s.run
  const wasOpen = !!previous && hasOpen(previous, s.gone)
  dropReplaced()
  put(key, {
    size,
    problem: null,
    gone: [],
    run: { taskId, generationId: null, text: '', status: 'running', cutOff: false, retrying: null, size, decisions: {}, edits: {} }
  })
  try {
    const { generationId } = await api.startOutline({ taskId, storyId, premise, size })
    patchRun(key, taskId, (r) => ({ generationId: r.generationId ?? generationId }))
  } catch (e) {
    if (get(key).run?.taskId !== taskId) return
    // Nothing started: what was on the page stays.
    put(key, { run: previous, gone: s.gone, problem: { message: (e as Error).message, code: e instanceof ApiError ? e.code : undefined } })
    return
  }
  if (previous && wasOpen) offerBack(storyId, taskId, previous)
}

const hasOpen = (run: HelperRun, gone: ID[]): boolean => {
  const decisions = withoutGone(run.decisions, gone)
  const open = (nodes: TreeNode[]): boolean => nodes.some((n) => !decisions[n.key] || open(n.children))
  return open(treeOf(run))
}

function offerBack(storyId: ID, taskId: ID, run: HelperRun): void {
  const key = keyOf(storyId)
  const toastId = toast('Replaced the earlier suggestions you hadn’t decided on.', {
    action: {
      label: 'Undo',
      run: () => {
        const now = get(key).run
        // As it is now: an Undo of one of its keeps since then opens those suggestions again (see undoKeep).
        const back = replaced?.toastId === toastId ? replaced.run : run
        if (replaced?.toastId === toastId) replaced = null
        if (!now || now.taskId !== taskId) return
        if (now.status === 'running') void api.stopTask(taskId).catch(() => undefined)
        put(key, { run: back, problem: null, gone: [] })
        // What it kept may have been deleted from the story since.
        void checkKept(storyId)
      }
    }
  })
  replaced = { toastId, key, taskId, run }
}

/**
 * A first Keep or Discard among the new suggestions settles on them: the toast offering back the ones
 * they replaced goes, rather than swapping away what Adam has started deciding on.
 */
function settledOnNew(key: string, taskId: ID): void {
  if (replaced?.key === key && replaced.taskId === taskId) dropReplaced()
}

/** Stops the request; what has arrived stays, to keep or discard. */
export function stopOutline(storyId: ID): void {
  const run = get(keyOf(storyId)).run
  if (run?.status === 'running') void api.stopTask(run.taskId).catch(() => undefined)
}

export function dismissProblem(storyId: ID): void {
  put(keyOf(storyId), { problem: null })
}

// ---------- Edit ----------

export function saveEdit(storyId: ID, nodeKey: string, edit: NodeEdit): void {
  const key = keyOf(storyId)
  const run = get(key).run
  if (run) patchRun(key, run.taskId, (r) => ({ edits: { ...r.edits, [nodeKey]: edit } }))
}

// ---------- Keep ----------

interface KeepBatch {
  toastId: number
  key: string
  storyId: ID
  taskId: ID
  /** Everything kept while the toast showed, in the order it was made. */
  kept: KeptItem[]
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
export function keepSuggestions(storyId: ID, keys: string[] | 'all'): Promise<void> {
  const key = keyOf(storyId)
  return inTurn(key, async () => {
    // What was kept but deleted from the story since is made anew, rather than looked for in vain.
    await checkKept(storyId)
    const s = get(key)
    const run = s.run
    if (!run || run.status === 'running') return
    const tree = treeOf(run)
    const items = keepPlan(tree, decisionsOf(s), run.edits, keys)
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
    const message =
      keys === 'all' ? `Added ${describeCounts(countKinds(kept.map((k) => k.kind)))} to the story.` : keptMessage(tree, keys[0], items)
    announceKept({ key, storyId, taskId: run.taskId, kept }, message)
  })
}

function announceKept(b: Omit<KeepBatch, 'toastId'>, message: string): void {
  if (keepBatch && liveToast(keepBatch.toastId) && keepBatch.key === b.key && keepBatch.taskId === b.taskId) {
    keepBatch.kept.push(...b.kept)
    useToasts.getState().update(keepBatch.toastId, {
      message: `Added ${describeCounts(countKinds(keepBatch.kept.map((k) => k.kind)))} to the story.`
    })
    return
  }
  const batch: KeepBatch = { ...b, toastId: 0, kept: [...b.kept] }
  batch.toastId = toast(message, {
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
    // Suggestions replaced since, and offered back: they show these as open again too.
    if (replaced?.run.taskId === b.taskId) replaced.run = { ...replaced.run, decisions: withoutKept(replaced.run.decisions, b.kept) }
    useApp.getState().bumpOutline()
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

/** Discard: the suggestion, and everything still open inside it, goes from the list. Undo brings it back. */
export function discardSuggestion(storyId: ID, nodeKey: string): void {
  const key = keyOf(storyId)
  const s = get(key)
  const run = s.run
  if (!run || run.status === 'running') return
  const tree = treeOf(run)
  const keys = discardKeys(tree, decisionsOf(s), nodeKey)
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

function findKind(tree: TreeNode[], key: string): TreeNode['kind'] | null {
  for (const n of tree) {
    if (n.key === key) return n.kind
    const inner = findKind(n.children, key)
    if (inner) return inner
  }
  return null
}
