// Talking a plan over with the AI (the Story builder, 2026-10-17): the outline's suggestions, the codex list or a
// recipe. One talk for each thing talked over (`scope`), kept while the app is open. Adam says what he wants; the AI
// answers, and when it changed anything its revision waits as a preview he applies or declines: nothing changes by
// itself. Each answer is one AI call (a task) that can be stopped. The talks' own words are never saved.

import { create } from 'zustand'
import type { ChatTurn } from '@shared/contracts/storyBuilder'
import type { ID } from '@shared/types'
import { api, onEvent } from '@/lib/api'
import { claimsChange, NO_CHANGE, settleTalk } from './talkTruth'

export interface TalkTurn extends ChatTurn {
  /**
   * An answer that came with a revision: what Adam did with it ('offered' while it waits; 'revised' when the next answer
   * built on it instead).
   */
  outcome?: 'offered' | 'applied' | 'declined' | 'revised'
  /** What the revision changed, a few words each ("Scene: The Health Check"), shown under the answer. */
  changes?: string[]
  /**
   * The answer's outcome was recorded when it came (chat-truth R1): it shows the outcome line. An answer without it has
   * no line rather than a wrong one.
   */
  recorded?: boolean
  /** Why nothing changed, when a change was tried and didn't come through ("the parts it named aren't in the plan"). */
  reason?: string
  /** The request, when it was for what this talk can't change (the story's own chapters): offered to Ask instead. */
  handOff?: string
}

export interface Talk {
  turns: TalkTurn[]
  /**
   * The answer arriving now (its words so far, for a streamed one); `live`: the AI call running for it now, when another
   * (asking again for changes it left out), and `note`: what that one is doing.
   */
  running: { taskId: ID; text: string; live?: ID; note?: string } | null
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
  /** What the revision changed, for the chips under the answer. */
  changes?: string[]
  /** Why nothing changed, when a change was tried (plain words after "Nothing was changed: "). */
  reason?: string | null
  /** The request, when it was for what this talk can't change: offered to Ask instead (the outcome line says so). */
  handOff?: string | null
}

/** What the AI is told about each of its own answers: whether a change came with it, so it never thinks one did when not. */
const NOTES: Record<NonNullable<TalkTurn['outcome']> | 'none', string> = {
  offered: '[Changes sent; not applied yet.]',
  revised: '[Changes sent; the next answer built on them.]',
  applied: '[Changes sent; the author applied them.]',
  declined: '[Changes sent; the author declined them.]',
  none: '[No changes sent with this answer, so nothing changed.]'
}

/** A note like those, if the AI copied one into its answer. */
const COPIED = /\s*\[(?:No changes|Changes) sent[^\]]*\]\s*$/i

/** The turns as the AI is told them (the last 12), each answer with its note. */
const historyOf = (turns: TalkTurn[]): ChatTurn[] =>
  turns.slice(-12).map(({ role, text, outcome, changes }) => ({
    role,
    text: role === 'assistant' ? `${text}\n${changes?.length ? NOTES[outcome ?? 'none'].replace(/\]$/, ` (${changes.join('; ')})]`) : NOTES[outcome ?? 'none']}` : text
  }))

/** The AI call running now for a talk's answer, when it isn't the first (asking again for the changes it forgot). */
export function relay(scope: string, taskId: ID, live: ID, note?: string): void {
  const r = talkOf(scope).running
  if (r?.taskId === taskId) put(scope, { running: { ...r, live, note } })
}

/** Try again after an error: the last thing said, taken back off the talk so saying it again doesn't show it twice. */
export function takeBackLast(scope: string): string | null {
  const t = talkOf(scope)
  const last = t.turns[t.turns.length - 1]
  if (t.running || last?.role !== 'user') return null
  put(scope, { turns: t.turns.slice(0, -1), error: null })
  return last.text
}

/**
 * Says something in a talk: `ask` makes the AI call with the task id and the talk so far, and resolves with its answer
 * (null when it was stopped). A revision waits as the preview. `carry`: a preview still waiting is built on, not
 * declined (the caller reads it before saying). `applyLabel`: the words on the button that makes a waiting change.
 */
export async function say(
  scope: string,
  message: string,
  ask: (taskId: ID, history: ChatTurn[]) => Promise<Answer | null>,
  carry = false,
  applyLabel = 'Apply'
): Promise<void> {
  const words = message.trim()
  const t = talkOf(scope)
  if (!words || t.running) return
  const taskId = crypto.randomUUID()
  const history = historyOf(t.turns)
  // A preview still waiting is declined by saying something else (or built on, with `carry`).
  const turns = t.turns.map((x) => (x.outcome === 'offered' ? { ...x, outcome: carry && t.preview ? ('revised' as const) : ('declined' as const) } : x))
  put(scope, { turns: [...turns, { role: 'user', text: words }], running: { taskId, text: '' }, preview: null, error: null })
  try {
    const out = await ask(taskId, history)
    if (talkOf(scope).running?.taskId !== taskId) return
    if (!out) {
      put(scope, { running: null })
      return
    }
    const said = out.answer.replace(COPIED, '').trim()
    const changed = !!out.revision
    // A claim of a change with none sent says why in the outcome line; the words are put right by the shared check.
    const reason = changed ? null : (out.reason ?? (claimsChange(said) ? NO_CHANGE.notSent : null))
    const answer = settleTalk(said, changed, applyLabel) || (changed ? 'Here it is with those changes.' : reason ? 'That didn’t come through. Please ask again.' : '…')
    const turn: TalkTurn = {
      role: 'assistant',
      text: answer,
      recorded: true,
      ...(changed ? { outcome: 'offered' as const, ...(out.changes?.length ? { changes: out.changes } : {}) } : {}),
      ...(reason ? { reason } : {}),
      ...(!changed && out.handOff ? { handOff: out.handOff } : {})
    }
    put(scope, {
      running: null,
      turns: [...talkOf(scope).turns, turn],
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
  if (r?.taskId === taskId) put(scope, { running: { ...r, text } })
}

export function stopTalk(scope: string): void {
  const r = talkOf(scope).running
  if (r) void api.stopTask(r.live ?? r.taskId).catch(() => undefined)
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
