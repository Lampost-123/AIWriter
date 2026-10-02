// Next scene ideas while the app is open, one list for each scene in each world: the three directions
// as they arrive, and whether they still show (using one, or closing the list, hides them; Undo after
// using one shows them again). A request keeps going when Adam moves to another scene, so coming back
// shows it. SceneIdeas.tsx draws it at the top of the scene card.
import { create } from 'zustand'
import { emptySceneCard } from '@shared/defaults'
import type { ID, SceneCard } from '@shared/types'
import { toast } from '@/components/ui'
import { api, ApiError, onEvent } from '@/lib/api'
import { useApp } from '@/lib/store'
import { renameScene } from '@/features/binder/actions'
import { useOutlineStore } from '@/features/binder/outlineStore'
import { isPlainTitle } from './ideasLogic'
import type { SceneIdea } from './parse'

export interface IdeasProblem {
  message: string
  code?: string
}

export interface IdeasSession {
  taskId: ID
  generationId: ID | null
  /** The answer so far. */
  text: string
  status: 'running' | 'complete' | 'stopped' | 'error'
  cutOff: boolean
  retrying: string | null
  problem: IdeasProblem | null
  /** Put away: one was used, or the list was closed. */
  hidden: boolean
}

export const useSceneIdeas = create<{ sessions: Record<string, IdeasSession>; reveal: ID | null }>(() => ({ sessions: {}, reveal: null }))

export const ideasKey = (worldId: ID | null | undefined, sceneId: ID): string => `${worldId ?? ''}:${sceneId}`
const keyOf = (sceneId: ID): string => ideasKey(useApp.getState().world?.id, sceneId)

const get = (key: string): IdeasSession | undefined => useSceneIdeas.getState().sessions[key]
const put = (key: string, s: IdeasSession | null): void =>
  useSceneIdeas.setState((st) => {
    const sessions = { ...st.sessions }
    if (s) sessions[key] = s
    else delete sessions[key]
    return { sessions }
  })
/** Changes the session, if it is still the one with this task id. */
const patch = (key: string, taskId: ID, p: Partial<IdeasSession>): void => {
  const s = get(key)
  if (s && s.taskId === taskId) put(key, { ...s, ...p })
}

function findTask(taskId: ID): string | null {
  for (const [key, s] of Object.entries(useSceneIdeas.getState().sessions)) if (s.taskId === taskId) return key
  return null
}

let listening = false
/** Follows ideas requests for as long as the window is open. */
function listen(): void {
  if (listening) return
  listening = true
  onEvent('task:progress', (p) => {
    if (p.job !== 'ideas') return
    const key = findTask(p.taskId)
    if (key) patch(key, p.taskId, { text: p.text, generationId: p.generationId, retrying: null })
  })
  onEvent('task:retrying', (p) => {
    const key = findTask(p.taskId)
    if (key) patch(key, p.taskId, { retrying: p.reason })
  })
  onEvent('task:done', (d) => {
    if (d.job !== 'ideas') return
    const key = findTask(d.taskId)
    if (!key) return
    patch(key, d.taskId, {
      text: d.text,
      generationId: d.generationId,
      status: d.status,
      cutOff: d.cutOff,
      retrying: null,
      problem: d.status === 'error' ? { message: d.error ?? 'Something went wrong while the ideas were written. Please try again.' } : null
    })
  })
}

/** The scene's ideas, if any were asked for. */
export const ideasFor = (sceneId: ID): IdeasSession | undefined => get(keyOf(sceneId))

/** Asks for three directions for the scene. A request already running for it carries on instead. */
export async function askIdeas(sceneId: ID): Promise<void> {
  listen()
  const key = keyOf(sceneId)
  if (get(key)?.status === 'running') return
  const taskId = crypto.randomUUID()
  put(key, { taskId, generationId: null, text: '', status: 'running', cutOff: false, retrying: null, problem: null, hidden: false })
  try {
    const { generationId } = await api.startSceneIdeas({ taskId, sceneId })
    const s = get(key)
    if (s?.taskId === taskId && !s.generationId) patch(key, taskId, { generationId })
  } catch (e) {
    patch(key, taskId, { status: 'error', problem: { message: (e as Error).message, code: e instanceof ApiError ? e.code : undefined } })
  }
}

/** Stops the request; the ideas that have arrived stay. */
export function stopIdeas(sceneId: ID): void {
  const s = get(keyOf(sceneId))
  if (s?.status === 'running') void api.stopTask(s.taskId).catch(() => undefined)
}

/** Closes the list (stopping a request still running). */
export function closeIdeas(sceneId: ID): void {
  stopIdeas(sceneId)
  put(keyOf(sceneId), null)
}

/** The palette asked: the list shows at the top of the card (scrolled to), asking first unless it is showing already. */
export function revealIdeas(sceneId: ID): void {
  listen()
  const s = get(keyOf(sceneId))
  useSceneIdeas.setState({ reveal: sceneId })
  if (!s || s.hidden || s.status === 'error') void askIdeas(sceneId)
}

export const clearReveal = (): void => useSceneIdeas.setState({ reveal: null })

// ---------- Using one ----------

/** The scene card forms on screen, so Undo changes what Adam sees (and what it saves), not only what is on disk. */
const liveCards = new Map<ID, (patch: Partial<SceneCard>) => void>()

export function registerCard(sceneId: ID, onUse: (patch: Partial<SceneCard>) => void): () => void {
  liveCards.set(sceneId, onUse)
  return () => {
    if (liveCards.get(sceneId) === onUse) liveCards.delete(sceneId)
  }
}

async function patchCard(sceneId: ID, p: Partial<SceneCard>): Promise<void> {
  const live = liveCards.get(sceneId)
  if (live) return live(p)
  const scene = await api.getScene(sceneId)
  await api.updateSceneCard(sceneId, { ...emptySceneCard(), ...scene.card, ...p })
  useApp.getState().bumpBriefing()
}

/**
 * "Use this": the idea fills the card (its line on what happens as the goal, and its beats), and a scene
 * still called "Scene 3" takes the idea's title. Undo in the toast puts the card and title back and
 * shows the ideas again.
 */
export function applyIdea(sceneId: ID, idea: SceneIdea, card: SceneCard): void {
  const key = keyOf(sceneId)
  const s = get(key)
  const before: Partial<SceneCard> = { goal: card.goal, beats: card.beats }
  const scene = useOutlineStore.getState().outline?.scenes.find((x) => x.id === sceneId)
  const oldTitle = scene?.title ?? null
  const newTitle = idea.title.trim()
  const rename = oldTitle !== null && isPlainTitle(oldTitle) && !!newTitle && !/^idea \d+$/i.test(newTitle)

  void patchCard(sceneId, { goal: idea.summary.trim(), beats: idea.beats.map((b) => b.trim()).filter(Boolean) })
  if (rename) void renameScene(sceneId, newTitle)
  // The others are no longer needed: the request stops if it is still writing them.
  if (s?.status === 'running') stopIdeas(sceneId)
  if (s) put(key, { ...s, hidden: true })

  const named = newTitle ? `“${newTitle}”` : 'that idea'
  toast(rename ? `Filled the scene card with ${named}, and named the scene after it.` : `Filled the scene card with ${named}.`, {
    action: {
      label: 'Undo',
      run: () => {
        void patchCard(sceneId, before).catch((e: Error) => void toast(e.message, { tone: 'danger' }))
        if (rename && oldTitle) void renameScene(sceneId, oldTitle)
        const now = get(key)
        if (now && s && now.taskId === s.taskId) put(key, { ...now, hidden: false })
      }
    }
  })
}
