// Ask the world's conversation, kept while the app runs (the panel can close and open again, and the
// answer keeps arriving meanwhile). Each story has its own chats; the one on show is the story's most
// recent when the panel first shows that story. Answers stream in as task events, matched by the task
// id this side makes. Saved notes are remembered, so an answer shows "Saved": this session's here, and
// each turn's record keeps its own (read back when a chat is opened after a restart).
import { create } from 'zustand'
import type { AskInput, AskTurn, ChatSummary, ProposalStatus, SavedNote } from '@shared/contracts/ask'
import type { ID } from '@shared/types'
import { api, ApiError, onEvent } from '@/lib/api'
import { editorBridge } from '@/lib/editorBridge'
import { registerDiscarder } from '@/lib/flush'
import { pickQuestion } from './askChoice'
import { endedCalls, withCall } from './toolView'

/** A turn as the panel shows it. */
export interface ShownTurn extends AskTurn {
  /** The task writing its answer, while this session asked it. */
  taskId?: ID
  /** Nothing could be sent (no model set up, say): what went wrong, in plain words. */
  problem?: { message: string; code?: string }
  /** How it was asked this session ("Edit this", the words quoted), so Try again asks the same way. */
  sentWith?: AskHow
  /** When it was asked and when its answer ended (ms), this session: the steps row says how long it took. */
  startedAt?: number
  endedAt?: number
}

/** How a question is asked, beside its words: "Edit this" (mode 'edit'), and the selection it quotes. */
export type AskHow = Pick<AskInput, 'mode' | 'selection'>

/** Words selected in the page, quoted in the box by Ask about this or Edit this (the box shows the quote itself). */
export interface BoxQuote {
  /** The words as quoted in the box. */
  text: string
  /** Their paragraphs' ids, when known. */
  pids: string[]
  /** "Edit this": the question asks for a change to them. Null: Ask about this (the question's words decide). */
  mode: 'edit' | null
}

export interface Running {
  taskId: ID
  /** Stop was pressed: the answer stops as soon as it has started. */
  stopping: boolean
  /** Why the provider is being asked again ("OpenRouter is busy"), while it is. */
  retrying: string | null
}

interface AskState {
  /** The world and story whose chats are shown ("world-id:story-id"); null before the first. */
  storyKey: string | null
  /** The story's chats are being read. */
  loading: boolean
  /** Couldn't read them (plain words). */
  loadError: string | null
  /** The chat on show; null for a new one with nothing asked yet. */
  chatId: ID | null
  turns: ShownTurn[]
  /** The story's chats, the most recent first. */
  chats: ChatSummary[]
  running: Running | null
  /** Notes saved from answers this session, by the answer's record. */
  saved: Record<ID, SavedNote>
  /** What is typed in the box, kept while the panel is closed. */
  draft: string
  /** The selection quoted in the box, while it is (it goes with the question that quotes it). */
  quote: BoxQuote | null
  /** Moves each time the box should take the keyboard (Ask opened from the top bar or the palette). */
  focusRequest: number
}

const initial = {
  storyKey: null,
  loading: false,
  loadError: null,
  chatId: null,
  turns: [],
  chats: [],
  running: null,
  saved: {}
} satisfies Partial<AskState>

export const useAsk = create<AskState>(() => ({ ...initial, draft: '', quote: null, focusRequest: 0 }))

const get = useAsk.getState
const set = useAsk.setState

/** Where a question is asked from: the open story and scene. */
export interface AskPlace {
  worldId: ID | null
  storyId: ID | null
  sceneId: ID | null
}

const keyOf = (p: Pick<AskPlace, 'worldId' | 'storyId'>): string => `${p.worldId ?? ''}:${p.storyId ?? ''}`

const errorOf = (e: unknown): { message: string; code?: string } => ({
  message: (e as Error)?.message || 'Something went wrong. Try again.',
  code: e instanceof ApiError ? e.code : undefined
})

/**
 * Changes the turn its task is writing: found by the task (asked this session), or by its record (a chat
 * opened again while its answer was still finishing, which then finishes on screen too).
 */
function updateTask(taskId: ID, fn: (t: ShownTurn) => ShownTurn, generationId?: ID): void {
  const turns = get().turns
  const i = turns.findIndex((t) => t.taskId === taskId || (!!generationId && t.generationId === generationId))
  if (i < 0) return
  const next = turns.slice()
  next[i] = fn(turns[i])
  set({ turns: next })
}

