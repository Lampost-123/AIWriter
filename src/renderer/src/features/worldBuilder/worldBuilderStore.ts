// What the World builder page holds between visits, for the open world: the summary as Adam types it
// (kept in the world as he goes, so the page reopens with it), when it is true, roughly what building
// would cost, a build running (it goes on, and saves, while he is on other pages) and how the last one
// ended. The build itself runs in the main process; this follows its events whichever page is showing.
// Owned by the World builder part.

import { create } from 'zustand'
import type { WorldBuildDone, WorldBuildEstimate, WorldBuildProgress, WorldBuilderState } from '@shared/contracts/worldBuilder'
import type { ID } from '@shared/types'
import { toast, useToasts } from '@/components/ui'
import { api, ApiError, onEvent } from '@/lib/api'
import { registerDiscarder, registerFlusher } from '@/lib/flush'
import { useApp } from '@/lib/store'
import { storyOf } from './worldBuilderLogic'

export interface Problem {
  message: string
  code?: string
}

export interface WorldBuilderSession {
  /** The world this is for. */
  worldId: ID | null
  /** Read from the world, so the page never shows an empty box before the summary kept there. */
  loaded: boolean
  summary: string
  /** When the summary is true: null for the start of the world, else that story's start. */
  storyId: ID | null
  /** A build running now, as it stands. */
  running: (WorldBuildProgress & { storyId: ID | null }) | null
  /** Cancel was pressed, and the build is stopping. */
  cancelling: boolean
  /** How the last build ended, with what it made as it is now. */
  last: WorldBuildDone | null
  /** Roughly what building from the summary would cost, or why it can't be built. */
  estimate: WorldBuildEstimate | null
  problem: Problem | null
}

const fresh = (worldId: ID | null): WorldBuilderSession => ({
  worldId,
  loaded: false,
  summary: '',
  storyId: null,
  running: null,
  cancelling: false,
  last: null,
  estimate: null,
  problem: null
})

export const useWorldBuilder = create<WorldBuilderSession>(() => fresh(null))

const get = useWorldBuilder.getState
const set = useWorldBuilder.setState
const openWorld = (): ID | null => useApp.getState().world?.id ?? null
/** True while the session is the open world's. */
const current = (): boolean => get().worldId === openWorld()

// ---------- Keeping the summary ----------

/** Typing pauses this long before the summary is kept (and the cost worked out again). */
const SAVE_MS = 600
const ESTIMATE_MS = 450

let saveTimer: ReturnType<typeof setTimeout> | null = null
let unsaved: { worldId: ID; summary: string } | null = null

/** Keeps the summary typed since it was last kept, now. */
async function saveNow(): Promise<void> {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = null
  const s = unsaved
  unsaved = null
  if (!s || openWorld() !== s.worldId) return
  try {
    await api.saveWorldSummary(s.summary)
  } catch (e) {
    toast(`Couldn’t keep your summary. ${(e as Error).message}`, { tone: 'danger' })
  }
}

// Before the window closes or the world changes, the summary typed is kept.
registerFlusher(saveNow)
// After a backup is restored, the world underneath has changed: what was typed before is dropped, and the page reads it afresh.
registerDiscarder(() => {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = null
  unsaved = null
  set(fresh(null))
})

// ---------- The cost ----------

let estimateTimer: ReturnType<typeof setTimeout> | null = null
let estimateSeq = 0

/** Works out again what building would cost, after a pause in typing. What it said before stays until then. */
function estimateSoon(delay = ESTIMATE_MS): void {
  if (estimateTimer) clearTimeout(estimateTimer)
  estimateTimer = setTimeout(() => {
    estimateTimer = null
    const s = get()
    const ticket = ++estimateSeq
    const worldId = s.worldId
    api
      .estimateWorldBuild({ summary: s.summary, storyId: storyOf(s.storyId, useApp.getState().stories) })
      .then((estimate) => {
        if (ticket === estimateSeq && get().worldId === worldId) set({ estimate })
      })
      .catch(() => {
        // Not known: the page simply says nothing about the cost.
        if (ticket === estimateSeq && get().worldId === worldId) set({ estimate: null })
      })
  }, delay)
}

// ---------- Following builds ----------

/** Plain words for a failure, with the code that says when the fix is in Settings. */
const problemOf = (e: unknown): Problem => ({ message: (e as Error).message, code: e instanceof ApiError ? e.code : undefined })

/** The world's themes or tone changed: the Style guide shows the world as the app holds it. */
const themesChanged = (made: WorldBuildDone['made']): boolean => made.some((m) => m.what === 'themes' || m.what === 'tone')

let listening = false
/** Follows the World builder's builds for as long as the window is open, whichever page is showing. */
function listen(): void {
  if (listening) return
  listening = true
  onEvent('worldBuilder:progress', (p) => {
    const s = get()
    if (!current() || (s.running && s.running.buildId !== p.buildId)) return
    set({ running: { ...p, storyId: s.running?.storyId ?? s.storyId } })
  })
  onEvent('worldBuilder:done', (d) => {
    const s = get()
    if (!current() || (s.running && s.running.buildId !== d.buildId)) return
    set({
      running: null,
      cancelling: false,
      last: d,
      problem: d.status === 'error' && d.error ? { message: d.error, code: d.code ?? undefined } : null
    })
    if (themesChanged(d.made))
      void useApp
        .getState()
        .refreshWorld()
        .catch(() => undefined)
    // The world has more in it now, so building again costs a little differently.
    estimateSoon(0)
  })
}

