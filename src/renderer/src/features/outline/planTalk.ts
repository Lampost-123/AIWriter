// Talking the outline's suggestions over, and doing one of them again (the Story builder, 2026-10-17). The talk's
// revised plan waits as a preview (talkStore.ts) and Apply puts it in place of the suggestions (helperStore
// applyRevision, with Undo). Doing one again ("Redo", with an optional note) streams a new version of that act,
// chapter or scene beside it; Use this swaps it in (applyRedo, with Undo), Keep mine leaves it. Only the story's own
// suggestions (not a chapter's plan).

import { create } from 'zustand'
import type { ChatTurn } from '@shared/contracts/storyBuilder'
import type { ID } from '@shared/types'
import { api } from '@/lib/api'
import { useApp } from '@/lib/store'
import { arriving, followTask, relay, say, settlePreview, talkOf } from '@/features/planning/talkStore'
import { applyRedo, applyRevision, settledRun, treeOf } from './helperStore'
import {
  applyPlanChanges,
  firstOfKind,
  keysUnder,
  nodeText,
  openText,
  spliceText,
  splitPlanReply,
  stripTags,
  taggedText,
  titleOfTag,
  touchesOf,
  type PlanChange
} from './outlineText'
import { emptySuggestedCard, parseOutline, type SuggestedAct, type SuggestedChapter, type SuggestedScene } from './parse'
import { outlineTree, type NodeKind, type TreeNode } from './tree'

export const planScope = (storyId: ID): string => `plan:${useApp.getState().world?.id ?? ''}:${storyId}`

/** An answer saying a change was made ("I've moved those scenes to the kitchen"). */
const CLAIMS = /\b(?:I(?:'|’)?ve|I have|I(?:'|’)ll|I will|I(?:'|’)m|I)\s+(?:now\s+|also\s+|just\s+)?(?:changed|moved|updated|revised|reworked|rewritten|rewrote|replaced|added|cut|removed|renamed|made|set|swapped|kept|make sure|change|move|update|revise|rework|replace|add|remove|rename|making|changing|moving|updating)\b/i

/** What the AI is asked when it said it changed something but sent no changes. */
const FORGOT =
  'You said you changed it, but no changes came with your answer, so nothing changed. Send them now: one short sentence, then a line with exactly "=== Changes ===", the "Touches:" line, and the changed parts with their tags.'

/** What the AI is asked when parts it listed under "Touches:" came with no change. */
const MISSING = (parts: string[]): string =>
  `You listed these under "Touches:" but sent no change for them, so they still say the old thing: ${parts.join('; ')}. Send the changes for them now: one short sentence, then a line with exactly "=== Changes ===" and those parts with their tags.`

/** Most times the AI is asked again within one answer, for changes it left out. */
const MOST_ASKS = 2

/** A revised plan waiting as the preview: its text (in the outline form), and what changed when the AI sent only that. */
export interface PlanRevision {
  text: string
  /** Null for a whole plan sent again (its preview marks what differs instead). */
  changes: PlanChange[] | null
  /** Changes that named a part that isn't there. */
  lost: number
}

export const isPlanRevision = (v: unknown): v is PlanRevision => !!v && typeof v === 'object' && typeof (v as PlanRevision).text === 'string'

const KIND_WORD: Record<NodeKind, string> = { act: 'Act', chapter: 'Chapter', scene: 'Scene' }

/** "Scene: The Health Check", for the chips under an answer. */
const labelOf = (c: PlanChange): string => `${c.mark === 'new' ? 'New ' : c.mark === 'removed' ? 'Cut ' : ''}${c.mark === 'changed' ? KIND_WORD[c.kind] : c.kind}: ${(c.after ?? c.before)?.title ?? ''}`

/**
 * Says something about the suggestions; a revised plan waits as the preview. The AI sends only what it changed, by
 * each part's tag, with a "Touches:" line listing every part the request reaches; those are put into the plan here.
 * When it says it changed something but sends nothing, or leaves out a part it listed, it is asked again for just
 * that (twice at most), so one request makes the whole change. A revision still waiting is built on, so "it still
 * says his bedroom" fixes the preview rather than starting over.
 */
export function talkPlan(storyId: ID, message: string): Promise<void> {
  const scope = planScope(storyId)
  const pending = talkOf(scope).preview
  return say(
    scope,
    message,
    async (taskId, history) => {
      const run = settledRun(storyId)
      if (!run) throw new Error('Wait for the plan to finish arriving first.')
      const current = isPlanRevision(pending) ? pending.text : openText(run.text, run.decisions, run.edits)
      const sent = taggedText(current)
      const ask = async (id: ID, turns: ChatTurn[], words: string, shown: string): Promise<{ status: string; text: string }> => {
        const done = await followTask(
          id,
          () => api.startPlanChat({ taskId: id, storyId, current: sent, history: turns, message: words }),
          (text) => arriving(scope, taskId, shown || splitPlanReply(text).answer)
        )
        if (done.status === 'error') throw new Error(done.error ?? 'That didn’t work. Please try again.')
        return done
      }

      const done = await ask(taskId, history, message, '')
      if (done.status === 'stopped') return null
      const first = splitPlanReply(done.text)
      const answer = first.answer
      if (first.plan) {
        const whole = stripTags(first.plan)
        return { answer, revision: outlineTree(parseOutline(whole, true)).length ? ({ text: whole, changes: null, lost: 0 } satisfies PlanRevision) : null }
      }

      let changes = first.changes ?? ''
      const touches = new Set(touchesOf(done.text))
      let turns: ChatTurn[] = [...history, { role: 'user', text: message }, { role: 'assistant', text: done.text }]
      let result = changes ? applyPlanChanges(current, changes) : null
      for (let n = 0; n < MOST_ASKS; n++) {
        const missing = [...touches].filter((k) => !result?.done.has(k) && titleOfTag(current, k))
        const nudge = !result && !changes && CLAIMS.test(answer) ? FORGOT : missing.length ? MISSING(missing.map((k) => `${titleOfTag(current, k)} [#${k}]`)) : null
        if (!nudge) break
        const again = crypto.randomUUID()
        relay(scope, taskId, again, result ? 'Changing the rest of what it touches…' : 'Making the change…')
        const more = await ask(again, turns, nudge, answer)
        if (more.status === 'stopped') break
        const next = splitPlanReply(more.text)
        for (const k of touchesOf(more.text)) touches.add(k)
        turns = [...turns, { role: 'user', text: nudge }, { role: 'assistant', text: more.text }]
        if (!next.changes) break
        changes = `${changes}\n\n${next.changes}`
        result = applyPlanChanges(current, changes) ?? result
      }
      if (!result) return { answer, revision: null }
      return {
        answer,
        revision: { text: result.text, changes: result.changes, lost: result.lost } satisfies PlanRevision,
        changes: result.changes.map(labelOf)
      }
    },
    true
  )
}

/** Apply: the revised plan takes the place of the suggestions (Undo in a toast). */
export function applyPlanTalk(storyId: ID): void {
  const scope = planScope(storyId)
  const preview = talkOf(scope).preview
  if (!isPlanRevision(preview)) return
  if (applyRevision(storyId, preview.text)) settlePreview(scope, 'applied')
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
