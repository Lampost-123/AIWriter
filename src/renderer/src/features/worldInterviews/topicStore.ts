// The interviews by topic while the app is open (contracts/worldInterviews.ts), one set for each story and one for the
// world on its own: which topic is open, each topic's questions and Adam's answers, the suggestions it made and what he
// decided on each. Nothing about an interview is saved except what he keeps (that is in the world, with Undo); what
// each topic has kept is read back from the world, so the topics stay marked done. AI calls keep going when he leaves.

import { create } from 'zustand'
import type { InterviewProgress, InterviewTopic, TopicAsked, TopicEntry, TopicLink } from '@shared/contracts/worldInterviews'
import type { ID } from '@shared/types'
import { toast } from '@/components/ui'
import { api, ApiError } from '@/lib/api'
import { useApp } from '@/lib/store'
import { changedEntry, hasAnswers, roundAsked, type Decision } from './topicLogic'

export type Phase = 'idle' | 'asking' | 'answering' | 'suggesting' | 'review'

export interface TopicRun {
  asked: TopicAsked[]
  /** The round on screen, and what Adam has typed for each. */
  questions: string[]
  answers: string[]
  phase: Phase
  taskId: ID | null
  /** What went wrong, and what Try again does. */
  problem: { message: string; code?: string; retry: 'ask' | 'suggest' } | null
  /** The last call's record, for What the AI saw. */
  generationId: ID | null
  entries: TopicEntry[]
  links: TopicLink[]
  decisions: Record<string, Decision>
  /** The AI said it has what it needs (no Ask me more then). */
  enough: boolean
}

export interface Interviews {
  open: InterviewTopic | null
  topics: Partial<Record<InterviewTopic, TopicRun>>
  progress: InterviewProgress | null
}

const freshRun = (): TopicRun => ({
  asked: [],
  questions: [],
  answers: [],
  phase: 'idle',
  taskId: null,
  problem: null,
  generationId: null,
  entries: [],
  links: [],
  decisions: {},
  enough: false
})

export const useInterviews = create<{ scopes: Record<string, Interviews> }>(() => ({ scopes: {} }))

/** One set of interviews per story, and one for the world on its own (storyId null), in the open world. */
export const scopeKey = (storyId: ID | null): string => `${useApp.getState().world?.id ?? ''}:${storyId ?? ''}`

const scopeOf = (storyId: ID | null): Interviews => useInterviews.getState().scopes[scopeKey(storyId)] ?? { open: null, topics: {}, progress: null }
export const runOf = (storyId: ID | null, topic: InterviewTopic): TopicRun => scopeOf(storyId).topics[topic] ?? freshRun()

function putScope(storyId: ID | null, patch: Partial<Interviews>): void {
  const k = scopeKey(storyId)
  useInterviews.setState((s) => ({ scopes: { ...s.scopes, [k]: { ...(s.scopes[k] ?? { open: null, topics: {}, progress: null }), ...patch } } }))
}

function putRun(storyId: ID | null, topic: InterviewTopic, patch: Partial<TopicRun> | ((r: TopicRun) => Partial<TopicRun>)): void {
  const k = scopeKey(storyId)
  useInterviews.setState((s) => {
    const scope = s.scopes[k] ?? { open: null, topics: {}, progress: null }
    const was = scope.topics[topic] ?? freshRun()
    const next = { ...was, ...(typeof patch === 'function' ? patch(was) : patch) }
    return { scopes: { ...s.scopes, [k]: { ...scope, topics: { ...scope.topics, [topic]: next } } } }
  })
}

const messageOf = (e: unknown): { message: string; code?: string } =>
  e instanceof ApiError ? { message: e.message, code: e.code } : { message: (e as Error)?.message || 'Something went wrong. Please try again.' }

// ---------- What each topic has kept ----------

export async function loadProgress(storyId: ID | null): Promise<void> {
  const k = scopeKey(storyId)
  try {
    const progress = await api.getInterviewProgress({ storyId })
    if (scopeKey(storyId) === k) putScope(storyId, { progress })
  } catch {
    // Shown as not started; the next keep reads it again.
  }
}

// ---------- Opening and closing ----------

/** Opens a topic (one at a time); a topic not yet begun asks its first questions. */
export function openTopic(storyId: ID | null, topic: InterviewTopic): void {
  putScope(storyId, { open: topic })
  const r = runOf(storyId, topic)
  if (r.phase === 'idle' && !r.asked.length && !r.entries.length && !r.links.length && !r.problem) void askMore(storyId, topic)
}

/** Closes the open topic. What was asked and suggested stays, to come back to; a call on its way is stopped. */
export function closeTopic(storyId: ID | null): void {
  const open = scopeOf(storyId).open
  if (open) {
    const r = runOf(storyId, open)
    if (r.taskId) stopCall(storyId, open)
  }
  putScope(storyId, { open: null })
}