/** The page's state as the main process has it: the summary kept (unless Adam has typed since), a build running, the last one. */
function apply(st: WorldBuilderState): void {
  const s = get()
  set({
    loaded: true,
    summary: s.loaded ? s.summary : st.summary,
    running: st.running,
    storyId: st.running ? st.running.storyId : s.storyId,
    last: st.last
  })
}

/** The page opened: reads the open world's summary and builds (afresh after a world change), and what building would cost. */
export async function loadWorldBuilder(): Promise<void> {
  listen()
  const worldId = openWorld()
  if (get().worldId !== worldId) set(fresh(worldId))
  try {
    const st = await api.getWorldBuilder()
    if (get().worldId !== worldId) return
    apply(st)
  } catch (e) {
    if (get().worldId !== worldId) return
    set({ loaded: true, problem: problemOf(e) })
  }
  estimateSoon(0)
}

/** Reads again what the last build made, as it is now (lines undone in What changed, entries deleted since). */
export async function refreshWorldBuilder(): Promise<void> {
  const worldId = get().worldId
  if (!worldId || worldId !== openWorld() || !get().loaded) return
  try {
    const st = await api.getWorldBuilder()
    if (get().worldId !== worldId) return
    // A build that started or ended meanwhile is followed by its own events.
    if (!get().running && !st.running) set({ last: st.last })
  } catch {
    // What shows stays as it was.
  }
}

// ---------- What Adam does ----------

export function setWorldSummary(summary: string): void {
  const worldId = get().worldId
  if (!worldId) return
  set({ summary, problem: get().running ? get().problem : null })
  unsaved = { worldId, summary }
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void saveNow(), SAVE_MS)
  estimateSoon()
}

/** "When is this true?": null for the start of the world, else a story's id. */
export function setWorldBuildStory(storyId: ID | null): void {
  set({ storyId })
  estimateSoon(0)
}

/** Builds the world from the summary: one click, nothing to approve. Its events say how it goes. */
export async function buildWorld(): Promise<void> {
  const s = get()
  if (s.running || !s.worldId) return
  if (!s.summary.trim()) {
    set({ problem: { message: 'Write or paste a summary first. A paragraph is enough.' } })
    return
  }
  const buildId = crypto.randomUUID()
  const storyId = storyOf(s.storyId, useApp.getState().stories)
  dropUndoneToast()
  // Starting keeps the summary itself, so what was waiting to be kept needn't be.
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = null
  unsaved = null
  set({
    running: { buildId, stage: 'reading', step: 'Reading your summary', made: [], retrying: null, storyId },
    cancelling: false,
    storyId,
    problem: null
  })
  try {
    await api.startWorldBuild({ buildId, summary: s.summary, storyId })
  } catch (e) {
    if (get().running?.buildId !== buildId) return
    set({ running: null, problem: problemOf(e) })
  }
}

/** Cancels the build: what it has saved stays, and one Undo takes it away. */
export async function cancelWorldBuild(): Promise<void> {
  const s = get()
  if (!s.running || s.cancelling) return
  set({ cancelling: true })
  try {
    await api.cancelWorldBuild(s.running.buildId)
  } catch (e) {
    set({ cancelling: false })
    toast(`Couldn’t cancel the build. ${(e as Error).message}`, { tone: 'danger' })
  }
}

/** The "Build undone." toast while it may still show. */
let undoneToast: number | null = null

/** A new build takes away the Undo on "Build undone.": it may make the same things again, and they are the ones to keep. */
function dropUndoneToast(): void {
  if (undoneToast != null) useToasts.getState().dismiss(undoneToast)
  undoneToast = null
}

/** Undoes everything the last build made, in one go; the toast's Undo brings it all back. */
export async function undoWholeBuild(): Promise<void> {
  const runId = get().last?.runId
  if (!runId || get().running) return
  try {
    const { lineIds } = await api.undoWorldBuild(runId)
    await refreshWorldBuilder()
    if (get().last && themesChanged(get().last!.made))
      void useApp
        .getState()
        .refreshWorld()
        .catch(() => undefined)
    undoneToast = toast('Build undone.', { action: { label: 'Undo', run: () => void redoWholeBuild(runId, lineIds) } })
  } catch (e) {
    toast(`Couldn’t undo the build. ${(e as Error).message}`, { tone: 'danger' })
  }
}

async function redoWholeBuild(runId: ID, lineIds: ID[]): Promise<void> {
  undoneToast = null
  try {
    await api.redoWorldBuild(runId, lineIds)
    await refreshWorldBuilder()
    void useApp
      .getState()
      .refreshWorld()
      .catch(() => undefined)
  } catch (e) {
    toast(`Couldn’t bring the build back. ${(e as Error).message}`, { tone: 'danger' })
  }
}
