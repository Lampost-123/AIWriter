// What Quick start holds between visits to the builder, one for each kind in each world: the notes
// Adam hasn't built from yet, and a build still running. A build keeps going (and saving) when he
// leaves the screen, so coming back shows it, with Stop, rather than an empty screen inviting him to
// build the same thing twice. The screen itself is made afresh each time the builder opens.
import { create } from 'zustand'
import type { BuilderDone, BuilderKind, BuilderProgress, BuilderStart, QuickAnswer } from '@shared/contracts/builder'
import type { ID } from '@shared/types'
import { toast, useToasts } from '@/components/ui'
import { api, ApiError, onEvent } from '@/lib/api'
import { useApp } from '@/lib/store'
import { arrivalOrder, notesToOfferBack } from './builderLogic'

export type QuickView = Pick<BuilderProgress, 'values' | 'fromNotes' | 'writing' | 'entryId'>
export const EMPTY_VIEW: QuickView = { values: {}, fromNotes: [], writing: null, entryId: null }

export interface Problem {
  message: string
  code?: string
}

/** Adam's reply to one follow-up question: his words, null for "Let the AI decide", or SKIP. */
export const SKIP: false = false
export type QuickReply = string | null | false

/**
 * The follow-up questions after the notes: asked once the notes are in, answered one at a time, then built from with
 * the notes. While it is open the notes can't be typed in (Change my notes goes back to them).
 */
export interface QuickChat {
  /** The questions being asked now, if they are still arriving. */
  jobId: ID | null
  questions: string[]
  /** His replies, in order (one for each question answered so far). */
  replies: QuickReply[]
  retrying: string | null
  problem: Problem | null
}

export interface QuickSession {
  notes: string
  /** The scene the notes came from, while they are a passage Adam selected there. */
  sceneId: ID | null
  /** The build running now, if any. */
  jobId: ID | null
  /** Plain words while a busy service is being tried again. */
  retrying: string | null
  /** The build is finishing the rest of one that stopped part way. */
  finishing: boolean
  /** The profile as it has arrived. */
  view: QuickView
  /** Its fields in the order they first arrived, so the profile only grows at the end. */
  order: string[]
  /** How the last build ended, until the next one starts. */
  done: BuilderDone | null
  problem: Problem | null
  /** The follow-up questions, while they are open. */
  chat: QuickChat | null
  /** The build came from the questions: once it is built, the builder opens at Review. */
  review: boolean
}

const fresh = (notes = '', sceneId: ID | null = null): QuickSession => ({
  notes,
  sceneId,
  jobId: null,
  retrying: null,
  finishing: false,
  view: EMPTY_VIEW,
  order: [],
  done: null,
  problem: null,
  chat: null,
  review: false
})

export const useQuickStart = create<{ sessions: Record<string, QuickSession> }>(() => ({ sessions: {} }))

/** The session's key: its kind, in the world that is open. */
export const sessionKey = (worldId: ID | null | undefined, kind: BuilderKind): string => `${worldId ?? ''}:${kind}`
const keyOf = (kind: BuilderKind): string => sessionKey(useApp.getState().world?.id, kind)

const get = (key: string): QuickSession | undefined => useQuickStart.getState().sessions[key]
const put = (key: string, patch: Partial<QuickSession>): void =>
  useQuickStart.setState((st) => ({ sessions: { ...st.sessions, [key]: { ...(st.sessions[key] ?? fresh()), ...patch } } }))

function findChat(jobId: ID): [string, QuickChat] | null {
  for (const [key, s] of Object.entries(useQuickStart.getState().sessions)) if (s.chat?.jobId === jobId) return [key, s.chat]
  return null
}
const putChat = (key: string, patch: Partial<QuickChat>): void => {
  const chat = get(key)?.chat
  if (chat) put(key, { chat: { ...chat, ...patch } })
}

function findJob(jobId: ID): [string, QuickSession] | null {
  for (const [key, s] of Object.entries(useQuickStart.getState().sessions)) if (s.jobId === jobId) return [key, s]
  return null
}

