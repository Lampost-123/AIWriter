// Marking a scene done (the Mark done button, Ctrl+Enter, or Done in the status menu) sets its
// status and refreshes its summary. The memory never waits for it: it follows the text as Adam
// writes. Reopen takes the scene back to revised. Neither asks first: each is undone by the other.

import type { ID, SceneMeta, SceneStatus } from '@shared/types'
import { toast } from '@/components/ui'
import { api } from '@/lib/api'
import { flushAll } from '@/lib/flush'
import { useApp } from '@/lib/store'
import * as actions from '@/features/binder/actions'
import { useOutlineStore } from '@/features/binder/outlineStore'

/** Scenes being marked done or reopened right now, so a double press does it once. */
const busy = new Set<ID>()

/** Shows the scene's new state in the binder and the header straight away. */
function show(meta: SceneMeta): void {
  useOutlineStore.getState().patch((o) => ({
    ...o,
    scenes: o.scenes.map((s) =>
      s.id === meta.id ? { ...s, status: meta.status, acceptedAt: meta.acceptedAt, memoryState: meta.memoryState ?? s.memoryState } : s
    )
  }))
  useApp.getState().bumpOutline()
}

const sentence = (message: string): string => (/[.!?]$/.test(message.trim()) ? message.trim() : `${message.trim()}.`)

/** Marks a scene done, saving every unsaved word first. Returns true when it worked. */
export async function markSceneDone(sceneId: ID): Promise<boolean> {
  if (busy.has(sceneId)) return false
  if (useApp.getState().activeGeneration?.sceneId === sceneId) {
    toast('A draft is still being written into this scene. Mark it done once the draft has finished, or press Stop.')
    return false
  }
  busy.add(sceneId)
  try {
    await flushAll()
    show(await api.markSceneDone(sceneId))
    toast('Scene marked done.', { tone: 'success' })
    return true
  } catch (e) {
    toast(`This scene couldn't be marked done. ${sentence((e as Error).message)} Your writing is safe.`, { tone: 'danger' })
    return false
  } finally {
    busy.delete(sceneId)
  }
}

/** Opens a scene marked done for more work (back to revised). Returns its new state, or null if that failed. */
export async function reopenScene(sceneId: ID): Promise<SceneMeta | null> {
  if (busy.has(sceneId)) return null
  busy.add(sceneId)
  try {
    const meta = await api.reopenScene(sceneId)
    show(meta)
    return meta
  } catch (e) {
    toast(`This scene couldn't be reopened. ${sentence((e as Error).message)}`, { tone: 'danger' })
    return null
  } finally {
    busy.delete(sceneId)
  }
}

/** The status menu: Done is the same as Mark done, and leaving Done reopens the scene first. */
export async function changeStatus(sceneId: ID, from: SceneStatus, to: SceneStatus): Promise<void> {
  if (to === from) return
  if (to === 'done') {
    await markSceneDone(sceneId)
    return
  }
  if (from === 'done') {
    const meta = await reopenScene(sceneId)
    if (!meta || meta.status === to) return
  }
  await actions.setSceneStatus(sceneId, to)
}
