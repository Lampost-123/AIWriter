// "Interview me" on the World builder page: the AI asks one short question at a time about what the
// summary is missing or thin on (one request per question, reading the summary as it stands), and Adam
// answers, skips or stops. An answer goes into the summary at once, in his own words under the question's
// topic, with no AI call (interviewLogic.ts), and is kept as the summary always is (setWorldSummary); a
// toast's Undo takes the last one out. Nothing else about an interview is stored: it ends when he stops,
// leaves the page or starts a build. Owned by the World builder part.

import { create } from 'zustand'
import type { WorldInterviewAsked } from '@shared/contracts/worldBuilder'
import type { ID } from '@shared/types'
import { toast, useToasts } from '@/components/ui'
import { api, ApiError } from '@/lib/api'
import { registerDiscarder, registerFlusher } from '@/lib/flush'
import { setWorldSummary, useWorldBuilder, type Problem } from './worldBuilderStore'
import { withAnswer, withoutAnswer } from './interviewLogic'

export interface InterviewSession {
  open: boolean
  /** The world it is for. */
  worldId: ID | null
  /** 'asking' while the next question is on its way; 'question' while it waits for an answer; 'problem' when asking failed. */
  phase: 'asking' | 'question' | 'problem'
  /** The question on its way (Stop stops it). */
  taskId: ID | null
  topic: string
  question: string
  /** The answer box. */
  answer: string
  /** Questions asked so far, oldest first. */
  asked: WorldInterviewAsked[]
  /** Answers added to the summary in this interview (less any undone). */
  added: number
  problem: Problem | null
}

const closed: InterviewSession = {
  open: false,
  worldId: null,
  phase: 'asking',
  taskId: null,
  topic: '',
  question: '',
  answer: '',
  asked: [],
  added: 0,
  problem: null
}

export const useInterview = create<InterviewSession>(() => closed)

const get = useInterview.getState
const set = useInterview.setState

/** Starts an interview about the summary as it stands, or carries on with the one open. */
export function startInterview(): void {
  const wb = useWorldBuilder.getState()
  if (get().open || wb.running || !wb.worldId) return
  set({ ...closed, open: true, worldId: wb.worldId })
  void askNext()
}

/** Asks for the next question. A reply to a question that was stopped or replaced is dropped. */
async function askNext(): Promise<void> {
  const s = get()
  if (!s.open) return
  const taskId = crypto.randomUUID()
  set({ phase: 'asking', taskId, topic: '', question: '', problem: null })
  const still = (): boolean => get().open && get().taskId === taskId
  try {
    const q = await api.askWorldQuestion({ taskId, summary: useWorldBuilder.getState().summary, asked: s.asked })
    if (!still()) return
    if (q.status === 'complete') set({ phase: 'question', taskId: null, topic: q.topic, question: q.question })
    else if (q.status === 'error')
      set({ phase: 'problem', taskId: null, problem: { message: q.error ?? 'Something went wrong. Try again.' } })
    // Stopped without Stop (the world closed): the interview ends.
    else set(closed)
  } catch (e) {
    if (!still()) return
    set({ phase: 'problem', taskId: null, problem: { message: (e as Error).message, code: e instanceof ApiError ? e.code : undefined } })
  }
}

/** Asks again after a question couldn't be asked. */
export function retryQuestion(): void {
  if (get().open && get().phase === 'problem') void askNext()
}

export function setInterviewAnswer(answer: string): void {
  set({ answer })
}

/** The toast for the last answer added, while it may still show: only the latest one has Undo. */
let answerToast: number | null = null

/** Adds the typed answer to the summary, with a toast whose Undo takes it out again. False when there was nothing to add. */
function addAnswer(): boolean {
  const s = get()
  const wb = useWorldBuilder.getState()
  if (s.phase !== 'question' || !s.answer.trim() || wb.worldId !== s.worldId || wb.running) return false
  const before = wb.summary
  const { summary: after, added } = withAnswer(before, s.topic, s.answer)
  if (!added) return false
  setWorldSummary(after)
  const index = s.asked.length
  set({ answer: '', added: s.added + 1, asked: [...s.asked, { topic: s.topic, question: s.question, skipped: false, answer: s.answer.trim() }] })
  if (answerToast != null) useToasts.getState().dismiss(answerToast)
  const id = toast('Answer added to your summary.', {
    action: { label: 'Undo', run: () => undoAnswer(id, s.worldId, index, { before, after, added }) }
  })
  answerToast = id
  return true
}

function undoAnswer(id: number, worldId: ID | null, index: number, change: { before: string; after: string; added: string }): void {
  if (answerToast === id) answerToast = null
  const wb = useWorldBuilder.getState()
  if (wb.worldId !== worldId || wb.running) return
  const restored = withoutAnswer(wb.summary, change)
  if (restored == null) {
    toast('Couldn’t take that answer out: your summary has changed there since. You can edit it by hand.')
    return
  }
  setWorldSummary(restored)
  // Still interviewing: the answer no longer counts, and its question isn't asked again.
  const s = get()
  if (s.open && s.worldId === worldId && s.asked[index]) {
    set({ added: Math.max(0, s.added - 1), asked: s.asked.map((a, i) => (i === index ? { topic: a.topic, question: a.question, skipped: true } : a)) })
  }
}

/** Adds the answer to the summary and asks the next question. */
export function answerQuestion(): void {
  if (addAnswer()) void askNext()
}

/** Leaves this question unanswered (its topic isn't asked about again) and asks the next one. */
export function skipQuestion(): void {
  const s = get()
  if (!s.open || s.phase !== 'question') return
  set({ answer: '', asked: [...s.asked, { topic: s.topic, question: s.question, skipped: true }] })
  void askNext()
}

/** Ends the interview. An answer typed but not yet added is added first, so nothing he wrote is lost. */
export function stopInterview(): void {
  const s = get()
  if (!s.open) return
  addAnswer()
  set(closed)
  if (s.taskId) void api.stopTask(s.taskId).catch(() => undefined)
}

// Before the window closes or the world changes, an answer typed but not yet added goes into the summary and is kept.
registerFlusher(async () => {
  if (!get().open || !addAnswer()) return
  const wb = useWorldBuilder.getState()
  try {
    await api.saveWorldSummary(wb.summary)
  } catch {
    // The summary's own keeping says if it can't be kept.
  }
})
// After a backup is restored, the interview was about a summary that may no longer be there.
registerDiscarder(() => {
  const s = get()
  set(closed)
  if (s.taskId) void api.stopTask(s.taskId).catch(() => undefined)
})