let listening = false
/** Follows Quick start's builds for as long as the window is open, whichever screen is showing. */
function listen(): void {
  if (listening) return
  listening = true
  onEvent('builder:progress', (p) => {
    const asking = findChat(p.jobId)
    if (asking) putChat(asking[0], { questions: p.options, retrying: null })
    const found = findJob(p.jobId)
    if (found) put(found[0], { view: p, order: arrivalOrder(found[1].order, p.values), retrying: null })
  })
  onEvent('builder:retrying', (p) => {
    const asking = findChat(p.jobId)
    if (asking) putChat(asking[0], { retrying: p.reason })
    const found = findJob(p.jobId)
    if (found) put(found[0], { retrying: p.reason })
  })
  onEvent('builder:done', (d) => {
    const asking = findChat(d.jobId)
    if (asking) {
      // No questions at all (stopped first, or none came): straight on to building, nothing lost.
      const problem = d.status === 'error' && d.error ? { message: d.error } : null
      putChat(asking[0], { jobId: null, retrying: null, questions: d.options, problem })
    }
    const found = findJob(d.jobId)
    if (!found) return
    put(found[0], {
      jobId: null,
      retrying: null,
      finishing: false,
      view: d,
      order: arrivalOrder(found[1].order, d.values),
      done: d,
      problem: d.status === 'error' && d.error ? { message: d.error } : null
    })
  })
}

/**
 * The builder opened for a new entry: a build still running shows as it is, and so does one that
 * stopped part way (to finish the rest), while notes not built from yet are still there. A finished
 * build is done with, so the screen starts afresh. A passage Adam has just selected replaces what was
 * there (a build running meanwhile goes on saving), and notes he hadn't built from are one click away.
 */
export function openQuickStart(kind: BuilderKind, start: BuilderStart | undefined): void {
  listen()
  const key = keyOf(kind)
  const s = get(key)
  if (start?.notes) {
    put(key, fresh(start.notes, start.sceneId ?? null))
    if (s && notesToOfferBack(s, start.notes)) offerNotesBack(key, s)
    return
  }
  if (s?.jobId || (s?.done?.entryId && s.done.status === 'error')) return
  if (!s || s.done?.entryId) return put(key, fresh())
  put(key, { done: null, problem: null, view: EMPTY_VIEW, order: [], review: false })
}

// The toast offering back the notes a passage replaced, while it shows.
let notesBack: number | null = null
const dropNotesBack = (): void => {
  if (notesBack !== null) useToasts.getState().dismiss(notesBack)
  notesBack = null
}

/** A passage replaced notes Adam typed and hadn't built from: Undo puts them back, until he builds from the passage. */
function offerNotesBack(key: string, was: QuickSession): void {
  dropNotesBack()
  notesBack = toast('Your earlier notes were replaced by the passage.', {
    action: {
      label: 'Undo',
      run: () => {
        notesBack = null
        const now = get(key)
        if (now && !now.jobId && !now.done) put(key, { notes: was.notes, sceneId: was.sceneId, problem: null })
      }
    }
  })
}

export function setQuickNotes(kind: BuilderKind, notes: string): void {
  const key = keyOf(kind)
  put(key, { notes, problem: get(key)?.jobId ? get(key)?.problem : null })
}

/**
 * Builds the whole profile from the notes, or (`finish`) fills in the empty fields of the one the
 * last build saved before it stopped part way.
 */
export async function buildQuickStart(
  kind: BuilderKind,
  storyId: ID | null,
  opts: { finish?: boolean; answers?: QuickAnswer[] } = {}
): Promise<void> {
  const key = keyOf(kind)
  const s = get(key) ?? fresh()
  if (s.jobId) return
  const entryId = opts.finish ? s.view.entryId : null
  if (!s.notes.trim()) {
    const who = kind === 'character' || kind === 'group' ? 'them' : 'it'
    put(key, { problem: { message: `Type or paste something about ${who} first. One line is enough.` } })
    return
  }
  const jobId = crypto.randomUUID()
  dropNotesBack()
  // Finishing keeps the profile on screen as it is; what arrives goes at the end.
  put(key, { jobId, retrying: null, finishing: !!entryId, done: null, problem: null, ...(entryId ? {} : { view: EMPTY_VIEW, order: [] }) })
  try {
    await api.startQuickStart({ jobId, kind, notes: s.notes, storyId, sceneId: s.sceneId, entryId, answers: opts.answers })
  } catch (e) {
    if (get(key)?.jobId !== jobId) return
    const problem = { message: (e as Error).message, code: e instanceof ApiError ? e.code : undefined }
    // A finish that couldn't start leaves what is saved as it was on screen, with Finish the rest to try again.
    put(key, { jobId: null, finishing: false, problem, ...(entryId ? { done: s.done } : {}) })
  }
}