// ---------- The answers as they arrive ----------

let listening = false

function listen(): void {
  if (listening) return
  listening = true
  onEvent('task:progress', (p) => {
    if (p.job !== 'chat') return
    updateTask(p.taskId, (t) => ({ ...t, generationId: p.generationId, answer: p.text }), p.generationId)
    const r = get().running
    if (r?.taskId === p.taskId && r.retrying) set({ running: { ...r, retrying: null } })
  })
  onEvent('task:retrying', (p) => {
    const r = get().running
    if (r?.taskId === p.taskId) set({ running: { ...r, retrying: p.reason } })
  })
  // The editor chat: what it looks up on the way, and the changes it proposes, as they happen.
  onEvent('ask:step', (p) => {
    updateTask(p.taskId, (t) => ({ ...t, steps: [...(t.steps ?? []), p.label] }), p.generationId || undefined)
  })
  // Each tool call as it starts (running) and ends (chat Phase 2b's tool rows).
  onEvent('ask:tool', (p) => {
    updateTask(p.taskId, (t) => ({ ...t, tools: withCall(t.tools, p.call) }), p.generationId || undefined)
  })
  onEvent('ask:proposals', (p) => {
    updateTask(p.taskId, (t) => ({ ...t, proposals: p.proposals }), p.generationId || undefined)
  })
  // The chat asked a question with options (ask_user): its buttons show as soon as it does.
  onEvent('ask:choice', (p) => {
    updateTask(p.taskId, (t) => ({ ...t, choice: p.choice }), p.generationId || undefined)
  })
  onEvent('task:done', (p) => {
    if (p.job !== 'chat') return
    const shown = get().turns.find((t) => t.taskId === p.taskId || t.generationId === p.generationId)
    updateTask(
      p.taskId,
      (t) => ({
        ...t,
        generationId: p.generationId,
        answer: p.text,
        status: p.status,
        error: p.error,
        cost: p.cost,
        cutOff: p.cutOff,
        tools: endedCalls(t.tools, Date.now()),
        ...(t.startedAt && !t.endedAt ? { endedAt: Date.now() } : {})
      }),
      p.generationId
    )
    if (get().running?.taskId === p.taskId) set({ running: null })
    void settle(shown?.chatId || get().chatId)
  })
}

/** After an answer: the list of chats again, and what only the record knows (whether the cost was estimated). */
async function settle(chatId: ID | null): Promise<void> {
  const key = get().storyKey
  try {
    const [chats, turns] = await Promise.all([api.listChats(storyOfKey(key)), chatId ? api.getChat(chatId) : Promise.resolve([])])
    if (get().storyKey !== key) return
    const byId = new Map(turns.map((t) => [t.generationId, t]))
    set({
      chats,
      turns: get().turns.map((t) => {
        const r = byId.get(t.generationId)
        return r && t.status !== 'streaming'
          ? { ...t, cost: r.cost, costEstimated: r.costEstimated, cutOff: r.cutOff, ...(r.choice && !t.choice ? { choice: r.choice } : {}) }
          : t
      })
    })
  } catch {
    // The list stays as it was; it is read again after the next answer.
  }
}

const storyOfKey = (key: string | null): ID | null => {
  const story = key?.slice(key.indexOf(':') + 1) ?? ''
  return story || null
}

/**
 * The story a chat was asked in, from its id (`<story id>:…`, or `world:…` with no story open: null); undefined
 * when that can't be told (no chat id yet).
 */
export function storyOfChat(chatId: string | null | undefined): ID | null | undefined {
  const i = chatId ? chatId.indexOf(':') : -1
  if (!chatId || i <= 0) return undefined
  const story = chatId.slice(0, i)
  return story === 'world' ? null : story
}

/** The chat a turn on show belongs to; undefined when it isn't on show (or has no chat yet). */
export const chatOfTurn = (generationId: ID): ID | undefined => get().turns.find((t) => t.generationId === generationId)?.chatId || undefined

// ---------- Which chat is on show ----------

/** The notes saved this session, with those the turns' records keep (saved before a restart). */
const withSaved = (turns: AskTurn[]): Record<ID, SavedNote> => {
  const kept = Object.fromEntries(turns.filter((t) => t.saved).map((t) => [t.generationId, t.saved as SavedNote]))
  return { ...kept, ...get().saved }
}

