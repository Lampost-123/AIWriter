// Accepting a scene (the Accept button, Ctrl+Enter, or Done in the status menu) marks it done:
// the memory catches up with it in the background and its summary is written. Reopen takes it
// back to revised for more work. Neither asks first: each is undone by the other.

import type { ID, SceneMeta, SceneStatus } from '@shared/types'
import { toast } from '@/components/ui'
import { api } from '@/lib/api'
import { flushAll } from '@/lib/flush'
import { useApp } from '@/lib/store'
import * as actions from '@/features/binder/actions'
import { useOutlineStore } from '@/features/binder/outlineStore'

/** Scenes being accepted or reopened right now, so a double press does it once. */
const busy = new Set<ID>()

/** Shows the scene's new state in the binder and the header straight away. */
function show(meta: SceneMeta): void {
  useOutlineStore
    .getState()
    .patch((o) => ({
      ...o,
      scenes: o.scenes.map((s) => (s.id === meta.id ? { ...s, status: meta.status, acceptedAt: meta.acceptedAt } : s))
    }))
  useApp.getState().bumpOutline()
}

const sentence = (message: string): string => (/[.!?]$/.test(message.trim()) ? message.trim() : `${message.trim()}.`)

/** Accepts a scene, saving every unsaved word first so the memory reads the scene as it is now. Returns true when it worked. */
export async function acceptScene(sceneId: ID): Promise<boolean> {
  if (busy.has(sceneId)) return false
  if (useApp.getState().activeGeneration?.sceneId === sceneId) {
    toast('A draft is still being written into this scene. Accept it once the draft has finished, or press Stop.')
    return false
  }
  busy.add(sceneId)
  try {
    await flushAll()
    show(await api.acceptScene(sceneId))
    toast('Scene accepted. The memory is catching up.', { tone: 'success' })
    return true
  } catch (e) {
    toast(`This scene couldn't be accepted. ${sentence((e as Error).message)} Your writing is safe.`, { tone: 'danger' })
    return false
  } finally {
    busy.delete(sceneId)
  }
}

/** Opens an accepted scene for more work (back to revised). Returns its new state, or null if that failed. */
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

/** The status menu: Done is the same as Accept, and leaving Done reopens the scene first. */
export async function changeStatus(sceneId: ID, from: SceneStatus, to: SceneStatus): Promise<void> {
  if (to === from) return
  if (to === 'done') {
    await acceptScene(sceneId)
    return
  }
  if (from === 'done') {
    const meta = await reopenScene(sceneId)
    if (!meta || meta.status === to) return
  }
  await actions.setSceneStatus(sceneId, to)
}
