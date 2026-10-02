// The Issues tab's data (milestone 5, AI checks): each scene's issues, loaded once and again whenever the
// main process says they changed ('issues:changed'), and the check runs going on now, from their events
// ('checks:progress', 'checks:done'), so a scene can say "Checking…" whoever started the check. The last
// answer stays on screen while a newer one loads, and the last few scenes are kept, so switching back to
// one shows it at once. Marking a scene done that turns up something says so in a quiet message with Show.
import { useEffect } from 'react'
import { create } from 'zustand'
import type { CheckProgress, Issue } from '@shared/contracts/checks'
import type { ID } from '@shared/types'
import { toast } from '@/components/ui'
import { api, onEvent } from '@/lib/api'
import { registerDiscarder } from '@/lib/flush'
import { useApp } from '@/lib/store'
import { openScene } from '@/features/memory/openScene'
import { foundWords } from './issuesLogic'

interface Loaded {
  issues: Issue[] | null
  error: string | null
}

/** A run as its events tell it; `where` is the first scene it named (kept once it moves on). */
export type Run = CheckProgress & { background?: boolean; where?: string | null }

interface IssuesState {
  scenes: Record<ID, Loaded>
  /** Check runs going on (or waiting their turn) now, by run id. */
  runs: Record<ID, Run>
  /** The last check Adam asked for that went wrong, per scene, in plain words. Cleared when another starts. */
  failed: Record<ID, string>
}

export const useIssuesStore = create<IssuesState>(() => ({ scenes: {}, runs: {}, failed: {} }))

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
    // The tab's count and the tab itself both ask: one load for each change is enough.
    const key = `${worldId}:${memoryRev}`
    if (loadedAt.get(sceneId) === key) return
    loadedAt.set(sceneId, key)
    void loadIssues(sceneId)
  }, [sceneId, memoryRev, worldId])
  return { issues: loaded?.issues ?? null, error: loaded?.error ?? null, retry: () => void loadIssues(sceneId) }
}

/** Shows a scene's Issues tab beside the page (opening the scene, and the panel, when needed). */
export async function showIssues(sceneId: ID): Promise<void> {
  const app = useApp.getState()
  if (app.sceneId !== sceneId || app.view.kind !== 'write') await openScene(sceneId)
  const a = useApp.getState()
  a.setAskOpen(false)
  a.peekEntry(null)
  a.setInspectorTab('issues')
  if (a.settings && !a.settings.layout.inspectorOpen) void a.updateSettings({ layout: { inspectorOpen: true } })
}

let listening = false

/** Follows issues and runs from the main process. Installed once, the first time anything here is used. */
function listen(): void {
  if (listening || typeof window === 'undefined' || !window.aiwrite) return
  listening = true
  onEvent('issues:changed', (p) => {
    const cached = useIssuesStore.getState().scenes
    for (const id of p.sceneIds) if (cached[id]) void loadIssues(id)
  })
  onEvent('checks:progress', (p) => {
    const s = useIssuesStore.getState()
    const was = s.runs[p.runId]
    const run: Run = { ...p, background: was?.background ?? p.runId.startsWith('done:'), where: was?.where ?? p.current }
    const failed = { ...s.failed }
    if (!s.runs[p.runId] && !run.background) for (const id of p.sceneIds ?? [p.target.id]) delete failed[id]
    useIssuesStore.setState({ runs: { ...s.runs, [p.runId]: run }, failed })
  })
  onEvent('checks:done', (d) => {
    const s = useIssuesStore.getState()
    const run = s.runs[d.runId]
    const runs = { ...s.runs }
    delete runs[d.runId]
    const scenes = run?.sceneIds ?? (d.target.scope === 'scene' ? [d.target.id] : [])
    const failed = { ...s.failed }
    if (d.status === 'error' && d.error && !d.background) for (const id of scenes) failed[id] = d.error
    useIssuesStore.setState({ runs, failed })
    for (const id of scenes) if (s.scenes[id]) void loadIssues(id)
    // Marking a scene done turned something up: a quiet word, with the way to it.
    if (d.background && d.status === 'complete' && d.found > 0 && d.target.scope === 'scene') {
      const sceneId = d.target.id
      const here = useApp.getState().sceneId === sceneId && useApp.getState().view.kind === 'write'
      const label = run?.where ?? null
      toast(foundWords(d.found, here ? null : label), { action: { label: 'Show', run: () => void showIssues(sceneId) } })
    }
  })
}

// Another world (or a restored backup): what was loaded belongs to the world before.
registerDiscarder(() => {
  asked.clear()
  loadedAt.clear()
  useIssuesStore.setState({ scenes: {}, runs: {}, failed: {} })
})

listen()