// ---------- Questions ----------

/** The next round of questions (or, when the AI has enough, the suggestions). */
export async function askMore(storyId: ID | null, topic: InterviewTopic): Promise<void> {
  const r = runOf(storyId, topic)
  if (r.taskId) return
  const taskId = crypto.randomUUID()
  putRun(storyId, topic, { phase: 'asking', taskId, problem: null, questions: [], answers: [] })
  try {
    const q = await api.askTopicQuestions({ taskId, storyId, topic, asked: r.asked })
    if (runOf(storyId, topic).taskId !== taskId) return
    putRun(storyId, topic, { taskId: null, generationId: q.generationId ?? runOf(storyId, topic).generationId })
    if (q.status === 'stopped') return settleStopped(storyId, topic)
    if (q.status === 'error') return putRun(storyId, topic, { phase: 'idle', problem: { message: q.error ?? 'No questions came back. Please try again.', retry: 'ask' } })
    if (q.enough || !q.questions.length) {
      putRun(storyId, topic, { enough: true })
      if (hasAnswers(runOf(storyId, topic).asked)) return void suggest(storyId, topic)
      return putRun(storyId, topic, { phase: 'idle' })
    }
    putRun(storyId, topic, { phase: 'answering', questions: q.questions, answers: q.questions.map(() => '') })
  } catch (e) {
    if (runOf(storyId, topic).taskId === taskId) putRun(storyId, topic, { taskId: null, phase: 'idle', problem: { ...messageOf(e), retry: 'ask' } })
  }
}

/** After Stop: back to the suggestions when there are some, else to where the interview stands. */
function settleStopped(storyId: ID | null, topic: InterviewTopic): void {
  const r = runOf(storyId, topic)
  putRun(storyId, topic, { phase: r.entries.length || r.links.length ? 'review' : 'idle', questions: [], answers: [] })
}

export function setAnswer(storyId: ID | null, topic: InterviewTopic, index: number, text: string): void {
  putRun(storyId, topic, (r) => ({ answers: r.answers.map((a, i) => (i === index ? text : a)) }))
}

/** Answer: the round goes into the interview (empty boxes as skipped), and the next round is asked for. */
export function sendAnswers(storyId: ID | null, topic: InterviewTopic): void {
  const r = runOf(storyId, topic)
  if (r.phase !== 'answering') return
  putRun(storyId, topic, { asked: [...r.asked, ...roundAsked(r.questions, r.answers)], questions: [], answers: [] })
  void askMore(storyId, topic)
}

/** Skip these: every question of the round skipped, and new ones asked for. */
export function skipRound(storyId: ID | null, topic: InterviewTopic): void {
  const r = runOf(storyId, topic)
  if (r.phase !== 'answering') return
  putRun(storyId, topic, { asked: [...r.asked, ...roundAsked(r.questions, [])], questions: [], answers: [] })
  void askMore(storyId, topic)
}

/** Stop asking: what is typed counts, then the suggestions are made from every answer so far (or, with none, it closes). */
export function stopAsking(storyId: ID | null, topic: InterviewTopic): void {
  const r = runOf(storyId, topic)
  const asked = r.phase === 'answering' ? [...r.asked, ...roundAsked(r.questions, r.answers).filter((a) => !a.skipped)] : r.asked
  putRun(storyId, topic, { asked, questions: [], answers: [] })
  if (hasAnswers(asked)) return void suggest(storyId, topic)
  putRun(storyId, topic, { phase: r.entries.length || r.links.length ? 'review' : 'idle' })
  if (!r.entries.length && !r.links.length) putScope(storyId, { open: null })
}

/** Stop: the call on its way is stopped. */
export function stopCall(storyId: ID | null, topic: InterviewTopic): void {
  const r = runOf(storyId, topic)
  if (r.taskId) void api.stopTask(r.taskId).catch(() => undefined)
  putRun(storyId, topic, { taskId: null })
  settleStopped(storyId, topic)
}

export function dismissProblem(storyId: ID | null, topic: InterviewTopic): void {
  putRun(storyId, topic, { problem: null })
}

/** Try again: the call that went wrong, once more. */
export function retry(storyId: ID | null, topic: InterviewTopic): void {
  const p = runOf(storyId, topic).problem
  putRun(storyId, topic, { problem: null })
  if (p?.retry === 'suggest') void suggest(storyId, topic)
  else void askMore(storyId, topic)
}

// ---------- Suggestions ----------

