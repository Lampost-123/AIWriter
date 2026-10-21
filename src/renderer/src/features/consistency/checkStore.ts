// Checking, as the whole window sees it (milestone 5; one store since the calm overhaul, 2026-10-19): every check run
// from the main process's events, whoever started it (runsLogic.ts), the one Adam asked for (from the top bar's Check, the
// binder's row menus, the palette, the Issues list or the Check room: all through startCheck, so each shows everywhere),
// what went wrong, per scene and for the story, and the open issues per scene for the binder's badges. Listens to the
// checks:* and issues:changed events once, the first time anything here is used.
import { useEffect } from 'react'
import { create } from 'zustand'
import { ALL_CHECKS, DONE_CHECKS, type CheckKind, type CheckTarget } from '@shared/contracts/checks'
import type { ID, Outline } from '@shared/types'
import { toast } from '@/components/ui'
import { api, onEvent } from '@/lib/api'
import { flushAll } from '@/lib/flush'
import { plainReason } from '@/lib/reason'
import { useApp } from '@/lib/store'
import { useOutlineStore } from '@/features/binder/outlineStore'
import { ended, progressed, runLine, type Run } from './runsLogic'

export type IssueCount = { count: number; mustFix: number }

export interface CheckRun {
  runId: ID
  target: CheckTarget
  storyId: ID
  /** What is being checked, in plain words: "Ch 3, Sc 2", "Ch 3", "Book 1". */
  what: string
  /** Scenes checked so far and in all; null until the first progress arrives. */
  done: number | null
  total: number | null
  /** The scene being checked now ("Ch 3, Sc 2: The ferry"). */
  current: string | null
  stopping: boolean
}

interface CheckState {
  /** Open issues per scene, for the story they were loaded for. */
  counts: { storyId: ID | null; byScene: Record<ID, IssueCount> }
  /** Bumped on every issues:changed, so lists of issues reload. */
  issuesRev: number
  /** The check Adam asked for, while it is being got ready, waits its turn or runs. */
  run: CheckRun | null
  /** Every run going on or waiting, whoever started it (runsLogic.ts). */
  runs: Record<ID, Run>
  /** The last check of a scene that went wrong, per scene. */
  failed: Record<ID, string>
  /** The last check Adam asked for that ended in an error, said on the Check room until dismissed or another starts. */
  failure: { storyId: ID; message: string } | null
}

export const useChecks = create<CheckState>(() => ({
  counts: { storyId: null, byScene: {} },
  issuesRev: 0,
  run: null,
  runs: {},
  failed: {},
  failure: null
}))

const get = useChecks.getState
const set = useChecks.setState

// ---------- Badges ----------

let countsTicket = 0

/** Loads the open issues per scene of a story; the badges keep showing the last counts meanwhile. */
export async function loadCounts(storyId: ID): Promise<void> {
  const mine = ++countsTicket
  try {
    const byScene = await api.issueCounts(storyId)
    if (mine === countsTicket) set({ counts: { storyId, byScene } })
  } catch {
    // The badges stay as they were; the next change tries again.
  }
}

/**
 * Keeps the badges in step with a story: when it opens, when the world changes and on issues:changed,
 * never on word counts (outlineRev moves with every word).
 */
export function useIssueCounts(storyId: ID | null): void {
  const worldId = useApp((s) => s.world?.id ?? null)
  const rev = useChecks((s) => s.issuesRev)
  useEffect(() => {
    listen()
    if (storyId) void loadCounts(storyId)
    else set({ counts: { storyId: null, byScene: {} } })
  }, [storyId, worldId, rev])
}

/** "2 issues, 1 must fix", for screen readers and the badge's tooltip. */
export function countWords({ count, mustFix }: IssueCount): string {
  const issues = `${count} ${count === 1 ? 'issue' : 'issues'}`
  return mustFix ? `${issues}, ${mustFix} must fix` : issues
}

// ---------- Checking ----------

/** What a target is, in plain words, from the story's outline. */
async function whatOf(target: CheckTarget, storyId: ID): Promise<string> {
  if (target.scope === 'story') return useApp.getState().stories.find((s) => s.id === storyId)?.title || 'this story'
  const held = useOutlineStore.getState().outline
  const o: Outline | null = held && held.story.id === storyId ? held : await api.getOutline(storyId).catch(() => null)
  if (!o) return target.scope === 'scene' ? 'this scene' : 'this chapter'
  const chapterNo = (id: ID): number => o.chapters.findIndex((c) => c.id === id) + 1
  if (target.scope === 'chapter') return `Ch ${chapterNo(target.id)}`
  const scene = o.scenes.find((s) => s.id === target.id)
  if (!scene) return 'this scene'
  const sceneNo = o.scenes.filter((s) => s.chapterId === scene.chapterId).findIndex((s) => s.id === scene.id) + 1
  return `Ch ${chapterNo(scene.chapterId)}, Sc ${sceneNo}`
}