/** Shows a story's chats (its most recent one open), unless they already show. */
export async function showStory(place: Pick<AskPlace, 'worldId' | 'storyId'>, again = false): Promise<void> {
  const key = keyOf(place)
  if (get().storyKey === key && !again) return
  listen()
  // An answer still arriving in another story's chat stops; what arrived is kept there.
  if (get().storyKey !== key) stopAnswer()
  set({ ...initial, storyKey: key, loading: true, saved: get().saved })
  try {
    const chats = await api.listChats(place.storyId)
    if (get().storyKey !== key) return
    const last = chats[0]
    const turns = last ? await api.getChat(last.chatId) : []
    if (get().storyKey !== key) return
    set({ chats, chatId: last?.chatId ?? null, turns, loading: false, saved: withSaved(turns) })
  } catch (e) {
    if (get().storyKey === key) set({ loading: false, loadError: errorOf(e).message })
  }
}

/** The editor chat: what Adam made of a proposed change, shown at once and kept with the answer. */
export async function setProposalStatus(generationId: ID, proposalId: string, status: ProposalStatus): Promise<void> {
  set({
    turns: get().turns.map((t) =>
      t.generationId === generationId && t.proposals
        ? { ...t, proposals: t.proposals.map((p) => (p.id === proposalId ? { ...p, status } : p)) }
        : t
    )
  })
  await api.setProposalStatus(generationId, proposalId, status).catch(() => undefined)
}

/** Starts a new chat. An answer still arriving stops; what arrived is kept in its chat. */
export function newChat(): void {
  stopAnswer()
  set({ chatId: null, turns: [], running: null, loadError: null })
  requestBoxFocus()
}

/** Opens one of the story's earlier chats. */
export async function openChat(chatId: ID): Promise<void> {
  if (chatId === get().chatId) return
  stopAnswer()
  const key = get().storyKey
  try {
    const turns = await api.getChat(chatId)
    if (get().storyKey !== key) return
    set({ chatId, turns, running: null, loadError: null, saved: withSaved(turns) })
  } catch (e) {
    set({ loadError: errorOf(e).message })
  }
}

/** Reads the story's list of chats again (the list of earlier chats is about to show). */
export async function refreshChats(): Promise<void> {
  const key = get().storyKey
  try {
    const chats = await api.listChats(storyOfKey(key))
    if (get().storyKey === key) set({ chats })
  } catch {
    // The list as it was.
  }
}

// ---------- Asking ----------

/**
 * True for a question that never reached the AI (nothing could be sent: no model set up, say), so there
 * is no record of it. It gives way to the next question; one the AI was asked stays, even unanswered.
 */
export const neverSent = (t: ShownTurn): boolean => !!t.problem && t.generationId.startsWith('pending:')

/**
 * Answers still on their way to starting (askWorld hasn't come back yet, so there is no task to stop),
 * and whether Stop was asked for meanwhile: by Stop, a new chat, another chat or story. They stop as soon
 * as they start, so no answer goes on being written (and paid for) where Adam can't see it.
 */
const starting = new Map<ID, boolean>()

/**
 * Asks a question in the chat on show (a new chat when none is). The question shows at once; the
 * answer streams in. Returns false when it couldn't be asked (the turn then says why, with Try again). `how`: "Edit
 * this" (mode 'edit') and the selection the question quotes, sent beside its words.
 */