/** The pages (or links) every answer so far suggests. Suggestions still to decide are replaced; what was kept stays kept. */
export async function suggest(storyId: ID | null, topic: InterviewTopic): Promise<void> {
  const r = runOf(storyId, topic)
  if (r.taskId) return
  const taskId = crypto.randomUUID()
  putRun(storyId, topic, { phase: 'suggesting', taskId, problem: null })
  try {
    const out = await api.suggestFromTopic({ taskId, storyId, topic, asked: r.asked })
    if (runOf(storyId, topic).taskId !== taskId) return
    putRun(storyId, topic, { taskId: null, generationId: out.generationId ?? runOf(storyId, topic).generationId })
    if (out.status === 'stopped') return settleStopped(storyId, topic)
    if (out.status === 'error') return putRun(storyId, topic, { phase: 'idle', problem: { message: out.error ?? 'Nothing came back. Please try again.', retry: 'suggest' } })
    putRun(storyId, topic, { phase: 'review', entries: out.entries, links: out.links, decisions: {} })
  } catch (e) {
    if (runOf(storyId, topic).taskId === taskId) putRun(storyId, topic, { taskId: null, phase: 'idle', problem: { ...messageOf(e), retry: 'suggest' } })
  }
}

/** Change: the suggestion as Adam changed it (the parts he changed become his). */
export function changeEntry(storyId: ID | null, topic: InterviewTopic, key: string, next: Partial<Pick<TopicEntry, 'name' | 'summary' | 'fields' | 'in' | 'rule'>>): void {
  putRun(storyId, topic, (r) => ({ entries: r.entries.map((e) => (e.key === key ? changedEntry(e, next) : e)) }))
}

export function changeLink(storyId: ID | null, topic: InterviewTopic, key: string, next: Partial<Pick<TopicLink, 'type' | 'feels' | 'otherFeels' | 'text'>>): void {
  putRun(storyId, topic, (r) => ({ links: r.links.map((l) => (l.key === key ? { ...l, ...next } : l)) }))
}

const decide = (storyId: ID | null, topic: InterviewTopic, key: string, d: Decision | null): void =>
  putRun(storyId, topic, (r) => {
    const decisions = { ...r.decisions }
    if (d) decisions[key] = d
    else delete decisions[key]
    return { decisions }
  })

/** Keep: the page made (or filled in), or the link made, in the world. Undo in its toast and on its row. */
export async function keep(storyId: ID | null, topic: InterviewTopic, key: string, opts: { quiet?: boolean } = {}): Promise<boolean> {
  const r = runOf(storyId, topic)
  if (r.decisions[key]) return false
  const entry = r.entries.find((e) => e.key === key)
  const link = r.links.find((l) => l.key === key)
  if (!entry && !link) return false
  try {
    const kept = await api.keepTopicSuggestion({ storyId, topic, ...(entry ? { entry } : { link }) })
    decide(storyId, topic, key, { status: 'kept', runId: kept.runId, entryId: kept.entryId })
    void loadProgress(storyId)
    if (!opts.quiet) {
      const what = entry ? (entry.existing ? `Added to “${kept.name}”.` : `Kept “${kept.name}” in your world.`) : 'Kept the link in your world.'
      toast(what, { action: { label: 'Undo', run: () => void undoKeep(storyId, topic, key) } })
    }
    return true
  } catch (e) {
    toast(messageOf(e).message, { tone: 'danger' })
    return false
  }
}

/** Keep all: every suggestion still to decide, in order, with one Undo for them all. */
export async function keepAll(storyId: ID | null, topic: InterviewTopic): Promise<void> {
  const r = runOf(storyId, topic)
  const keys = [...r.entries.map((e) => e.key), ...r.links.map((l) => l.key)].filter((k) => !r.decisions[k])
  const done: string[] = []
  for (const k of keys) if (await keep(storyId, topic, k, { quiet: true })) done.push(k)
  if (done.length)
    toast(`Kept ${done.length} in your world.`, {
      action: {
        label: 'Undo',
        run: () => {
          for (const k of [...done].reverse()) void undoKeep(storyId, topic, k, { quiet: true })
        }
      }
    })
}

/** Undo a Keep: what it made goes again, and the suggestion is back to decide. */
export async function undoKeep(storyId: ID | null, topic: InterviewTopic, key: string, opts: { quiet?: boolean } = {}): Promise<void> {
  const d = runOf(storyId, topic).decisions[key]
  if (d?.status !== 'kept') return
  try {
    await api.undoWorldBuild(d.runId)
    decide(storyId, topic, key, null)
    void loadProgress(storyId)
    if (!opts.quiet) toast('Taken out of your world again.')
  } catch (e) {
    toast(messageOf(e).message, { tone: 'danger' })
  }
}

/** Discard: it goes from the list; Undo in its toast brings it back. */
export function discard(storyId: ID | null, topic: InterviewTopic, key: string): void {
  if (runOf(storyId, topic).decisions[key]) return
  decide(storyId, topic, key, { status: 'discarded' })
  toast('Discarded.', { action: { label: 'Undo', run: () => decide(storyId, topic, key, null) } })
}
