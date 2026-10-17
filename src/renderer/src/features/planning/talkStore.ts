// Talking a plan over with the AI (the Story builder, 2026-10-17): the outline's suggestions, the codex list or a
// recipe. One talk for each thing talked over (`scope`), kept while the app is open. Adam says what he wants; the AI
// answers, and when it changed anything its revision waits as a preview he applies or declines: nothing changes by
// itself. Each answer is one AI call (a task) that can be stopped. The talks' own words are never saved.

import { create } from 'zustand'
import type { ChatTurn } from '@shared/contracts/storyBuilder'
import type { ID } from '@shared/types'
import { api, onEvent } from '@/lib/api'

export interface TalkTurn extends ChatTurn {
  /** An answer that came with a revision: what Adam did with it ('offered' while it waits). */
  outcome?: 'offered' | 'applied' | 'declined'
}

export interface Talk {
  turns: TalkTurn[]
  /** The answer arriving now (its words so far, for a streamed one). */
  running: { taskId: ID; text: string } | null
  /** The revision waiting for Apply or Decline (what it is depends on what is talked over). */
  preview: unknown
  error: string | null
}

const fresh = (): Talk => ({ turns: [], running: null, preview: null, error: null })

export const useTalks = create<{ talks: Record<string, Talk> }>(() => ({ talks: {} }))

export const talkOf = (scope: string): Talk => useTalks.getState().talks[scope] ?? fresh()
const put = (scope: string, patch: Partial<Talk>): void =>
  useTalks.setState((s) => ({ talks: { ...s.talks, [scope]: { ...(s.talks[scope] ?? fresh()), ...patch } } }))

/** What a talk's answer brings: the answer's words, and the revision (null when it only answered). */
export interface Answer {
  answer: string
  revision: unknown
}

/** The turns as the AI is told them (the last 12; a preview's state isn't sent). */
const historyOf = (turns: TalkTurn[]): ChatTurn[] => turns.slice(-12).map(({ role, text }) => ({ role, text }))

/**
 * Says something in a talk: `ask` makes the AI call with the task id and the talk so far, and resolves with its answer
 * (null when it was stopped). A revision waits as the preview.
 */
export async function say(scope: string, message: string, ask: (taskId: ID, history: ChatTurn[]) => Promise<Answer | null>): Promise<void> {
  const words = message.trim()
  const t = talkOf(scope)
  if (!words || t.running) return
  const taskId = crypto.randomUUID()
  const history = historyOf(t.turns)
  // A preview still waiting is declined by saying something else.
  const turns = t.turns.map((x) => (x.outcome === 'offered' ? { ...x, outcome: 'declined' as const } : x))
  put(scope, { turns: [...turns, { role: 'user', text: words }], running: { taskId, text: '' }, preview: null, error: null })
  try {
    const out = await ask(taskId, history)
    if (talkOf(scope).running?.taskId !== taskId) return
    if (!out) {
      put(scope, { running: null })
      return
    }
    const answer = out.answer.trim() || (out.revision ? 'Here it is with those changes.' : '…')
    put(scope, {
      running: null,
      turns: [...talkOf(scope).turns, { role: 'assistant', text: answer, ...(out.revision ? { outcome: 'offered' as const } : {}) }],
      preview: out.revision ?? null
    })
  } catch (e) {
    if (talkOf(scope).running?.taskId !== taskId) return
    put(scope, { running: null, error: (e as Error).message || 'That didn’t work. Please try again.' })
  }
}

/** The answer's words so far, while it streams. */
export function arriving(scope: string, taskId: ID, text: string): void {
  const r = talkOf(scope).running
  if (r?.taskId === taskId) put(scope, { running: { taskId, text } })
}

export function stopTalk(scope: string): void {
  const r = talkOf(scope).running
  if (r) void api.stopTask(r.taskId).catch(() => undefined)
}

/** Apply or Decline on the preview: the answer that offered it says which. */
export function settlePreview(scope: string, outcome: 'applied' | 'declined'): void {
  const t = talkOf(scope)
  const turns = [...t.turns]
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].outcome === 'offered') {
      turns[i] = { ...turns[i], outcome }
      break
    }
  }
  put(scope, { turns, preview: null })
}

export function clearTalk(scope: string): void {
  stopTalk(scope)
  put(scope, fresh())
}

export function dismissTalkError(scope: string): void {
  put(scope, { error: null })
}

// ---------- Streamed answers (task events) ----------

const streams = new Map<ID, { onText: (text: string) => void; done: (d: { status: string; text: string; error: string | null }) => void }>()
let listening = false

function listen(): void {
  if (listening) return
  listening = true
  onEvent('task:progress', (p) => streams.get(p.taskId)?.onText(p.text))
  onEvent('task:done', (d) => {
    const s = streams.get(d.taskId)
    if (!s) return
    streams.delete(d.taskId)
    s.done({ status: d.status, text: d.text, error: d.error ?? null })
  })
}

/**
 * Follows one streamed AI call: `start` begins it (with the task id), `onText` hears its words as they arrive, and it
 * resolves with how it ended. Throws (plain words) when it couldn't start.
 */
export async function followTask(
  taskId: ID,
  start: () => Promise<unknown>,
  onText: (text: string) => void
): Promise<{ status: string; text: string; error: string | null }> {
  listen()
  const ended = new Promise<{ status: string; text: string; error: string | null }>((resolve) => streams.set(taskId, { onText, done: resolve }))
  try {
    await start()
  } catch (e) {
    streams.delete(taskId)
    throw e
  }
  return ended
}
