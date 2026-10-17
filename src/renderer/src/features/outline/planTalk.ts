// Talking the outline's suggestions over, and doing one of them again (the Story builder, 2026-10-17). The talk's
// revised plan waits as a preview (talkStore.ts) and Apply puts it in place of the suggestions (helperStore
// applyRevision, with Undo). Doing one again ("Redo", with an optional note) streams a new version of that act,
// chapter or scene beside it; Use this swaps it in (applyRedo, with Undo), Keep mine leaves it. Only the story's own
// suggestions (not a chapter's plan).

import { create } from 'zustand'
import type { ID } from '@shared/types'
import { api } from '@/lib/api'
import { useApp } from '@/lib/store'
import { arriving, followTask, say, settlePreview, talkOf } from '@/features/planning/talkStore'
import { applyRedo, applyRevision, settledRun, treeOf } from './helperStore'
import { firstOfKind, keysUnder, nodeText, openText, spliceText, splitPlanAnswer } from './outlineText'
import { emptySuggestedCard, parseOutline, type SuggestedAct, type SuggestedChapter, type SuggestedScene } from './parse'
import { outlineTree, type NodeKind, type TreeNode } from './tree'

export const planScope = (storyId: ID): string => `plan:${useApp.getState().world?.id ?? ''}:${storyId}`

/** Says something about the suggestions; a revised plan waits as the preview (its text, in the outline form). */
export function talkPlan(storyId: ID, message: string): Promise<void> {
  const scope = planScope(storyId)
  return say(scope, message, async (taskId, history) => {
    const run = settledRun(storyId)
    if (!run) throw new Error('Wait for the plan to finish arriving first.')
    const current = openText(run.text, run.decisions, run.edits)
    const done = await followTask(
      taskId,
      () => api.startPlanChat({ taskId, storyId, current, history, message }),
      (text) => arriving(scope, taskId, splitPlanAnswer(text).answer)
    )
    if (done.status === 'stopped') return null
    if (done.status === 'error') throw new Error(done.error ?? 'That didn’t work. Please try again.')
    const { answer, plan } = splitPlanAnswer(done.text)
    const usable = plan && outlineTree(parseOutline(plan, true)).length ? plan : null
    return { answer, revision: usable }
  })
}

/** Apply: the revised plan takes the place of the suggestions (Undo in a toast). */
export function applyPlanTalk(storyId: ID): void {
  const scope = planScope(storyId)
  const text = talkOf(scope).preview
  if (typeof text !== 'string') return
  if (applyRevision(storyId, text)) settlePreview(scope, 'applied')
}

export function declinePlanTalk(storyId: ID): void {
  settlePreview(planScope(storyId), 'declined')
}

/** The revised plan as a tree, for its preview. */
export const previewTree = (text: string): TreeNode[] => outlineTree(parseOutline(text, true))

// ---------- Doing one again ----------

export interface Redo {
  kind: NodeKind
  note: string
  status: 'idle' | 'running' | 'done' | 'error'
  taskId: ID | null
  text: string
  error: string | null
}

export const useRedos = create<{ redos: Record<string, Redo> }>(() => ({ redos: {} }))

export const redoKey = (storyId: ID, nodeKey: string): string => `${useApp.getState().world?.id ?? ''}:${storyId}#${nodeKey}`
const get = (k: string): Redo | undefined => useRedos.getState().redos[k]
const put = (k: string, r: Redo | null): void =>
  useRedos.setState((s) => {
    const redos = { ...s.redos }
    if (r) redos[k] = r
    else delete redos[k]
    return { redos }
  })

export function openRedo(storyId: ID, nodeKey: string, kind: NodeKind): void {
  if (!get(redoKey(storyId, nodeKey))) put(redoKey(storyId, nodeKey), { kind, note: '', status: 'idle', taskId: null, text: '', error: null })
}