/**
 * Starts checking a scene (every check), or a chapter or story (facts, knowledge and timeline, unless
 * `checks` says more). Its progress shows in the top bar's Check, the Issues list, the Check room and the binder.
 */
export async function startCheck(target: CheckTarget, storyId: ID, checks?: CheckKind[]): Promise<void> {
  listen()
  if (get().run) {
    toast('A check is already running. Stop it, or wait for it to finish, then try again.')
    return
  }
  const runId = crypto.randomUUID()
  const run: CheckRun = { runId, target, storyId, what: '', done: null, total: null, current: null, stopping: false }
  const failed = { ...get().failed }
  if (target.scope === 'scene') delete failed[target.id]
  set({ run, failure: null, failed })
  /** This run while it is still the one showing (the world changing clears it). */
  const mine = (): CheckRun | null => (get().run?.runId === runId ? get().run : null)
  /** Stop was pressed before the check went out: it never starts. */
  const calledOff = (): boolean => {
    const now = mine()
    if (now && !now.stopping) return false
    if (now) {
      set({ run: null })
      toast(`Check of ${now.what || 'it'} stopped.`)
    }
    return true
  }
  try {
    const what = await whatOf(target, storyId)
    if (mine()) set({ run: { ...mine()!, what } })
    // The checks read the scenes as saved: words typed a moment ago go in first.
    await flushAll()
    if (calledOff()) return
    await api.startCheck({ runId, target, checks: checks ?? (target.scope === 'scene' ? ALL_CHECKS : DONE_CHECKS) })
    sent.add(runId)
    // Stop pressed (or the world changed) while it was being started: stop it now it can be.
    if (!mine() || mine()!.stopping) await api.stopCheck(runId).catch(() => undefined)
  } catch (e) {
    if (!mine()) return
    set({ run: null })
    failedRun(storyId, target, plainReason(e))
  }
}

/** Runs the main process has been asked to start: until then, Stop only marks the run, and it never starts. */
const sent = new Set<ID>()

export const checkScene = (sceneId: ID, storyId: ID): Promise<void> => startCheck({ scope: 'scene', id: sceneId }, storyId)
export const checkChapter = (chapterId: ID, storyId: ID): Promise<void> => startCheck({ scope: 'chapter', id: chapterId }, storyId)
export const checkStory = (storyId: ID, checks?: CheckKind[]): Promise<void> => startCheck({ scope: 'story', id: storyId }, storyId, checks)

/** Stops Adam's check. */
export async function stopCheck(): Promise<void> {
  const run = get().run
  if (!run || run.stopping) return
  set({ run: { ...run, stopping: true } })
  if (!sent.has(run.runId)) return
  try {
    await api.stopCheck(run.runId)
  } catch (e) {
    if (get().run?.runId === run.runId) set({ run: { ...get().run!, stopping: false } })
    toast(`The check couldn’t be stopped. ${plainReason(e)}`, { tone: 'danger' })
  }
}

/** Stops any run (the Issues list's Stop on a check started by marking the scene done, say). */
export async function stopRun(runId: ID): Promise<void> {
  if (get().run?.runId === runId) return stopCheck()
  try {
    await api.stopCheck(runId)
  } catch (e) {
    toast(plainReason(e))
  }
}

/** Check now: a run waiting for the memory to catch up goes ahead with what the memory has. */
export async function checkWithoutWaiting(runId: ID): Promise<void> {
  try {
    await api.checkWithoutWaiting(runId)
  } catch (e) {
    toast(plainReason(e))
  }
}

/**
 * A check of Adam's that couldn't start or ended in an error: in the scene's Issues list and on the Check room, and in a
 * message when neither is showing.
 */
function failedRun(storyId: ID, target: CheckTarget, message: string): void {
  set({ failure: { storyId, message }, ...(target.scope === 'scene' ? { failed: { ...get().failed, [target.id]: message } } : {}) })
  const view = useApp.getState().view
  if (view.kind === 'consistency' && view.storyId === storyId) return
  if (target.scope === 'scene' && issuesShowing(target.id)) return
  const settings = /Settings/.test(message)
  toast(message, {
    tone: 'danger',
    action: settings ? { label: 'Settings', run: () => useApp.getState().navigate({ kind: 'settings', tab: 'models' }) } : undefined
  })
}

/** The scene's Issues list is beside the page now (it says how a check went itself). */
function issuesShowing(sceneId: ID): boolean {
  const app = useApp.getState()
  return (
    app.view.kind === 'write' &&
    app.sceneId === sceneId &&
    !!app.settings?.layout.inspectorOpen &&
    !app.askOpen &&
    (app.inspectorTab === 'issues' || app.inspectorTab === 'critique')
  )
}