export async function ask(question: string, place: AskPlace, how: AskHow = {}): Promise<boolean> {
  const text = question.trim()
  const s = get()
  if (!text || s.running || s.loading) return false
  listen()
  const taskId = crypto.randomUUID()
  const chatId = s.chatId
  const key = s.storyKey
  const sentWith: AskHow = { ...(how.mode ? { mode: how.mode } : {}), ...(how.selection ? { selection: how.selection } : {}) }
  const pending: ShownTurn = {
    taskId,
    generationId: `pending:${taskId}`,
    chatId: chatId ?? '',
    question: text,
    answer: '',
    status: 'streaming',
    error: null,
    cost: null,
    costEstimated: false,
    cutOff: false,
    createdAt: new Date().toISOString(),
    startedAt: Date.now(),
    ...(sentWith.mode || sentWith.selection ? { sentWith } : {})
  }
  // A question that never reached the AI gives way to the new one (asked again, or another).
  set({ turns: [...s.turns.filter((t) => !neverSent(t)), pending], running: { taskId, stopping: false, retrying: null } })
  starting.set(taskId, false)
  try {
    // The open scene's unsaved typing is saved first, so the chat reads the scene as the page shows it (the
    // question already shows meanwhile). A save that fails doesn't stop the question.
    const page = editorBridge()
    if (page) await page.flush().catch(() => undefined)
    const turn = await api.askWorld({ taskId, chatId, question: text, storyId: place.storyId, sceneId: place.sceneId, ...sentWith })
    // Stop asked for before the answer had started (or it no longer shows here): it stops now. The
    // record keeps what arrived, and the chat shows it, stopped, when opened again.
    const stop = starting.get(taskId) || get().running?.taskId !== taskId
    starting.delete(taskId)
    if (stop) void api.stopTask(taskId).catch(() => undefined)
    if (get().storyKey !== key) return true
    // The answer may have arrived already: only the turn's ids come from here.
    updateTask(taskId, (t) => ({ ...t, generationId: turn.generationId, chatId: turn.chatId, createdAt: turn.createdAt }))
    if (!get().chatId && get().turns.some((t) => t.taskId === taskId)) set({ chatId: turn.chatId })
    if (!get().running || get().running?.taskId !== taskId) void settle(turn.chatId)
    return true
  } catch (e) {
    starting.delete(taskId)
    if (get().storyKey !== key) return false
    updateTask(taskId, (t) => ({ ...t, status: 'error', problem: errorOf(e) }))
    if (get().running?.taskId === taskId) set({ running: null })
    return false
  }
}

/** Stops the answer being written; what arrived is kept. One that hasn't started yet stops as it starts. */
export function stopAnswer(): void {
  const r = get().running
  if (!r) return
  set({ running: { ...r, stopping: true } })
  if (starting.has(r.taskId)) starting.set(r.taskId, true)
  void api.stopTask(r.taskId).catch(() => undefined)
}

// ---------- The box ----------

export const setDraft = (draft: string): void => set({ draft })

/** Quotes words selected in the page in the box (the box's text is set apart, by setDraft), or lets the quote go. */
export const setQuote = (quote: BoxQuote | null): void => set({ quote })

/** The quote in the box, while the question still quotes it ("About this passage: “…”"); null once it doesn't. */
export const quoteIn = (question: string, quote: BoxQuote | null): BoxQuote | null =>
  quote && question.includes(`“${quote.text}”`) ? quote : null

/** The quote's × in the box: its "About this passage" line comes out of the box, and the quote goes. */
export function removeQuote(): void {
  const s = get()
  if (!s.quote) return
  const draft = s.draft.replace(`About this passage: “${s.quote.text}”`, '').replace(/^\s+/, '')
  set({ draft, quote: null })
}

/** How a question typed in the box is asked: with the selection it quotes, and "Edit this" when that is how it began. */
export function howFor(question: string, quote: BoxQuote | null): AskHow {
  const q = quoteIn(question, quote)
  if (!q) return {}
  return { selection: { text: q.text, ...(q.pids.length ? { pids: q.pids } : {}) }, ...(q.mode ? { mode: q.mode } : {}) }
}

/** Sends what is typed in the box (with the selection it quotes); the box empties, and the quote goes with it. */
export function sendBox(place: AskPlace): boolean {
  const s = get()
  const q = s.draft.trim()
  if (!q || s.running || s.loading) return false
  const how = howFor(q, s.quote)
  set({ draft: '', quote: null })
  void ask(q, place, how)
  return true
}

// ---------- A question with options (ask_user) ----------

/**
 * Sends the options picked from the chat's question as the next question in the chat (each on a line of its own:
 * askChoice.pickQuestion). Only while the turn is the chat's last and nothing is being answered.
 */
export function pickChoice(generationId: ID, picked: number[], place: AskPlace): boolean {
  const s = get()
  const last = s.turns[s.turns.length - 1]
  if (!last || last.generationId !== generationId || !last.choice || !picked.length || s.running || s.loading) return false
  void ask(pickQuestion(last.choice, picked), place)
  return true
}

/** Asks the box to take the keyboard (when the panel shows it next). */
export function requestBoxFocus(): void {
  set({ focusRequest: get().focusRequest + 1 })
}

// ---------- Saved notes ----------

export function markSaved(generationId: ID, note: SavedNote | null): void {
  const saved = { ...get().saved }
  if (note) saved[generationId] = note
  else delete saved[generationId]
  set({ saved })
}

// After a backup is restored, the chats are those of the world before it: read them again.
registerDiscarder(() => {
  stopAnswer()
  set({ ...initial })
})