export function setRedoNote(storyId: ID, nodeKey: string, note: string): void {
  const k = redoKey(storyId, nodeKey)
  const r = get(k)
  if (r) put(k, { ...r, note })
}

/** Keep mine (or Cancel): the redo goes, and anything still arriving stops. */
export function closeRedo(storyId: ID, nodeKey: string): void {
  const k = redoKey(storyId, nodeKey)
  const r = get(k)
  if (r?.status === 'running' && r.taskId) void api.stopTask(r.taskId).catch(() => undefined)
  put(k, null)
}

export async function startRedo(storyId: ID, nodeKey: string): Promise<void> {
  const k = redoKey(storyId, nodeKey)
  const r = get(k)
  const run = settledRun(storyId)
  if (!r || r.status === 'running' || !run) return
  const target = nodeText(run.text, nodeKey, run.edits)
  if (!target) return put(k, { ...r, status: 'error', error: 'That suggestion isn’t there any more.' })
  const current = openText(run.text, run.decisions, run.edits)
  const taskId = crypto.randomUUID()
  put(k, { ...r, status: 'running', taskId, text: '', error: null })
  try {
    const done = await followTask(
      taskId,
      () => api.startPlanRedo({ taskId, storyId, current, target, kind: r.kind, note: r.note }),
      (text) => {
        const now = get(k)
        if (now?.taskId === taskId) put(k, { ...now, text })
      }
    )
    const now = get(k)
    if (now?.taskId !== taskId) return
    if (done.status === 'stopped') return put(k, { ...now, status: done.text.trim() ? 'done' : 'idle', text: done.text })
    if (done.status === 'error') return put(k, { ...now, status: 'error', error: done.error ?? 'That didn’t work. Please try again.' })
    const fresh = firstOfKind(done.text, r.kind)
    if (!fresh) return put(k, { ...now, status: 'error', text: done.text, error: 'The new version didn’t come in the right form. Please try again.' })
    put(k, { ...now, status: 'done', text: done.text })
  } catch (e) {
    const now = get(k)
    if (now?.taskId === taskId) put(k, { ...now, status: 'error', error: (e as Error).message || 'That didn’t work. Please try again.' })
  }
}

export function stopRedo(storyId: ID, nodeKey: string): void {
  const r = get(redoKey(storyId, nodeKey))
  if (r?.status === 'running' && r.taskId) void api.stopTask(r.taskId).catch(() => undefined)
}

/** The new version, as a node to show (null while none has arrived in the right form). */
export function redoNode(r: Redo): TreeNode | null {
  const fresh = firstOfKind(r.text, r.kind)
  if (!fresh) return null
  if (r.kind === 'act') return outlineTree({ acts: [fresh as SuggestedAct], chapters: [] })[0] ?? null
  if (r.kind === 'chapter') return outlineTree({ acts: [], chapters: [fresh as SuggestedChapter] })[0] ?? null
  const holder: SuggestedChapter = { key: 'c0', title: '', goal: '', card: emptySuggestedCard(), scenes: [fresh as SuggestedScene], complete: true }
  return outlineTree({ acts: [], chapters: [holder] })[0]?.children[0] ?? null
}

/** Use this: the new version takes the old one's place (Undo in a toast). */
export function takeRedo(storyId: ID, nodeKey: string): void {
  const k = redoKey(storyId, nodeKey)
  const r = get(k)
  const run = settledRun(storyId)
  if (!r || !run) return
  const fresh = firstOfKind(r.text, r.kind)
  if (!fresh) return
  const next = spliceText(run.text, nodeKey, fresh)
  if (!next) return
  const all: string[] = []
  const walk = (nodes: TreeNode[]): void =>
    nodes.forEach((n) => {
      all.push(n.key)
      walk(n.children)
    })
  walk(treeOf(run))
  if (applyRedo(storyId, nodeKey, next, keysUnder(nodeKey, all))) put(k, null)
}