export const dismissFailure = (): void => set({ failure: null })

/** Opens a story's Consistency page (the Check room). */
export function openConsistency(storyId: ID): void {
  useApp.getState().navigate({ kind: 'consistency', storyId })
}

/** What Adam's check is doing, in plain words (the run's events and the memory's catching up included). */
export function useRunWords(run: CheckRun | null, short = false): string {
  const runs = useChecks((s) => s.runs)
  const memory = useApp((s) => s.memoryStatus)
  return run ? adamsRunWords(run, { runs, memory, short }) : ''
}

/**
 * "Getting ready to check Ch 3…" before the first word from the main process, then what the run is doing
 * (runsLogic.ts runLine): waiting its turn, waiting for the memory, "Checking Ch 3, Sc 2 · 2 of 5".
 */
export function adamsRunWords(run: CheckRun, o: Parameters<typeof runLine>[1] = {}): string {
  const what = run.what || 'it'
  if (run.stopping) return `Stopping the check of ${what}…`
  const live = o.runs?.[run.runId]
  if (live) return runLine(live, o)
  if (run.total === null || run.done === null) return `Getting ready to check ${what}…`
  return runLine({ runId: run.runId, done: run.done, total: run.total, current: run.current, target: run.target }, o)
}

// ---------- Events ----------

let listening = false

/** Where a check that ends is told: the Issues list reads its scenes again, the draft's note hears what it found. */
const doneHooks = new Set<(d: { run: Run | null; status: string; found: number; scenes: ID[]; background: boolean }) => void>()
export function onCheckEnded(fn: (d: { run: Run | null; status: string; found: number; scenes: ID[]; background: boolean }) => void): () => void {
  doneHooks.add(fn)
  return () => doneHooks.delete(fn)
}

export function listen(): void {
  if (listening) return
  listening = true
  onEvent('checks:progress', (p) => {
    const s = get()
    const next = progressed({ runs: s.runs, failed: s.failed }, p)
    const run = s.run?.runId === p.runId ? { ...s.run, done: p.done, total: p.total, current: p.current } : s.run
    set({ ...next, run })
  })
  onEvent('checks:done', (d) => {
    const s = get()
    const out = ended({ runs: s.runs, failed: s.failed }, d)
    set(out.state)
    for (const fn of doneHooks) {
      try {
        fn({ run: out.run, status: d.status, found: d.found, scenes: out.scenes, background: !!d.background })
      } catch (e) {
        console.warn('Could not pass on a check that ended', e)
      }
    }
    const run = s.run
    sent.delete(d.runId)
    if (run?.runId !== d.runId) return
    set({ run: null })
    if (d.status === 'error') return failedRun(run.storyId, run.target, d.error || 'The check stopped with a problem. Please try again.')
    const view = useApp.getState().view
    const here = view.kind === 'consistency' && view.storyId === run.storyId
    // A scene's check while its Issues list shows: the list says it all (no note).
    if (run.target.scope === 'scene' && issuesShowing(run.target.id) && d.status !== 'stopped') return
    if (d.status === 'stopped') {
      toast(d.found ? `Check of ${run.what} stopped. ${found(d.found)} so far.` : `Check of ${run.what} stopped.`)
      return
    }
    // The desk's Check room says "Checked just now" and lists what it found, so it needs no note on top.
    if (here && run.target.scope !== 'scene' && deskShowing()) return
    // One note at the end, with the way to what it found: the scene's Issues list, or the Check room.
    const show =
      run.target.scope === 'scene'
        ? { label: 'Show', run: () => void import('@/features/issues/issuesStore').then((m) => m.showIssues(run.target.id)) }
        : { label: 'Show', run: () => openConsistency(run.storyId) }
    toast(d.found ? `Checked ${run.what}. ${found(d.found)}.` : `Checked ${run.what}. Nothing new to look at.`, {
      tone: d.found ? 'neutral' : 'success',
      action: here || !d.found ? undefined : show
    })
  })
  // The badges (useIssueCounts) and the Consistency page reload from this.
  onEvent('issues:changed', () => set({ issuesRev: get().issuesRev + 1 }))
  // A check and its failure belong to the world they were started in.
  useApp.subscribe((now, before) => {
    if (now.world?.id !== before.world?.id) set({ run: null, runs: {}, failed: {}, failure: null, counts: { storyId: null, byScene: {} } })
  })
}

const found = (n: number): string => (n === 1 ? '1 new issue' : `${n} new issues`)

function deskShowing(): boolean {
  const root = document.documentElement
  return root.dataset.arrangement === 'desk' && root.dataset.look === 'new'
}

// In the window, from the start, so a check started anywhere (marking a scene done, a draft landing) shows everywhere.
if (typeof window !== 'undefined' && window.aiwrite) listen()
