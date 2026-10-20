// "Plan this scene" (2026-10-19, no dead ends): a scene with nothing on its card asks the outline helper for that one
// scene's card (the per-level job, level 'scene': src/main/outline/stages.ts), which fills the card's empty parts
// (scenePlanLogic.ts) with one Undo; a scene still called "Scene 3" takes the planned title. Offered on an empty scene
// card (SceneCardPanel, the desk's margin card) and by Write the whole chapter for scenes it can't write from
// ("Plan these scenes", one after another). Kept while the app is open, never saved.
import { create } from 'zustand'
import type { Entry, ID, SceneCard } from '@shared/types'
import { toast } from '@/components/ui'
import { api, ApiError } from '@/lib/api'
import { useApp } from '@/lib/store'
import { renameScene } from '@/features/binder/actions'
import { useOutlineStore } from '@/features/binder/outlineStore'
import { followTask } from '@/features/planning/talkStore'
import { codexOf, pageFor } from './codexNames'
import { isPlainTitle } from './ideasLogic'
import { outlineScenes, parseOutline } from './parse'
import { unfill } from './planInterviewLogic'
import { cardNow, patchCard } from './planInterviewStore'
import { partsWords, planOnCard } from './scenePlanLogic'

export interface ScenePlan {
  taskId: ID
  status: 'running' | 'error'
  error: string | null
}

export const useScenePlans = create<{ plans: Record<string, ScenePlan> }>(() => ({ plans: {} }))

export const scenePlanKey = (worldId: ID | null | undefined, sceneId: ID): string => `${worldId ?? ''}:${sceneId}`
const keyOf = (sceneId: ID): string => scenePlanKey(useApp.getState().world?.id, sceneId)
const set = (key: string, p: ScenePlan | null): void =>
  useScenePlans.setState((s) => {
    const plans = { ...s.plans }
    if (p) plans[key] = p
    else delete plans[key]
    return { plans }
  })

/** How a plan ended, and how to take it back (null when nothing changed). */
export interface ScenePlanned {
  status: 'filled' | 'nothing' | 'stopped' | 'error'
  undo: (() => Promise<void>) | null
  error?: string
}

/** The story a scene is in: the binder's when it shows it, else the story open. */
function storyOf(sceneId: ID): ID | null {
  const o = useOutlineStore.getState().outline
  if (o?.scenes.some((s) => s.id === sceneId)) return o.story.id
  return useApp.getState().storyId
}

/**
 * Plans one scene's card and puts it in the card's empty parts. `quiet`: no toast of its own (Plan these scenes says
 * one for them all). Never throws: it says how it ended.
 */
export async function planScene(sceneId: ID, o: { quiet?: boolean } = {}): Promise<ScenePlanned> {
  const key = keyOf(sceneId)
  if (useScenePlans.getState().plans[key]?.status === 'running') return { status: 'stopped', undo: null }
  const storyId = storyOf(sceneId)
  if (!storyId) return { status: 'error', undo: null, error: 'Open the scene’s story first.' }
  const taskId = crypto.randomUUID()
  set(key, { taskId, status: 'running', error: null })
  const fail = (message: string): ScenePlanned => {
    if (useScenePlans.getState().plans[key]?.taskId === taskId) set(key, { taskId, status: 'error', error: message })
    return { status: 'error', undo: null, error: message }
  }
  try {
    const done = await followTask(taskId, () => api.startOutlineStage({ taskId, storyId, level: 'scene', sceneId }), () => undefined)
    if (useScenePlans.getState().plans[key]?.taskId !== taskId) return { status: 'stopped', undo: null }
    if (done.status === 'stopped') {
      set(key, null)
      return { status: 'stopped', undo: null }
    }
    if (done.status === 'error') return fail(done.error ?? 'Something went wrong while the scene was planned. Please try again.')
    const planned = outlineScenes(parseOutline(done.text, true))[0]
    if (!planned) return fail('The AI’s answer didn’t come as a scene card. Please try again.')
    const entries = await api.listEntries()
    const people = codexOf('character', entries)
    const places = codexOf('place', entries)
    const find = (list: Entry[]) => (name: string): ID | null => pageFor(name, list, entries)?.id ?? null
    // As the card is now: anything Adam typed while it was planned stays.
    const before = await cardNow(sceneId)
    const { patch, names } = planOnCard(before, planned, { character: find(people), place: find(places) })
    const oldTitle = useOutlineStore.getState().outline?.scenes.find((x) => x.id === sceneId)?.title ?? null
    const newTitle = planned.title.trim()
    const rename = oldTitle !== null && isPlainTitle(oldTitle) && !!newTitle
    set(key, null)
    if (!names.length && !rename) {
      if (!o.quiet) toast('The scene card already had everything the plan covered, so nothing changed.')
      return { status: 'nothing', undo: null }
    }
    if (names.length) await patchCard(sceneId, patch)
    if (rename) await renameScene(sceneId, newTitle)
    const undo = async (): Promise<void> => {
      try {
        const back = unfill(await cardNow(sceneId), patch as Partial<SceneCard>)
        if (Object.keys(back).length) await patchCard(sceneId, back)
        if (rename && oldTitle !== null) await renameScene(sceneId, oldTitle)
      } catch (e) {
        toast((e as Error).message || 'That didn’t work. Please try again.', { tone: 'danger' })
      }
    }
    if (!o.quiet) {
      const what = names.length ? `filled in the ${partsWords(names)}` : 'named it'
      toast(`Planned ${rename ? `“${newTitle}”` : 'the scene'}: ${what}${rename && names.length ? ', and named the scene' : ''}.`, {
        action: { label: 'Undo', run: () => void undo() }
      })
    }
    return { status: 'filled', undo }
  } catch (e) {
    return fail(e instanceof ApiError || e instanceof Error ? e.message : 'That didn’t work. Please try again.')
  }
}

/** Stops planning a scene: nothing changes on its card. */
export function stopScenePlan(sceneId: ID): void {
  const key = keyOf(sceneId)
  const p = useScenePlans.getState().plans[key]
  if (p?.status === 'running') {
    set(key, null)
    void api.stopTask(p.taskId).catch(() => undefined)
  }
}

export const dismissScenePlan = (sceneId: ID): void => set(keyOf(sceneId), null)