/** Stops the build; what has fully arrived is kept and saved. */
export function stopQuickStart(kind: BuilderKind): void {
  const jobId = get(keyOf(kind))?.jobId
  if (jobId) void api.stopBuilder(jobId).catch(() => undefined)
}

/** Starts again with empty notes, no longer from a passage. */
export function startAnotherQuickStart(kind: BuilderKind): void {
  const key = keyOf(kind)
  if (get(key)?.jobId) return
  dropNotesBack()
  put(key, fresh())
}

// ---------- Follow-up questions ----------

/** Asks the AI's follow-up questions about the notes (the next step after them). */
export async function askQuestions(kind: BuilderKind, storyId: ID | null): Promise<void> {
  const key = keyOf(kind)
  const s = get(key) ?? fresh()
  if (s.jobId || s.chat?.jobId) return
  if (!s.notes.trim()) {
    const who = kind === 'character' || kind === 'group' ? 'them' : 'it'
    put(key, { problem: { message: `Type or paste something about ${who} first. One line is enough.` } })
    return
  }
  const jobId = crypto.randomUUID()
  dropNotesBack()
  put(key, { problem: null, done: null, view: EMPTY_VIEW, order: [], chat: { jobId, questions: [], replies: [], retrying: null, problem: null } })
  try {
    await api.startQuestions({ jobId, kind, notes: s.notes, storyId, sceneId: s.sceneId })
  } catch (e) {
    if (get(key)?.chat?.jobId !== jobId) return
    putChat(key, { jobId: null, problem: { message: (e as Error).message, code: e instanceof ApiError ? e.code : undefined } })
  }
}

/** Adam's reply to the next question: his words, null to let the AI decide, or SKIP. */
export function replyToQuestion(kind: BuilderKind, reply: QuickReply): void {
  const key = keyOf(kind)
  const chat = get(key)?.chat
  if (!chat || chat.replies.length >= chat.questions.length) return
  const words = typeof reply === 'string' ? reply.trim() : reply
  putChat(key, { replies: [...chat.replies, words === '' ? SKIP : words] })
}

/** Takes back the last reply, to answer it again. */
export function undoReply(kind: BuilderKind): void {
  const key = keyOf(kind)
  const chat = get(key)?.chat
  if (chat?.replies.length && !get(key)?.jobId) putChat(key, { replies: chat.replies.slice(0, -1) })
}

/** Skips every question still to come. */
export function skipTheRest(kind: BuilderKind): void {
  const key = keyOf(kind)
  const chat = get(key)?.chat
  if (chat && !chat.jobId) putChat(key, { replies: [...chat.replies, ...chat.questions.slice(chat.replies.length).map((): QuickReply => SKIP)] })
}

/** Back to the notes (stops questions still arriving). */
export function backToNotes(kind: BuilderKind): void {
  const key = keyOf(kind)
  const s = get(key)
  if (!s || s.jobId) return
  if (s.chat?.jobId) void api.stopBuilder(s.chat.jobId).catch(() => undefined)
  put(key, { chat: null, review: false, problem: null })
}

/** The answers to send with the notes: each question answered or left to the AI (skipped ones left out). */
export function answersOf(chat: Pick<QuickChat, 'questions' | 'replies'>): QuickAnswer[] {
  const out: QuickAnswer[] = []
  chat.questions.forEach((question, i) => {
    const r = chat.replies[i]
    if (r === undefined || r === SKIP) return
    out.push({ question, answer: r })
  })
  return out
}

/** Builds from the notes and the answers; once built, the builder opens at Review. */
export async function buildFromQuestions(kind: BuilderKind, storyId: ID | null): Promise<void> {
  const key = keyOf(kind)
  const chat = get(key)?.chat
  if (!chat || chat.jobId) return
  put(key, { review: true })
  await buildQuickStart(kind, storyId, { answers: answersOf(chat) })
}
