// The Issues list's data (milestone 5, AI checks): each scene's issues, loaded once and again whenever the
// main process says they changed ('issues:changed': every save of a scene sweeps its issues, so that comes as the
// words change). The check runs going on now are the one store's (consistency/checkStore.ts, since the calm overhaul), so
// a scene can say "Checking…" whoever started the check. The last answer stays on screen while a newer one loads, and the
// last few scenes are kept, so switching back to one shows it at once, and it is read again then too (findings that
// stay current, 2026-10-16). Marking a scene done that turns up something says so in a quiet message with Show; a check
// after a draft adds what it found to the draft's one note (features/draftNote).
import { useEffect } from 'react'
import { create } from 'zustand'
import type { Issue } from '@shared/contracts/checks'
import type { ID } from '@shared/types'
import { toast } from '@/components/ui'
import { api, onEvent } from '@/lib/api'
import { registerDiscarder } from '@/lib/flush'
import { useApp } from '@/lib/store'
import { openScene } from '@/features/memory/openScene'
import { onCheckEnded } from '@/features/consistency/checkStore'
import { noteDraftCheck } from '@/features/draftNote/draftNote'
import { foundWords } from './issuesLogic'
import { useIssuesView, type IssueSection } from './sections'

interface Loaded {
  issues: Issue[] | null
  error: string | null
}

interface IssuesState {
  scenes: Record<ID, Loaded>
}

export const useIssuesStore = create<IssuesState>(() => ({ scenes: {} }))

/** How many scenes' issues are kept. */
const KEEP = 8
/** The newest load asked for each scene: only its answer is kept. */
const asked = new Map<ID, number>()
/** What each scene was last loaded for (the world and the memory's revision). */
const loadedAt = new Map<ID, string>()
let seq = 0

/** Loads (or reloads) a scene's issues. The last answer stays until the new one arrives. */
export async function loadIssues(sceneId: ID): Promise<void> {
  const n = ++seq
  asked.set(sceneId, n)
  const worldId = useApp.getState().world?.id
  try {
    const issues = await api.listIssues(sceneId)
    if (asked.get(sceneId) !== n || useApp.getState().world?.id !== worldId) return
    put(sceneId, { issues, error: null })
  } catch (e) {
    if (asked.get(sceneId) !== n) return
    const had = useIssuesStore.getState().scenes[sceneId]?.issues ?? null
    put(sceneId, { issues: had, error: had ? null : (e as Error).message })
  }
}

function put(sceneId: ID, l: Loaded): void {
  const scenes = { ...useIssuesStore.getState().scenes }
  delete scenes[sceneId]
  scenes[sceneId] = l
  const keys = Object.keys(scenes)
  for (const k of keys.slice(0, Math.max(0, keys.length - KEEP))) {
    delete scenes[k]
    loadedAt.delete(k)
  }
  useIssuesStore.setState({ scenes })
}

/** Changes one issue in place straight away (Ignore hides it at once), before the main process says so. */
export function patchIssue(sceneId: ID, id: ID, patch: Partial<Issue>): void {
  const l = useIssuesStore.getState().scenes[sceneId]
  if (!l?.issues) return
  put(sceneId, { ...l, issues: l.issues.map((i) => (i.id === id ? { ...i, ...patch } : i)) })
}

/**
 * A scene's issues, loaded when first asked for and again when the memory changes (entries' names, what
 * the memory says). Issues changing in the main process reload them through the events below.
 */
export function useSceneIssues(sceneId: ID): Loaded & { retry: () => void } {
  const loaded = useIssuesStore((s) => s.scenes[sceneId])
  const memoryRev = useApp((s) => s.memoryRev)
  const worldId = useApp((s) => s.world?.id ?? null)
  useEffect(() => {
    listen()
    wantIssues(sceneId, `${worldId}:${memoryRev}`)
  }, [sceneId, memoryRev, worldId])
  return { issues: loaded?.issues ?? null, error: loaded?.error ?? null, retry: () => void loadIssues(sceneId) }
}

/**
 * Loads a scene's issues unless they were loaded for the same world and memory (`key`) since Adam last came to the
 * scene: the tab's count and the tab itself both ask, and one load for each change is enough.
 */
export function wantIssues(sceneId: ID, key: string): void {
  if (loadedAt.get(sceneId) === key) return
  loadedAt.set(sceneId, key)
  void loadIssues(sceneId)
}

/** The scene open in the page, to notice Adam leaving it. */
let openNow: ID | null = null

/** Leaving a scene: coming back to it reads its issues again (the answer kept shows meanwhile). */
function followOpenScene(): void {
  if (typeof useApp.subscribe !== 'function') return
  openNow = useApp.getState().sceneId ?? null
  useApp.subscribe((a) => {
    if (a.sceneId === openNow) return
    if (openNow) loadedAt.delete(openNow)
    openNow = a.sceneId
  })
}
followOpenScene()

/**
 * Shows a scene's Issues list beside the page (opening the scene, and the panel, when needed), on one of its sections
 * (Slips, Questions, Craft notes, Plot threads, Memory) or all of them.
 */
export async function showIssues(sceneId: ID, section: IssueSection | 'all' = 'all'): Promise<void> {
  const app = useApp.getState()
  if (app.sceneId !== sceneId || app.view.kind !== 'write') await openScene(sceneId)
  const a = useApp.getState()
  a.setAskOpen(false)
  a.peekEntry(null)
  useIssuesView.getState().show(section)
  a.setInspectorTab('issues')
  if (a.settings && !a.settings.layout.inspectorOpen) void a.updateSettings({ layout: { inspectorOpen: true } })
}

let listening = false

/** Follows issues and the end of checks from the main process. Installed once, the first time anything here is used. */
function listen(): void {
  if (listening || typeof window === 'undefined' || !window.aiwrite) return
  listening = true
  onEvent('issues:changed', (p) => {
    const cached = useIssuesStore.getState().scenes
    for (const id of p.sceneIds) if (cached[id]) void loadIssues(id)
  })
  onCheckEnded(({ run, status, found, scenes, background }) => {
    const cached = useIssuesStore.getState().scenes
    for (const id of scenes) if (cached[id]) void loadIssues(id)
    if (!background || status !== 'complete' || found < 1 || run?.target.scope !== 'scene') return
    const sceneId = run.target.id
    // The check a little after a draft: what it found goes into the draft's one note (or a note of its own, said once).
    if (run.runId.startsWith('draft:')) return noteDraftCheck(sceneId, found)
    // Marking a scene done turned something up: a quiet word, with the way to it.
    const here = useApp.getState().sceneId === sceneId && useApp.getState().view.kind === 'write'
    toast(foundWords(found, here ? null : run.where), { action: { label: 'Show', run: () => void showIssues(sceneId) } })
  })
}

// Another world (or a restored backup): what was loaded belongs to the world before.
registerDiscarder(() => {
  asked.clear()
  loadedAt.clear()
  useIssuesStore.setState({ scenes: {} })
})

listen()
