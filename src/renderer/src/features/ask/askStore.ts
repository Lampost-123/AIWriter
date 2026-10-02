// Ask the world's conversation, kept while the app runs (the panel can close and open again, and the
// answer keeps arriving meanwhile). Each story has its own chats; the one on show is the story's most
// recent when the panel first shows that story. Answers stream in as task events, matched by the task
// id this side makes. Saved notes are remembered for this session, so an answer shows "Saved".
import { create } from 'zustand'
import type { AskTurn, ChatSummary, SavedNote } from '@shared/contracts/ask'
import type { ID } from '@shared/types'
import { api, ApiError, onEvent } from '@/lib/api'
import { registerDiscarder } from '@/lib/flush'

/** A turn as the panel shows it. */
export interface ShownTurn extends AskTurn {
  /** The task writing its answer, while this session asked it. */
  taskId?: ID
  /** Nothing could be sent (no model set up, say): what went wrong, in plain words. */
  problem?: { message: string; code?: string }
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

export const useAsk = create<AskState>(() => ({ ...initial, draft: '', focusRequest: 0 }))

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

/** Changes the turn its task is writing. */
function updateTask(taskId: ID, fn: (t: ShownTurn) => ShownTurn): void {
  const turns = get().turns
  const i = turns.findIndex((t) => t.taskId === taskId)
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
    updateTask(p.taskId, (t) => ({ ...t, generationId: p.generationId, answer: p.text }))
    const r = get().running
    if (r?.taskId === p.taskId && r.retrying) set({ running: { ...r, retrying: null } })
  })
  onEvent('task:retrying', (p) => {
    const r = get().running
    if (r?.taskId === p.taskId) set({ running: { ...r, retrying: p.reason } })
  })
  onEvent('task:done', (p) => {
    if (p.job !== 'chat') return
    const shown = get().turns.find((t) => t.taskId === p.taskId)
    updateTask(p.taskId, (t) => ({
      ...t,
      generationId: p.generationId,
      answer: p.text,
      status: p.status,
      error: p.error,
      cost: p.cost,
      cutOff: p.cutOff
    }))
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
        return r && t.status !== 'streaming' ? { ...t, cost: r.cost, costEstimated: r.costEstimated, cutOff: r.cutOff } : t
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

// ---------- Which chat is on show ----------

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
    set({ chats, chatId: last?.chatId ?? null, turns, loading: false })
  } catch (e) {
    if (get().storyKey === key) set({ loading: false, loadError: errorOf(e).message })
  }
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
    set({ chatId, turns, running: null, loadError: null })
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

/** True while the turn shows the question only (it failed before any answer came). */
const failedEmpty = (t: ShownTurn): boolean => !!t.problem || (t.status === 'error' && !t.answer.trim())

/**
 * Asks a question in the chat on show (a new chat when none is). The question shows at once; the
 * answer streams in. Returns false when it couldn't be asked (the turn then says why, with Try again).
 */
export async function ask(question: string, place: AskPlace): Promise<boolean> {
  const text = question.trim()
  const s = get()
  if (!text || s.running || s.loading) return false
  listen()
  const taskId = crypto.randomUUID()
  const chatId = s.chatId
  const key = s.storyKey
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
    createdAt: new Date().toISOString()
  }
  // A question that failed with nothing to show gives way to the new one (asked again, or another).
  set({ turns: [...s.turns.filter((t) => !failedEmpty(t)), pending], running: { taskId, stopping: false, retrying: null } })
  try {
    const turn = await api.askWorld({ taskId, chatId, question: text, storyId: place.storyId, sceneId: place.sceneId })
    if (get().storyKey !== key) return true
    // The answer may have arrived already: only the turn's ids come from here.
    updateTask(taskId, (t) => ({ ...t, generationId: turn.generationId, chatId: turn.chatId, createdAt: turn.createdAt }))
    if (!get().chatId && get().turns.some((t) => t.taskId === taskId)) set({ chatId: turn.chatId })
    const r = get().running
    if (r?.taskId === taskId && r.stopping) void api.stopTask(taskId).catch(() => undefined)
    if (!get().running || get().running?.taskId !== taskId) void settle(turn.chatId)
    return true
  } catch (e) {
    if (get().storyKey !== key) return false
    updateTask(taskId, (t) => ({ ...t, status: 'error', problem: errorOf(e) }))
    if (get().running?.taskId === taskId) set({ running: null })
    return false
  }
}

/** Stops the answer being written; what arrived is kept. */
export function stopAnswer(): void {
  const r = get().running
  if (!r) return
  set({ running: { ...r, stopping: true } })
  void api.stopTask(r.taskId).catch(() => undefined)
}

// ---------- The box ----------

export const setDraft = (draft: string): void => set({ draft })

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
